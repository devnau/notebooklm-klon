'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

export type ProfileResult = {
  readonly error?: string;
  readonly saved?: boolean;
  readonly fieldErrors?: Readonly<Record<string, string>>;
};

const schema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Bitte einen Namen eingeben.')
    .max(80, 'Höchstens 80 Zeichen.'),
});

export async function updateProfile(
  _prev: ProfileResult,
  formData: FormData,
): Promise<ProfileResult> {
  const parsed = schema.safeParse({ displayName: formData.get('displayName') });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { fieldErrors: { displayName: first?.message ?? 'Ungültige Eingabe.' } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/anmelden');

  // Die Policy erlaubt nur das eigene Profil; der eq-Filter ist trotzdem nötig,
  // damit ein UPDATE ohne WHERE nicht alle sichtbaren Zeilen trifft.
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: parsed.data.displayName })
    .eq('id', user.id);

  if (error) {
    return { error: 'Der Name konnte nicht gespeichert werden.' };
  }

  revalidatePath('/konto');
  revalidatePath('/notebooks');
  return { saved: true };
}
