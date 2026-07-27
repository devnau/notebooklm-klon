import { BUCKET_AUDIO, BUCKET_SOURCES } from '@nlm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

/**
 * Räumt weg, was die Datenbank nicht mehr kennt.
 *
 * **Warum das nötig ist.** Wird ein Notizbuch gelöscht, nimmt die Kaskade
 * Quellen, Abschnitte und Artefakte mit — die Dateien im Storage nicht. Storage
 * kennt die Fremdschlüssel der Anwendung nicht, und ein Datenbank-Trigger
 * scheidet aus: der Storage-Dienst verbietet das direkte Löschen aus seinen
 * Tabellen, und ein Versuch machte in Migration 0010 das Löschen ganzer
 * Notizbücher unmöglich.
 *
 * Beim Löschen einer einzelnen Quelle oder eines Artefakts räumt die
 * Anwendung selbst auf. Dieser Job ist für alles andere: abgebrochene Uploads,
 * gelöschte Notizbücher, ein Insert, der nach dem Upload an RLS scheiterte.
 *
 * **Das ist nicht nur Ordnung, sondern Datenschutz.** Ein gelöschtes Notizbuch
 * soll gelöscht sein. Eine Quelldatei, die nach dem Löschen weiter im Bucket
 * liegt, ist genau das nicht — und sie liegt dort unbegrenzt.
 */

/**
 * Wie alt ein Objekt sein muss, bevor es als verwaist gilt.
 *
 * Nicht null: zwischen dem Upload einer Datei und dem Insert der Quelle liegen
 * Millisekunden, in denen die Datei zurecht noch keinen Eintrag hat. Ein Job,
 * der in diesem Fenster aufräumt, löscht Uploads, die gerade eintreffen. Eine
 * Stunde ist reichlich Abstand und für eine Datei, die ohnehin niemand mehr
 * findet, kein Nachteil.
 */
const MINDESTALTER_MS = 60 * 60 * 1000;

export type CleanupResult = {
  readonly geprueft: number;
  readonly entfernt: number;
  readonly rateLimitZeilen: number;
};

export async function cleanupOrphans(
  supabase: SupabaseClient,
  logger: Logger,
): Promise<CleanupResult> {
  const log = logger.child({ job: 'cleanup' });

  const bekannteQuellen = await sammleBekanntePfade(supabase, 'sources', [
    'storage_path',
    'text_path',
  ]);
  const bekannteArtefakte = await sammleBekanntePfade(supabase, 'artifacts', [
    'storage_path',
  ]);

  let geprueft = 0;
  let entfernt = 0;

  for (const [bucket, bekannt] of [
    [BUCKET_SOURCES, bekannteQuellen],
    [BUCKET_AUDIO, bekannteArtefakte],
  ] as const) {
    const objekte = await listeBucket(supabase, bucket);
    geprueft += objekte.length;

    const verwaist = objekte
      .filter((objekt) => !bekannt.has(objekt.pfad))
      .filter((objekt) => Date.now() - objekt.erstellt > MINDESTALTER_MS)
      .map((objekt) => objekt.pfad);

    if (verwaist.length === 0) continue;

    /*
     * In Blöcken löschen: die Storage-API nimmt eine Liste, aber eine mit
     * tausenden Einträgen läuft in die Anfragegrösse.
     */
    for (let start = 0; start < verwaist.length; start += 100) {
      const block = verwaist.slice(start, start + 100);
      const { error } = await supabase.storage.from(bucket).remove(block);
      if (error) {
        log.error({ err: error, bucket, anzahl: block.length }, 'Löschen fehlgeschlagen');
        continue;
      }
      entfernt += block.length;
    }

    log.info({ bucket, verwaist: verwaist.length }, 'Verwaiste Dateien entfernt');
  }

  // Die Zählertabelle für Kontingente wächst sonst unbegrenzt: bei 120 Anfragen
  // pro Stunde und Nutzer sind das im Jahr sechsstellige Zeilenzahlen, für die
  // sich nach einer Stunde niemand mehr interessiert.
  const pruneErgebnis: { data: unknown } = await supabase.rpc('prune_rate_limit_events');
  const geloescht = typeof pruneErgebnis.data === 'number' ? pruneErgebnis.data : 0;

  log.info({ geprueft, entfernt, rateLimitZeilen: geloescht }, 'Aufräumen fertig');

  return { geprueft, entfernt, rateLimitZeilen: geloescht };
}

