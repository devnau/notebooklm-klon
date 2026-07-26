import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Zieladresse aller E-Mail-Links: Magic Link, Bestätigung, Passwort-Reset,
 * Einladung. GoTrue hängt `token_hash` und `type` an; hier wird der Token in
 * eine Session getauscht.
 *
 * Die Weiterleitung wird geprüft: `next` kommt aus der URL und darf deshalb nur
 * ein Pfad innerhalb der Anwendung sein. Ohne diese Prüfung ließe sich der
 * Bestätigungslink zu einer offenen Weiterleitung umbauen und für Phishing
 * verwenden — mit einer Adresse, die auf die eigene Domain zeigt.
 */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/notebooks';
  }
  return raw;
}

const ALLOWED_TYPES = [
  'magiclink',
  'signup',
  'invite',
  'recovery',
  'email_change',
  'email',
] as const satisfies readonly EmailOtpType[];

/** Typwächter statt Assertion: so ist `type` danach tatsächlich verengt. */
function isAllowedType(value: string): value is (typeof ALLOWED_TYPES)[number] {
  return (ALLOWED_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = safeNextPath(searchParams.get('next'));

  if (!tokenHash || !type || !isAllowedType(type)) {
    redirect('/anmelden?fehler=link-ungueltig');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    // Abgelaufen oder bereits verwendet — beides führt hierher.
    redirect('/anmelden?fehler=link-abgelaufen');
  }

  // Nach einem Reset-Link direkt zur Passwortänderung, nicht in die App.
  redirect(type === 'recovery' ? '/passwort-aendern' : next);
}
