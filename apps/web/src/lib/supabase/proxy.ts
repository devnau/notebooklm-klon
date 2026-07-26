import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { clientEnv } from '@/lib/env';

import type { Database } from './types';

/** Routen, die ohne Anmeldung erreichbar sind. */
const PUBLIC_PATHS = ['/anmelden', '/registrieren', '/passwort-vergessen', '/auth'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Erneuert das Access-Token bei jedem Request und schützt Routen.
 *
 * Zwei Punkte, die hier leicht falsch gemacht werden:
 *
 *  1. Es muss `getUser()` sein, nicht `getSession()`. `getSession()` liest das
 *     Token nur aus dem Cookie, ohne die Signatur zu prüfen — ein Angreifer
 *     könnte ein Cookie mit beliebiger Nutzer-ID setzen. `getUser()` lässt den
 *     Auth-Server verifizieren.
 *
 *  2. Die Cookies müssen sowohl auf dem Request- als auch auf dem
 *     Response-Objekt gesetzt werden. Nur am Response gesetzt, sehen
 *     nachgelagerte Server Components im selben Request noch das alte Token.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = clientEnv();

  const supabase = createServerClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // Nicht angemeldet und geschützte Route: zur Anmeldung, mit Rücksprungziel.
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/anmelden';
    url.search = '';
    if (pathname !== '/') {
      url.searchParams.set('weiter', `${pathname}${search}`);
    }
    return NextResponse.redirect(url);
  }

  // Angemeldet und auf einer Anmeldeseite: weiter zur App.
  if (user && (pathname === '/anmelden' || pathname === '/registrieren')) {
    const url = request.nextUrl.clone();
    url.pathname = '/notebooks';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
