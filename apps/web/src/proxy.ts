import type { NextRequest } from 'next/server';

import { clientEnv } from '@/lib/env';
import { contentSecurityPolicy, createNonce } from '@/lib/security-headers';
import { updateSession } from '@/lib/supabase/proxy';

/**
 * Läuft vor jeder Navigation: erneuert das Access-Token, setzt die
 * Content-Security-Policy und schützt Routen.
 *
 * Heißt `proxy` und nicht `middleware`: Next.js 16 hat die Konvention
 * umbenannt, `middleware.ts` erzeugt eine Deprecation-Warnung.
 */
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const origin = new URL(clientEnv().NEXT_PUBLIC_SUPABASE_URL).origin;
  const csp = contentSecurityPolicy(nonce, origin);

  /*
   * Der Header muss an der *Anfrage* hängen, damit Next den Nonce findet und
   * an seine eigenen Skript-Elemente schreibt. Steht er nur an der Antwort,
   * blockiert der Browser die Hydration — die Seite erscheint, reagiert aber
   * auf nichts.
   */
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);

  const response = await updateSession(request, headers);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Alles außer statischen Dateien, Bildern und dem Health-Endpunkt.
     *
     * Der Session-Refresh soll bei jeder Navigation laufen, aber nicht bei
     * jedem Icon — sonst vervielfachen sich die Auth-Anfragen ohne Nutzen.
     *
     * `api/health` muss draussen bleiben, weil der Healthcheck im Container
     * keine Sitzung hat: der Proxy leitete ihn zur Anmeldung um, der Check
     * bekäme eine 307 und meldete den Container als krank. Gefunden beim ersten
     * echten Start des Images — im Dev-Betrieb ruft niemand /api/health auf.
     */
    '/((?!_next/static|_next/image|api/health|favicon.ico|icon-.*|apple-touch-icon.*|brand/|illustrations/|backgrounds/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)',
  ],
};
