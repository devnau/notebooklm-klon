'use server';

import {
  BUCKET_SOURCES,
  checkUrl,
  MAX_SOURCES_PER_NOTEBOOK,
  MAX_UPLOAD_BYTES,
  sourceKindSchema,
  type SourceKind,
} from '@nlm/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

/**
 * Aktionen rund um Quellen.
 *
 * Der Upload läuft **nicht** durch diese Actions: der Browser lädt direkt in
 * den Storage-Bucket, geschützt durch dieselbe RLS wie alles andere. Eine
 * 50-MB-Datei durch eine Server Action zu schieben hieße, sie zweimal komplett
 * im Speicher zu halten (einmal im Next-Prozess, einmal beim Weiterreichen) und
 * das Limit für Server Actions hochzudrehen — für nichts, denn geprüft wird die
 * Datei ohnehin an der einzigen Stelle, die zählt: im Worker, an den echten
 * Bytes.
 *
 * Diese Datei legt danach die Zeile in `sources` an. Der Datenbank-Trigger
 * `sources_enqueue_ingest` erzeugt in derselben Transaktion den Job — es kann
 * also keine Quelle geben, zu der nie etwas passiert.
 */

export type SourceActionResult = {
  readonly error?: string;
  readonly saved?: boolean;
  readonly sourceId?: string;
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/anmelden');
  return { supabase, user };
}

/**
 * Gegen versehentliche und absichtliche Massenimporte. Die Grenze steht in
 * `packages/shared`, damit die UI denselben Wert anzeigt, den der Server
 * durchsetzt.
 */
async function assertRoomForMoreSources(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notebookId: string,
): Promise<string | null> {
  const { count, error } = await supabase
    .from('sources')
    .select('id', { count: 'exact', head: true })
    .eq('notebook_id', notebookId);

  if (error) return 'Die vorhandenen Quellen ließen sich nicht zählen.';
  if ((count ?? 0) >= MAX_SOURCES_PER_NOTEBOOK) {
    return `Dieses Notebook hat bereits ${String(MAX_SOURCES_PER_NOTEBOOK)} Quellen. Bitte zuerst eine löschen.`;
  }
  return null;
}

const uuid = z.string().uuid();

const registerSchema = z.object({
  notebookId: uuid,
  storagePath: z.string().min(1).max(500),
  kind: sourceKindSchema,
  title: z.string().trim().min(1).max(500),
  byteSize: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  mimeType: z.string().max(200).optional(),
});

/**
 * Verbucht eine bereits hochgeladene Datei als Quelle.
 *
 * Der Pfad wird nicht geglaubt, sondern gegen das erwartete Muster geprüft:
 * `{notebookId}/{dateiname}`. Ohne diese Prüfung könnte jemand eine Datei aus
 * einem *anderen* Notebook, in dem er Mitglied ist, hier als Quelle eintragen —
 * die Storage-Policy erlaubt ihm das Lesen dort ja. Der Worker würde sie dann
 * in dieses Notebook indexieren.
 */
export async function registerUploadedSource(input: unknown): Promise<SourceActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { error: 'Die Angaben zur Datei sind unvollständig.' };

  const { notebookId, storagePath, kind, title, byteSize, mimeType } = parsed.data;

  if (!storagePath.startsWith(`${notebookId}/`) || storagePath.includes('..')) {
    return { error: 'Der Speicherort passt nicht zu diesem Notebook.' };
  }

  const { supabase, user } = await requireUser();

  const full = await assertRoomForMoreSources(supabase, notebookId);
  if (full) return { error: full };

  const { data, error } = await supabase
    .from('sources')
    .insert({
      notebook_id: notebookId,
      kind,
      title,
      storage_path: storagePath,
      byte_size: byteSize,
      mime_type: mimeType ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    /*
     * Der Insert kann an RLS scheitern, obwohl der Upload durchging: der
     * Nutzer könnte in der Zwischenzeit zum viewer herabgestuft worden sein.
     * Dann liegt eine verwaiste Datei im Bucket. Sie hier zu löschen ist ein
     * Versuch, keine Garantie — deshalb räumt zusätzlich ein Wartungsjob auf
     * (docs/operations.md).
     */
    await supabase.storage.from(BUCKET_SOURCES).remove([storagePath]);
    return { error: 'Die Quelle konnte nicht angelegt werden.' };
  }

  revalidatePath(`/notebooks/${notebookId}`);
  return { saved: true, sourceId: data.id };
}

