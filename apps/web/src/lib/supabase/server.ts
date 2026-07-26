import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { clientEnv, serverEnv } from '@/lib/env';

import type { Database } from './types';

/**
 * Supabase-Client für Server Components, Server Actions und Route Handler.
 * Liest die Session aus den Cookies und arbeitet mit den Rechten des
 * angemeldeten Nutzers — es gilt also die Row Level Security.
 *
 * Muss pro Request neu erzeugt werden. Ein Modul-Singleton würde die Session
 * eines Nutzers an den nächsten Request weitergeben.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = clientEnv();

  return createServerClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // In Server Components ist das Setzen von Cookies nicht erlaubt.
            // Das ist kein Fehler: die Middleware erneuert die Session, hier
            // wird nur gelesen. Ohne dieses catch würde jede Server Component
            // mit abgelaufenem Token abbrechen.
          }
        },
      },
    },
  );
}

/**
 * Client mit service_role — **umgeht RLS vollständig**.
 *
 * Nur für Vorgänge, die es zwingend brauchen: der Job-Worker und
 * administrative Aufgaben. Jeder Aufruf muss vorher selbst prüfen, ob der
 * anfragende Nutzer berechtigt ist, denn die Datenbank tut es hier nicht mehr.
 *
 * Niemals aus einer Client Component importieren.
 */
export function createServiceClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = clientEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createServerClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      // Bewusst leer: dieser Client hat keine Nutzersession und darf auch
      // keine bekommen. Ein Cookie hier würde bedeuten, dass die
      // service_role an einen Nutzerkontext gebunden wird.
      getAll: () => [],
      setAll: () => undefined,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
