'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

/**
 * Auth-Formulare als Server Actions. Alle geben denselben Ergebnis-Typ zurück,
 * damit die Formulare eine einheitliche Fehleranzeige haben.
 */
export type AuthResult = {
  readonly error?: string;
  readonly notice?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
};

const emailSchema = z
  .string()
  .min(1, 'Bitte eine E-Mail-Adresse eingeben.')
  .email('Das sieht nicht wie eine E-Mail-Adresse aus.');

const passwordSchema = z
  .string()
  .min(12, 'Mindestens 12 Zeichen. Eine Passphrase aus mehreren Wörtern ist ideal.');

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Bitte das Passwort eingeben.'),
});

const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(80).optional(),
});

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in result)) {
      result[key] = issue.message;
    }
  }
  return result;
}

/**
 * Nur Pfade innerhalb der eigenen Anwendung sind als Rücksprungziel erlaubt.
 * Ohne diese Prüfung wäre `?weiter=https://fremde-seite` eine offene
 * Weiterleitung — ein klassischer Phishing-Baustein.
 */
function safeRedirectPath(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/notebooks';
  }
  return value;
}

export async function signIn(_prev: AuthResult, formData: FormData): Promise<AuthResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Bewusst dieselbe Meldung für „E-Mail unbekannt" und „Passwort falsch".
    // Alles andere verrät, welche Adressen registriert sind.
    return { error: 'E-Mail-Adresse oder Passwort stimmen nicht.' };
  }

  redirect(safeRedirectPath(formData.get('weiter')));
}

export async function signUp(_prev: AuthResult, formData: FormData): Promise<AuthResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    displayName: formData.get('displayName') || undefined,
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: parsed.data.displayName ? { display_name: parsed.data.displayName } : {},
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      return { error: 'Für diese Adresse existiert bereits ein Konto.' };
    }
    return {
      error: 'Die Registrierung ist fehlgeschlagen. Bitte später erneut versuchen.',
    };
  }

  // Ist die Bestätigung per Mail aktiv, gibt es noch keine Session.
  if (!data.session) {
    return {
      notice:
        'Fast fertig: wir haben einen Bestätigungslink an die angegebene Adresse geschickt.',
    };
  }

  redirect('/notebooks');
}

const magicLinkSchema = z.object({ email: emailSchema });

export async function sendMagicLink(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const parsed = magicLinkSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false },
  });

  // Antwort unabhängig vom Ergebnis: sonst wird das Formular zum Prüfwerkzeug,
  // mit dem sich registrierte Adressen ermitteln lassen.
  return {
    notice: 'Wenn ein Konto zu dieser Adresse existiert, ist ein Anmeldelink unterwegs.',
  };
}

export async function requestPasswordReset(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const parsed = magicLinkSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email);

  // Wie beim Magic Link: gleiche Antwort in jedem Fall, damit sich über dieses
  // Formular nicht ermitteln lässt, welche Adressen registriert sind.
  return {
    notice: 'Wenn ein Konto zu dieser Adresse existiert, ist ein Link unterwegs.',
  };
}

const changePasswordSchema = z
  .object({
    password: passwordSchema,
    passwordRepeat: z.string(),
  })
  .refine((data) => data.password === data.passwordRepeat, {
    message: 'Die beiden Passwörter stimmen nicht überein.',
    path: ['passwordRepeat'],
  });

export async function changePassword(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const parsed = changePasswordSchema.safeParse({
    password: formData.get('password'),
    passwordRepeat: formData.get('passwordRepeat'),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();

  // Der Reset-Link hat bereits eine Session erzeugt; ohne sie darf hier nichts
  // geändert werden — sonst könnte ein nicht angemeldeter Aufruf ein Passwort
  // setzen.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Der Link ist abgelaufen. Bitte einen neuen anfordern.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: 'Das Passwort konnte nicht geändert werden.' };
  }

  redirect('/notebooks');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/anmelden');
}