const urlSchema = z.object({
  notebookId: uuid,
  url: z.string().trim().min(1, 'Bitte eine Adresse eingeben.'),
});

/** Import einer Webseite. Der Abruf selbst passiert im Worker, nicht hier. */
export async function addUrlSource(
  _prev: SourceActionResult,
  formData: FormData,
): Promise<SourceActionResult> {
  const parsed = urlSchema.safeParse({
    notebookId: formData.get('notebookId'),
    url: formData.get('url'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  }

  /*
   * Die SSRF-Prüfung läuft hier ohne DNS-Auflösung — sie fängt die offenkundig
   * unzulässigen Adressen ab, damit der Nutzer sofort eine Rückmeldung bekommt.
   * Verbindlich ist die zweite Stufe im Worker: dort wird jede aufgelöste
   * IP-Adresse geprüft, auch nach jedem Redirect. Eine Prüfung allein an dieser
   * Stelle wäre wertlos, weil ein Name zwischen Prüfung und Abruf auf eine
   * andere Adresse zeigen kann.
   */
  const verdict = checkUrl(parsed.data.url);
  if (!verdict.ok) return { error: verdict.detail };

  const { supabase, user } = await requireUser();

  const full = await assertRoomForMoreSources(supabase, parsed.data.notebookId);
  if (full) return { error: full };

  const { data, error } = await supabase
    .from('sources')
    .insert({
      notebook_id: parsed.data.notebookId,
      kind: 'url' satisfies SourceKind,
      // Vorläufiger Titel: der Worker ersetzt ihn durch den Seitentitel,
      // sobald er die Seite gelesen hat. Bis dahin steht etwas Sinnvolles da.
      title: verdict.url.hostname,
      source_url: verdict.url.toString(),
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !data) return { error: 'Die Adresse konnte nicht gespeichert werden.' };

  revalidatePath(`/notebooks/${parsed.data.notebookId}`);
  return { saved: true, sourceId: data.id };
}

const pasteSchema = z.object({
  notebookId: uuid,
  title: z.string().trim().min(1, 'Bitte einen Titel eingeben.').max(500),
  text: z
    .string()
    .trim()
    .min(1, 'Bitte einen Text einfügen.')
    // Eingefügter Text geht durch den Request-Body; ein Roman gehört als Datei
    // hochgeladen, nicht in ein Textfeld.
    .max(500_000, 'Der Text ist zu lang. Bitte als Datei hochladen.'),
});

/** Direkt eingefügter Text. */
export async function addPasteSource(
  _prev: SourceActionResult,
  formData: FormData,
): Promise<SourceActionResult> {
  const parsed = pasteSchema.safeParse({
    notebookId: formData.get('notebookId'),
    title: formData.get('title'),
    text: formData.get('text'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  }

  const { supabase, user } = await requireUser();
  const { notebookId, title, text } = parsed.data;

  const full = await assertRoomForMoreSources(supabase, notebookId);
  if (full) return { error: full };

  /*
   * Eingefügter Text landet trotzdem im Storage, nicht in einer Textspalte.
   * Damit hat der Worker für jede Quellenart denselben Weg — laden, extrahieren,
   * zerlegen — statt einer Sonderbehandlung, die beim nächsten Feature vergessen
   * wird.
   */
  const storagePath = `${notebookId}/${crypto.randomUUID()}.txt`;
  const bytes = new TextEncoder().encode(text);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_SOURCES)
    .upload(storagePath, bytes, {
      // Ohne charset-Parameter: der Bucket vergleicht den Content-Type als
      // ganze Zeichenkette gegen seine Positivliste.
      contentType: 'text/plain',
    });

  if (uploadError) return { error: 'Der Text konnte nicht gespeichert werden.' };

  const { data, error } = await supabase
    .from('sources')
    .insert({
      notebook_id: notebookId,
      kind: 'paste' satisfies SourceKind,
      title,
      storage_path: storagePath,
      byte_size: bytes.byteLength,
      mime_type: 'text/plain',
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    await supabase.storage.from(BUCKET_SOURCES).remove([storagePath]);
    return { error: 'Die Quelle konnte nicht angelegt werden.' };
  }

  revalidatePath(`/notebooks/${notebookId}`);
  return { saved: true, sourceId: data.id };
}

/**
 * Löscht eine Quelle samt Datei.
 *
 * Chunks und Jobs hängen per `on delete cascade` daran. Die Datei im Storage
 * nicht — Storage kennt die Fremdschlüssel der Anwendung nicht —, deshalb wird
 * sie hier ausdrücklich entfernt.
 */
export async function deleteSource(
  notebookId: string,
  sourceId: string,
): Promise<SourceActionResult> {
  if (!uuid.safeParse(sourceId).success || !uuid.safeParse(notebookId).success) {
    return { error: 'Ungültige Angabe.' };
  }

  const { supabase } = await requireUser();

  const { data: source } = await supabase
    .from('sources')
    .select('storage_path, text_path')
    .eq('id', sourceId)
    .maybeSingle();

  const { error } = await supabase.from('sources').delete().eq('id', sourceId);
  if (error) return { error: 'Die Quelle konnte nicht gelöscht werden.' };

  // Erst nach dem erfolgreichen Löschen der Zeile: bliebe die Zeile stehen und
  // die Datei wäre weg, zeigte die UI eine Quelle, die nirgends mehr existiert.
  // Beide Dateien — Original und extrahierter Text —, sonst bleibt Müll im
  // Bucket zurück, den niemand mehr zuordnen kann.
  const paths = [source?.storage_path, source?.text_path].filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  );
  if (paths.length > 0) {
    await supabase.storage.from(BUCKET_SOURCES).remove(paths);
  }

  revalidatePath(`/notebooks/${notebookId}`);
  return { saved: true };
}

/** Wiederholt den Import einer fehlgeschlagenen Quelle. */
export async function retrySource(
  notebookId: string,
  sourceId: string,
): Promise<SourceActionResult> {
  if (!uuid.safeParse(sourceId).success) return { error: 'Ungültige Angabe.' };

  const { supabase } = await requireUser();

  // Die Rechteprüfung steckt in der Funktion selbst — sie läuft als
  // `security definer` und kann sich deshalb nicht auf RLS verlassen.
  const { error } = await supabase.rpc('retry_source', { p_source_id: sourceId });

  if (error) return { error: 'Der erneute Versuch konnte nicht gestartet werden.' };

  revalidatePath(`/notebooks/${notebookId}`);
  return { saved: true };
}

/**
 * Kurzlebige Adresse auf den extrahierten Volltext einer Quelle.
 *
 * Signierte URL statt Text im Rückgabewert: ein Dokument kann Megabyte groß
 * sein, und das durch eine Server Action zu schieben hieße, es komplett im
 * Speicher des Anwendungsservers zu halten, bevor der Browser das erste Zeichen
 * sieht. So lädt der Browser direkt aus dem Storage.
 *
 * 120 Sekunden Gültigkeit. Länger hieße: wer die URL einmal abgreift, kommt
 * auch später noch an das Dokument — ohne dass ein Entzug der Mitgliedschaft
 * daran etwas ändert. Kürzer wäre bei langsamer Verbindung zu knapp.
 */
export async function createSourceTextUrl(
  sourceId: string,
): Promise<{ url?: string; error?: string }> {
  if (!uuid.safeParse(sourceId).success) return { error: 'Ungültige Angabe.' };

  const { supabase } = await requireUser();

  const { data: source } = await supabase
    .from('sources')
    .select('text_path, status')
    .eq('id', sourceId)
    .maybeSingle();

  if (!source) return { error: 'Diese Quelle gibt es nicht.' };
  if (!source.text_path) {
    return {
      error:
        source.status === 'ready'
          ? 'Zu dieser Quelle liegt kein Text vor.'
          : 'Die Quelle wird noch verarbeitet.',
    };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET_SOURCES)
    .createSignedUrl(source.text_path, 120);

  if (error || !data) return { error: 'Der Text ließ sich nicht öffnen.' };
  return { url: data.signedUrl };
}
