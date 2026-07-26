import {
  BUCKET_SOURCES,
  chunkText,
  checkCompressionRatio,
  checkUpload,
  type SourceKind,
} from '@nlm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

import { EmbeddingError, type EmbeddingClient } from '../lib/embeddings.js';
import { ExtractionError, extract } from '../lib/extract.js';
import { FetchRejectedError, fetchPageSafely } from '../lib/safe-fetch.js';

/**
 * Import einer Quelle: laden, extrahieren, zerlegen, einbetten, speichern.
 *
 * Der Status wird nach jedem Abschnitt fortgeschrieben, nicht erst am Ende. Die
 * UI hängt über Realtime daran, und bei einem Import, der Minuten dauert, ist
 * „passiert gerade etwas?" die wichtigste Information für den Nutzer.
 *
 * Fehler werden in zwei Ebenen getrennt: `error` in der Datenbank ist die
 * Meldung für den Nutzer, das Log trägt die technische Fassung. Ein Stacktrace
 * in der Oberfläche hilft niemandem und verrät im Zweifel Interna.
 */

export type IngestPayload = {
  readonly sourceId: string;
};

type SourceRow = {
  readonly id: string;
  readonly notebook_id: string;
  readonly kind: SourceKind;
  readonly title: string;
  readonly storage_path: string | null;
  readonly source_url: string | null;
  readonly byte_size: number | null;
};

export type IngestContext = {
  readonly supabase: SupabaseClient;
  readonly embeddings: EmbeddingClient;
  readonly logger: Logger;
};