/**
 * Sammelt alle Pfade, die in der Datenbank stehen.
 *
 * Seitenweise, nicht in einem Zug: bei zehntausend Quellen wäre eine einzelne
 * Abfrage nicht das Problem, aber PostgREST begrenzt die Zeilenzahl je Antwort,
 * und ein stillschweigend abgeschnittenes Ergebnis würde dazu führen, dass der
 * Job **gültige Dateien für verwaist hält und löscht**. Das ist der teuerste
 * denkbare Fehler an dieser Stelle.
 */
async function sammleBekanntePfade(
  supabase: SupabaseClient,
  tabelle: 'sources' | 'artifacts',
  spalten: readonly string[],
): Promise<Set<string>> {
  const bekannt = new Set<string>();
  const seitenGroesse = 1_000;

  for (let seite = 0; ; seite += 1) {
    const { data, error } = await supabase
      .from(tabelle)
      .select(spalten.join(', '))
      .range(seite * seitenGroesse, (seite + 1) * seitenGroesse - 1);

    if (error) {
      // Abbrechen statt weitermachen: mit einer unvollständigen Liste würde der
      // Job gültige Dateien löschen.
      throw new Error(`Pfade aus ${tabelle} nicht lesbar: ${error.message}`);
    }

    // Über `unknown`: der generierte Typ für `select` mit dynamischer
    // Spaltenliste ist ein Fehlertyp, weil PostgREST die Spalten erst zur
    // Laufzeit kennt. Die Form steht in `spalten` und wird unten geprüft.
    const zeilen = (data ?? []) as unknown as Record<string, string | null>[];
    for (const zeile of zeilen) {
      for (const spalte of spalten) {
        const wert = zeile[spalte];
        if (typeof wert === 'string' && wert.length > 0) bekannt.add(wert);
      }
    }

    if (zeilen.length < seitenGroesse) break;
  }

  return bekannt;
}

type StorageObjekt = { readonly pfad: string; readonly erstellt: number };

/**
 * Listet einen Bucket vollständig auf.
 *
 * Die Storage-API listet je Aufruf nur ein Verzeichnis, nicht rekursiv. Die
 * Struktur ist hier zwei Ebenen tief (`{notebook}/…` und
 * `{notebook}/extrahiert/…`), also wird sie durchlaufen.
 */
async function listeBucket(
  supabase: SupabaseClient,
  bucket: string,
): Promise<StorageObjekt[]> {
  const gefunden: StorageObjekt[] = [];

  const durchlaufe = async (prefix: string, tiefe: number): Promise<void> => {
    // Schutz gegen eine unerwartet tiefe Struktur: eine Endlosschleife in einem
    // Aufräumjob wäre besonders unangenehm.
    if (tiefe > 3) return;

    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 1_000, sortBy: { column: 'name', order: 'asc' } });

    if (error) throw new Error(`Bucket ${bucket} nicht lesbar: ${error.message}`);

    for (const eintrag of data ?? []) {
      const pfad = prefix ? `${prefix}/${eintrag.name}` : eintrag.name;
      /*
       * Verzeichnisse erkennt man daran, dass sie keine Metadaten haben — die
       * Storage-API kennt keine echten Ordner, sie leitet sie aus den Pfaden
       * ab.
       */
      if (eintrag.id === null) {
        await durchlaufe(pfad, tiefe + 1);
      } else {
        gefunden.push({
          pfad,
          erstellt: eintrag.created_at ? Date.parse(eintrag.created_at) : Date.now(),
        });
      }
    }
  };

  await durchlaufe('', 0);
  return gefunden;
}
