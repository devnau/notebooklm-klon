'use server';

import { GENERATED_ARTIFACT_KINDS } from '@nlm/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

/**
 * Notizen und Studio-Artefakte.
 *
 * Notizen schreibt der Client direkt über RLS-geschützte Tabellen — hier steht
 * nur, was zusätzlich geprüft oder aufgeräumt werden muss. Artefakte gehen über
 * `request_artifact()`, weil dabei in derselben Transaktion ein Job entstehen
 * muss und der Client `jobs` nicht beschreiben darf.
 */

export type StudioActionResult = {
  readonly error?: string;
  readonly saved?: boolean;
  readonly id?: string;
};

const uuid = z.string().uuid();

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/anmelden');
  return { supabase, user };
}

const noteSchema = z.object({
  notebookId: uuid,
  title: z.string().trim().min(1, 'Bitte einen Titel eingeben.').max(300),
  content: z
    .string()
    // Kein `.trim()`: führende Leerzeichen können in Markdown Bedeutung haben
    // (eingerückter Codeblock), und eine leere Notiz ist zulässig — man legt
    // sie an und schreibt später.
    .max(200_000, 'Die Notiz ist zu lang.'),
});

export async function createNote(
  _prev: StudioActionResult,
  formData: FormData,
): Promise<StudioActionResult> {
  const parsed = noteSchema.safeParse({
    notebookId: formData.get('notebookId'),
    title: formData.get('title'),
    content: formData.get('content') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.' };
  }

  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('notes')
    .insert({
      notebook_id: parsed.data.notebookId,
      title: parsed.data.title,
      content: parsed.data.content,
      kind: 'user',
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !data) return { error: 'Die Notiz konnte nicht angelegt werden.' };

  revalidatePath(`/notebooks/${parsed.data.notebookId}`);
  return { saved: true, id: data.id };
}

export async function updateNote(
  noteId: string,
  notebookId: string,
  patch: { title?: string; content?: string },
): Promise<StudioActionResult> {
  if (!uuid.safeParse(noteId).success) return { error: 'Ungültige Angabe.' };

  // Als konkretes Objekt statt Record<string, string>: die generierten Typen
  // lehnen unbekannte Spalten ab, und genau das ist gewollt — ein Tippfehler im
  // Feldnamen soll auffallen und nicht still ins Leere laufen.
  const fields: { title?: string; content?: string } = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0) return { error: 'Der Titel darf nicht leer sein.' };
    if (title.length > 300) return { error: 'Der Titel ist zu lang.' };
    fields.title = title;
  }
  if (patch.content !== undefined) {
    if (patch.content.length > 200_000) return { error: 'Die Notiz ist zu lang.' };
    fields.content = patch.content;
  }
  if (Object.keys(fields).length === 0) return { saved: true };

  const { supabase } = await requireUser();
  const { error } = await supabase.from('notes').update(fields).eq('id', noteId);

  if (error) return { error: 'Die Notiz konnte nicht gespeichert werden.' };

  revalidatePath(`/notebooks/${notebookId}`);
  return { saved: true };
}

export async function deleteNote(
  noteId: string,
  notebookId: string,
): Promise<StudioActionResult> {
  if (!uuid.safeParse(noteId).success) return { error: 'Ungültige Angabe.' };

  const { supabase } = await requireUser();
  const { error } = await supabase.from('notes').delete().eq('id', noteId);

  if (error) return { error: 'Die Notiz konnte nicht gelöscht werden.' };

  revalidatePath(`/notebooks/${notebookId}`);
  return { saved: true };
}

/**
 * Übernimmt eine Antwort aus dem Chat als Notiz.
 *
 * Die Zitate wandern mit. Ohne sie wäre die Notiz eine Behauptung ohne
 * Herkunft — und genau das unterscheidet diese Anwendung von einem
 * Textverarbeitungsprogramm mit Chatfenster. Sie werden aus der Nachricht
 * gelesen und nicht vom Client mitgeschickt: was gespeichert wurde, ist die
 * Wahrheit, nicht was der Browser gerade anzeigt.
 */
export async function saveAnswerAsNote(
  messageId: number,
  notebookId: string,
): Promise<StudioActionResult> {
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return { error: 'Ungültige Angabe.' };
  }

  const { supabase, user } = await requireUser();

  const { data: message } = await supabase
    .from('messages')
    .select('id, content, citations, notebook_id, role')
    .eq('id', messageId)
    .maybeSingle();

  if (!message) return { error: 'Diese Antwort gibt es nicht mehr.' };
  if (message.role !== 'assistant') {
    return { error: 'Nur Antworten lassen sich als Notiz speichern.' };
  }

  const { data, error } = await supabase
    .from('notes')
    .insert({
      notebook_id: message.notebook_id,
      title: deriveTitle(message.content),
      content: message.content,
      kind: 'generated',
      citations: message.citations,
      source_message_id: message.id,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !data) return { error: 'Die Notiz konnte nicht angelegt werden.' };

  revalidatePath(`/notebooks/${notebookId}`);
  return { saved: true, id: data.id };
}

/** Erster Satz oder erste Zeile als Titel — was zuerst endet. */
function deriveTitle(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0) ?? 'Notiz';
  const cleaned = firstLine
    // Zitatmarker gehören nicht in einen Titel.
    .replace(/\[S\d{1,3}:\d{1,5}\]/g, '')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) return 'Notiz';
  if (cleaned.length <= 80) return cleaned;
  const cut = cleaned.slice(0, 80);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`;
}

/** Stösst die Erzeugung eines Artefakts an oder frischt es auf. */
export async function requestArtifact(
  notebookId: string,
  kind: string,
): Promise<StudioActionResult> {
  if (!uuid.safeParse(notebookId).success) return { error: 'Ungültige Angabe.' };
  if (!GENERATED_ARTIFACT_KINDS.includes(kind as never)) {
    return { error: 'Diese Art von Übersicht gibt es nicht.' };
  }

  const { supabase } = await requireUser();

  // Berechtigung und Vorbedingungen prüft die Funktion selbst — sie läuft als
  // `security definer` und kann sich nicht auf RLS verlassen.
  const { data, error } = await supabase.rpc('request_artifact', {
    p_notebook: notebookId,
    p_kind: kind,
  });

  if (error) {
    /*
     * Die Funktion wirft mit sprechenden SQLSTATEs. Sie hier zu übersetzen ist
     * genauer als eine Sammelmeldung: „keine Quelle vorhanden" ist etwas
     * anderes als „keine Berechtigung", und der Nutzer kann beim ersten Fall
     * etwas tun.
     */
    const message =
      error.code === '22023'
        ? 'Für dieses Notizbuch ist noch keine Quelle verarbeitet.'
        : error.code === '42501'
          ? 'Dazu fehlt die Berechtigung.'
          : 'Die Übersicht konnte nicht angefordert werden.';
    return { error: message };
  }

  revalidatePath(`/notebooks/${notebookId}`);
  return typeof data === 'string' ? { saved: true, id: data } : { saved: true };
}

export async function deleteArtifact(
  artifactId: string,
  notebookId: string,
): Promise<StudioActionResult> {
  if (!uuid.safeParse(artifactId).success) return { error: 'Ungültige Angabe.' };

  const { supabase } = await requireUser();
  const { error } = await supabase.from('artifacts').delete().eq('id', artifactId);

  if (error) return { error: 'Die Übersicht konnte nicht gelöscht werden.' };

  revalidatePath(`/notebooks/${notebookId}`);
  return { saved: true };
}
