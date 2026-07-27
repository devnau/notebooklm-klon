'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { clientEnv } from '@/lib/env';

import type { Database } from './types';

/**
 * Supabase-Client für Client Components. Verwendet den anon-Key, unterliegt
 * damit vollständig der Row Level Security.
 *
 * `createBrowserClient` gibt bei mehrfachem Aufruf dieselbe Instanz zurück,
 * ein Singleton hier ist also unnötig.
 */
export function createClient(): SupabaseClient<Database> {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = clientEnv();
  const client = createBrowserClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  verbindeRealtimeMitDerSitzung(client);
  return client;
}

/*
 * Ob der Listener schon hängt. `createBrowserClient` liefert immer dieselbe
 * Instanz, aber `createClient()` wird aus jeder Komponente gerufen — ohne diese
 * Sperre entstünden ein Dutzend Listener, die dasselbe täten.
 */
let verbunden = false;

/**
 * Gibt Realtime das Zugriffstoken des angemeldeten Nutzers.
 *
 * **Das ist nicht optional, sondern die Voraussetzung dafür, dass überhaupt
 * Ereignisse ankommen.** Realtime wertet die RLS-Policies für jeden Abonnenten
 * einzeln aus, und zwar mit den Ansprüchen aus dem Token der WebSocket-
 * Verbindung. Ohne Token verbindet sich der Browser nur mit dem anon-Key: in
 * `realtime.subscription` steht dann `role = anon` und `sub = null`, `auth.uid()`
 * ist leer, und `is_notebook_member()` gibt für jede Zeile `false` zurück.
 *
 * Das Ergebnis ist besonders unangenehm, weil es **wie Funktionieren aussieht**:
 * die Verbindung steht, es gibt keinen Fehler in der Konsole, kein
 * Netzwerkproblem, keine Meldung im Realtime-Log. Nur kommt nie ein Ereignis
 * an. In der Oberfläche heisst das: der Import läuft durch, aber die Quelle
 * bleibt auf „In der Warteschlange", bis jemand neu lädt — und genau so wurde
 * es gemeldet.
 *
 * Aufgefallen ist es erst im Browser. Die Ende-zu-Ende-Probe setzte das Token
 * von Hand, weil sie mit einem eigenen Client arbeitet; der Browser-Client tut
 * es nicht von selbst.
 */
function verbindeRealtimeMitDerSitzung(client: SupabaseClient<Database>): void {
  if (verbunden) return;
  verbunden = true;

  /*
   * `onAuthStateChange` feuert direkt nach dem Registrieren mit dem aktuellen
   * Zustand (`INITIAL_SESSION`) — ein zusätzliches `getSession()` davor wäre
   * doppelt. Danach bei jedem Wechsel: Anmelden, Abmelden und vor allem
   * `TOKEN_REFRESHED`. Letzteres ist der Grund, warum ein einmaliges Setzen
   * beim Start nicht reicht: das Token läuft nach einer Stunde ab, und ohne
   * Erneuerung verstummt die Verbindung mitten in der Sitzung.
   */
  client.auth.onAuthStateChange((_event, session) => {
    // `setAuth` ist asynchron, aber das Ergebnis interessiert nicht: schlägt es
    // fehl, bleibt die Verbindung ohne Token — und dann kommen keine Ereignisse,
    // was die Oberfläche über den Serverzustand nach dem nächsten Laden
    // ohnehin erfährt. Ein Abbruch wäre hier die schlechtere Antwort.
    void client.realtime.setAuth(session?.access_token);
  });
}
