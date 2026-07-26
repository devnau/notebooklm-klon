import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

/**
 * Läuft vor jeder Navigation: erneuert das Access-Token und schützt Routen.
 *
 * Heißt `proxy` und nicht `middleware`: Next.js 16 hat die Konvention
 * umbenannt, `middleware.ts` erzeugt eine Deprecation-Warnung.
 */
export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Alles außer statischen Dateien und Bildern. Der Session-Refresh soll bei
     * jeder Navigation laufen, aber nicht bei jedem Icon — sonst vervielfachen
     * sich die Auth-Anfragen ohne Nutzen.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon-.*|apple-touch-icon.*|brand/|illustrations/|backgrounds/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)',
  ],
};
