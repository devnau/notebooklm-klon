'use client';

import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { createClient } from './client';

/**
 * Abonniert Änderungen an einer Tabelle — mit dem Token des Nutzers.
 *
 * **Warum es diese Hülle gibt.** Realtime wertet die RLS-Policies für jeden
 * Abonnenten einzeln aus, und zwar mit den Ansprüchen aus dem Token, das beim
 * *Abonnieren* gilt. Wer zu früh abonniert, wird als `anon` registriert:
 * `auth.uid()` ist dann leer, `is_notebook_member()` gibt für jede Zeile
 * `false` zurück, und es kommt nie ein Ereignis.
 *
 * Genau das war der Fall. Der Browser-Client lädt seine Sitzung aus Cookies,
 * und das ist asynchron — ein `subscribe()` direkt im Effekt läuft davor. In
 * `realtime.subscription` stand deshalb `role = anon` und `sub = null`.
 *
 * Das Ergebnis sieht **wie Funktionieren aus**: die WebSocket-Verbindung steht,
 * kein Fehler in der Konsole, keine Meldung im Realtime-Log. Nur bleibt die
 * Oberfläche stehen, bis jemand neu lädt. Deshalb wird hier zuerst die Sitzung
 * abgewartet, dann das Token gesetzt, dann abonniert — in dieser Reihenfolge.
 *
 * @returns Aufräumfunktion für den Effekt. Sie greift auch, wenn der Aufruf
 *   noch mitten im Warten auf die Sitzung steckt.
 */
export function subscribeToTable<Row extends Record<string, unknown>>({
  table,
  notebookId,
  onChange,
}: {
  readonly table: 'sources' | 'artifacts' | 'notes' | 'messages';
  readonly notebookId: string;
  readonly onChange: (payload: RealtimePostgresChangesPayload<Row>) => void;
}): () => void {
  const supabase = createClient();
  let abgebrochen = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  void (async () => {
    const { data } = await supabase.auth.getSession();
    if (abgebrochen) return;

    /*
     * Ohne Sitzung gar nicht abonnieren. Ein Abo als `anon` bekäme ohnehin
     * nichts zu sehen — es zu eröffnen würde nur eine Verbindung offen halten
     * und den Eindruck erzeugen, es sei eines.
     */
    if (!data.session) return;

    await supabase.realtime.setAuth(data.session.access_token);
    if (abgebrochen) return;

    /*
     * Der Kanalname bekommt eine Zufallskomponente. `supabase.channel()` gibt
     * bei gleichem Namen dieselbe Instanz zurück, und React ruft Effekte im
     * Strict Mode zweimal auf — der zweite Durchlauf träfe auf einen bereits
     * abonnierten Kanal, auf dem `.on()` nicht mehr erlaubt ist.
     *
     * Der Name ist ohnehin nur ein lokaler Bezeichner; welche Zeilen jemand zu
     * sehen bekommt, entscheidet die RLS-Policy, nicht der Name.
     */
    channel = supabase
      .channel(`${table}:${notebookId}:${crypto.randomUUID()}`)
      .on<Row>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `notebook_id=eq.${notebookId}`,
        },
        onChange,
      )
      .subscribe();
  })();

  return () => {
    abgebrochen = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
