'use server';

import { languageSchema } from '@nlm/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

export type NotebookActionResult = {
  readonly error?: string;
  /** Signalisiert dem Dialog, dass er schließen kann. */
  readonly saved?: boolean;
  readonly fieldErrors?: Readonly<Record<string, string>>;
};

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Bitte einen Titel eingeben.')
  .max(200, 'Höchstens 200 Zeichen.');

const createSchema = z.object({
  title: titleSchema,
  emoji: z.string().trim().max(8).optional(),
  language: languageSchema.default('de'),
});

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in result)) result[key] = issue.message;
  }
  return result;
}

/**
 * Alle Aktionen hier verlassen sich auf Row Level Security. Sie prüfen nur, ob
 * überhaupt eine Session existiert — ob *dieser* Nutzer *dieses* Notebook
 * ändern darf, entscheidet die Datenbank. Eine zweite Prüfung hier wäre eine
 * zweite Wahrheit, die auseinanderlaufen kann.
 */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/anmelden');
  return { supabase, user };
}

export async function createNotebook(
  _prev: NotebookActionResult,
  formData: FormData,
): Promise<NotebookActionResult> {
  const parsed = createSchema.safeParse({
    title: formData.get('title'),
    emoji: formData.get('emoji') || undefined,
    language: formData.get('language') || 'de',
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from('notebooks')
    .insert({
      title: parsed.data.title,
      // Der Insert setzt owner_id explizit: die Policy verlangt
      // owner_id = auth.uid(), ein Default in der Tabelle gibt es bewusst nicht.
      owner_id: user.id,
      language: parsed.data.language,
      ...(parsed.data.emoji ? { emoji: parsed.data.emoji } : {}),
    })
    .select('id')
    .single();

  if (error || !data) {
    return { error: 'Das Notebook konnte nicht angelegt werden.' };
  }

  revalidatePath('/notebooks');
  redirect(`/notebooks/${data.id}`);
}

const renameSchema = z.object({
  id: z.string().uuid(),
  title: titleSchema,
  emoji: z.string().trim().max(8).optional(),
});

export async function renameNotebook(
  _prev: NotebookActionResult,
  formData: FormData,
): Promise<NotebookActionResult> {
  const parsed = renameSchema.safeParse({
    id: formData.get('id'),
    title: formData.get('title'),
    emoji: formData.get('emoji') || undefined,
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from('notebooks')
    .update({
      title: parsed.data.title,
      ...(parsed.data.emoji ? { emoji: parsed.data.emoji } : {}),
    })
    .eq('id', parsed.data.id)
    .select('id');

  if (error) {
    return { error: 'Die Änderung konnte nicht gespeichert werden.' };
  }
  // Kein Fehler, aber keine getroffene Zeile: die Policy hat es verhindert.
  // PostgREST meldet in diesem Fall keinen Fehler, sondern ein leeres Ergebnis.
  if (data.length === 0) {
    return { error: 'Dafür fehlen dir die Rechte.' };
  }

  revalidatePath('/notebooks');
  revalidatePath(`/notebooks/${parsed.data.id}`);
  return { saved: true };
}

export async function deleteNotebook(formData: FormData): Promise<void> {
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;

  const { supabase } = await requireUser();
  await supabase.from('notebooks').delete().eq('id', id.data);

  revalidatePath('/notebooks');
  redirect('/notebooks');
}