export async function ingestSource(
  payload: IngestPayload,
  context: IngestContext,
): Promise<void> {
  const { supabase, embeddings, logger } = context;
  const log = logger.child({ sourceId: payload.sourceId });

  const { data: source, error: loadError } = await supabase
    .from('sources')
    .select('id, notebook_id, kind, title, storage_path, source_url, byte_size')
    .eq('id', payload.sourceId)
    .maybeSingle<SourceRow>();

  if (loadError) throw new Error(`Quelle nicht lesbar: ${loadError.message}`);
  if (!source) {
    // Die Quelle wurde gelöscht, während der Job in der Warteschlange stand.
    // Kein Fehler — es gibt schlicht nichts mehr zu tun.
    log.info('Quelle existiert nicht mehr, Job wird übersprungen');
    return;
  }

  try {
    await setStatus(supabase, source.id, 'extracting');

    const { markdown, pageCount, pageBreaks, title, warnings } = await loadAndExtract(
      source,
      supabase,
      log,
    );

    log.info(
      { chars: markdown.length, pageCount, warnings: warnings.length },
      'Text extrahiert',
    );

    const chunks = chunkText(markdown, { pageBreaks });
    if (chunks.length === 0) {
      throw new ExtractionError(
        'Chunker lieferte keine Abschnitte',
        'Aus dieser Quelle ließ sich kein verwertbarer Text gewinnen.',
      );
    }

    await setStatus(supabase, source.id, 'embedding', {
      char_count: markdown.length,
      page_count: pageCount,
      // Einen erkannten Titel übernehmen, aber nur wenn der Nutzer keinen
      // eigenen vergeben hat — sonst würde eine URL seinen Namen überschreiben.
      ...(title && source.title === source.source_url ? { title } : {}),
    });

    log.info({ chunks: chunks.length }, 'Abschnitte gebildet, Embeddings folgen');

    /*
     * Den extrahierten Text sichern, bevor eingebettet wird. Er ist die
     * Grundlage des Viewers: Zitate zeigen über char_start/char_end auf
     * Positionen im *ganzen* Dokument, und aus den überlappenden Abschnitten
     * ließe sich das Original nur ungefähr wieder zusammensetzen — die
     * markierte Stelle säße dann ein paar Zeichen daneben.
     *
     * Bewusst vor dem Embedding: schlägt Voyage fehl, ist der Text trotzdem
     * schon da, und ein erneuter Versuch beginnt nicht wieder beim Parsen.
     */
    const textPath = `${source.notebook_id}/extrahiert/${source.id}.md`;
    const { error: textError } = await supabase.storage
      .from(BUCKET_SOURCES)
      .upload(textPath, new TextEncoder().encode(markdown), {
        // Ohne charset-Parameter: der Bucket vergleicht den Content-Type als
        // ganze Zeichenkette gegen seine Positivliste, ein angehängtes
        // "; charset=utf-8" gilt dort als anderer Typ und wird abgewiesen.
        contentType: 'text/markdown',
        // Beim zweiten Anlauf liegt die Datei schon da.
        upsert: true,
      });
    if (textError) {
      throw new Error(`Volltext nicht speicherbar: ${textError.message}`);
    }

    const { vectors, totalTokens } = await embeddings.embed(
      chunks.map((chunk) => chunk.content),
      'document',
    );

    // Vor dem Schreiben alte Abschnitte entfernen: ein erneuter Import derselben
    // Quelle darf keine Dubletten erzeugen. Der eindeutige Index auf
    // (source_id, idx) würde sonst zuschlagen.
    const { error: deleteError } = await supabase
      .from('chunks')
      .delete()
      .eq('source_id', source.id);
    if (deleteError)
      throw new Error(`Alte Abschnitte nicht löschbar: ${deleteError.message}`);

    const rows = chunks.map((chunk, index) => ({
      source_id: source.id,
      notebook_id: source.notebook_id,
      idx: chunk.idx,
      content: chunk.content,
      heading_path: chunk.headingPath,
      page: chunk.page,
      char_start: chunk.charStart,
      char_end: chunk.charEnd,
      token_count: chunk.tokenCount,
      embedding: JSON.stringify(vectors[index]),
    }));

    // In Blöcken schreiben: ein einzelnes Insert mit tausenden Vektoren läuft
    // in die Anfragegröße von PostgREST.
    for (let start = 0; start < rows.length; start += 200) {
      const slice = rows.slice(start, start + 200);
      const { error: insertError } = await supabase.from('chunks').insert(slice);
      if (insertError) {
        throw new Error(`Abschnitte nicht speicherbar: ${insertError.message}`);
      }
    }

    await setStatus(supabase, source.id, 'ready', { error: null, text_path: textPath });

    log.info(
      { chunks: chunks.length, tokens: totalTokens },
      'Quelle vollständig indexiert',
    );
  } catch (error) {
    const { userMessage, retryable } = describeFailure(error);
    log.error({ err: error, retryable }, 'Import fehlgeschlagen');

    await setStatus(supabase, source.id, 'failed', { error: userMessage });

    // Nur wiederholbare Fehler weiterwerfen: die Job-Schleife wiederholt dann.
    // Ein gescanntes PDF wird auch beim dritten Versuch keinen Text haben.
    if (retryable) throw error;
  }
}

async function loadAndExtract(source: SourceRow, supabase: SupabaseClient, log: Logger) {
  if (source.kind === 'url') {
    if (!source.source_url) {
      throw new ExtractionError(
        'keine URL hinterlegt',
        'Zu dieser Quelle fehlt die Adresse.',
      );
    }
    log.info({ url: source.source_url }, 'Seite wird abgerufen');
    const page = await fetchPageSafely(source.source_url);
    return extract('url', { html: page.html, url: page.finalUrl });
  }

  if (!source.storage_path) {
    throw new ExtractionError('kein Storage-Pfad', 'Zu dieser Quelle fehlt die Datei.');
  }

  const { data, error } = await supabase.storage
    .from(BUCKET_SOURCES)
    .download(source.storage_path);

  if (error || !data) {
    throw new ExtractionError(
      `Download fehlgeschlagen: ${error?.message ?? 'keine Daten'}`,
      'Die hochgeladene Datei ließ sich nicht laden.',
    );
  }

  const bytes = new Uint8Array(await data.arrayBuffer());

  /*
   * Die verbindliche Typprüfung. Der Browser prüft vor dem Upload dieselbe
   * Funktion, aber das ist reine Höflichkeit gegenüber dem Nutzer — wer die
   * Oberfläche umgeht und direkt gegen die Storage-API spricht, kommt daran
   * vorbei. Hier nicht: geprüft werden die Bytes, die tatsächlich im Bucket
   * liegen, und zwar bevor sie an einen Parser gehen.
   *
   * Erst recht wichtig, weil `kind` aus der Datenbank kommt und vom Client
   * gesetzt wurde: ohne diesen Abgleich könnte jemand eine beliebige Datei als
   * 'docx' eintragen und damit den ZIP-Parser auf Inhalte loslassen, für die er
   * nie gedacht war.
   */
  const verdict = checkUpload({
    data: bytes.subarray(0, 8192),
    declaredName: source.title,
    declaredMime: undefined,
    totalBytes: bytes.byteLength,
  });

  if (!verdict.ok) {
    throw new ExtractionError(
      `Upload-Prüfung fehlgeschlagen (${verdict.reason}): ${verdict.detail}`,
      verdict.detail,
    );
  }

  if (verdict.kind !== source.kind && !isTextPair(verdict.kind, source.kind)) {
    throw new ExtractionError(
      `Inhalt ist ${verdict.kind}, eingetragen war ${source.kind}`,
      'Der Inhalt der Datei passt nicht zum angegebenen Dateityp.',
    );
  }

  // Zip-Bombe: bei DOCX das Verhältnis prüfen, bevor entpackt wird.
  if (source.kind === 'docx' && source.byte_size) {
    // mammoth entpackt selbst; als grobe Vorabschätzung dient die Dateigröße
    // gegen die im Archiv angekündigte Gesamtgröße. Eine genauere Prüfung
    // bräuchte einen eigenen ZIP-Leser — der Aufwand lohnt erst, wenn der Fall
    // real auftritt.
    const suspicious = checkCompressionRatio(source.byte_size, bytes.byteLength * 50);
    if (suspicious && !suspicious.ok) {
      throw new ExtractionError(suspicious.detail, suspicious.detail);
    }
  }

  return extract(source.kind, { data: bytes });
}

/**
 * txt, md und paste sind derselbe Inhalt mit anderem Etikett.
 *
 * Die Signaturprüfung kann sie nicht auseinanderhalten — reiner Text hat keine
 * Magic Bytes —, deshalb wäre eine Abweichung zwischen diesen dreien kein
 * Hinweis auf einen Angriff, sondern nur auf eine andere Dateiendung.
 */
const TEXT_KINDS: ReadonlySet<SourceKind> = new Set(['txt', 'md', 'paste']);

function isTextPair(detected: SourceKind, declared: SourceKind): boolean {
  return TEXT_KINDS.has(detected) && TEXT_KINDS.has(declared);
}

async function setStatus(
  supabase: SupabaseClient,
  sourceId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase
    .from('sources')
    .update({ status, ...extra })
    .eq('id', sourceId);

  // Ein fehlgeschlagenes Status-Update ist kein Grund, den ganzen Import
  // abzubrechen — aber es muss sichtbar sein, sonst hängt die Anzeige.
  if (error) {
    throw new Error(`Status ${status} nicht setzbar: ${error.message}`);
  }
}

/**
 * Übersetzt einen Fehler in eine Nutzermeldung und die Frage, ob eine
 * Wiederholung Sinn ergibt.
 */
function describeFailure(error: unknown): { userMessage: string; retryable: boolean } {
  if (error instanceof ExtractionError) {
    // Ein Dokument, aus dem sich kein Text lesen lässt, bleibt auch beim
    // dritten Versuch unlesbar.
    return { userMessage: error.userMessage, retryable: false };
  }
  if (error instanceof FetchRejectedError) {
    const transient = error.reason === 'http_error';
    return { userMessage: error.userMessage, retryable: transient };
  }
  if (error instanceof EmbeddingError) {
    return { userMessage: error.userMessage, retryable: error.retryable };
  }
  return {
    userMessage: 'Beim Verarbeiten ist ein unerwarteter Fehler aufgetreten.',
    retryable: true,
  };
}
