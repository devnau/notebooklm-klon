import { JOB_LEASE_SECONDS } from '@nlm/shared';
import { NextResponse } from 'next/server';

import { createServiceClient } from '@/lib/supabase/server';

/**
 * Betriebszustand der Anwendung.
 *
 * Prüft nicht, ob der Prozess läuft — das weiss Docker ohnehin —, sondern ob
 * er seine Arbeit tun kann: Datenbank erreichbar, Storage erreichbar, Worker
 * am Leben, Warteschlange nicht verstopft.
 *
 * **Was hier steht, ist absichtlich dürftig.** Der Endpunkt ist ohne
 * Anmeldung erreichbar, weil ein Healthcheck im Container keine Sitzung hat.
 * Er verrät deshalb keine Versionsnummern, keine Zählerstände von Nutzern und
 * keine Fehlermeldungen aus der Datenbank — nur je Baustein „ok" oder nicht.
 * Wer Details braucht, schaut ins Log.
 */

export const runtime = 'nodejs';
/** Immer frisch. Ein zwischengespeicherter Healthcheck ist keiner. */
export const dynamic = 'force-dynamic';

type ComponentState = 'ok' | 'fehler';

type Health = {
  readonly status: 'ok' | 'beeintraechtigt';
  readonly datenbank: ComponentState;
  readonly storage: ComponentState;
  readonly worker: ComponentState | 'unbekannt';
  readonly warteschlange: { readonly offen: number; readonly haengend: number };
};

/**
 * Ab wann ein Rückstau als Problem gilt.
 *
 * Nicht null: ein paar wartende Jobs sind der Normalfall, wenn gerade jemand
 * fünf Dateien hochgeladen hat. Erst eine dauerhaft volle Warteschlange
 * bedeutet, dass niemand sie abarbeitet.
 */
const BACKLOG_WARNUNG = 25;

export async function GET(): Promise<Response> {
  const supabase = createServiceClient();

  const [datenbank, storage, warteschlange] = await Promise.all([
    pruefeDatenbank(supabase),
    pruefeStorage(supabase),
    pruefeWarteschlange(supabase),
  ]);

  /*
   * Der Worker hört auf keinem Port; ob er lebt, lässt sich nur an seiner
   * Arbeit ablesen. „Kein Job in Bearbeitung und keiner hängt" ist kein
   * Fehler — es kann schlicht nichts zu tun geben. Deshalb `unbekannt` statt
   * einer erfundenen Aussage.
   */
  const worker: ComponentState | 'unbekannt' =
    warteschlange.haengend > 0
      ? 'fehler'
      : warteschlange.offen > BACKLOG_WARNUNG
        ? 'fehler'
        : 'unbekannt';

  const health: Health = {
    status:
      datenbank === 'ok' && storage === 'ok' && worker !== 'fehler'
        ? 'ok'
        : 'beeintraechtigt',
    datenbank,
    storage,
    worker,
    warteschlange,
  };

  /*
   * 503 statt 200 mit Fehlerfeld: ein Healthcheck wird von Werkzeugen
   * ausgewertet, die nur den Statuscode ansehen — Docker, Uptime-Prüfer,
   * Lastverteiler. Ein „alles kaputt" mit Status 200 sähe für sie gesund aus.
   */
  return NextResponse.json(health, {
    status: health.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function pruefeDatenbank(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<ComponentState> {
  try {
    // Eine Zeile zählen, keine lesen: die Abfrage soll billig sein und darf
    // nichts zurückgeben, was in ein Protokoll geraten könnte.
    const { error } = await supabase
      .from('notebooks')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    return error ? 'fehler' : 'ok';
  } catch {
    return 'fehler';
  }
}

async function pruefeStorage(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<ComponentState> {
  try {
    const { error } = await supabase.storage.from('sources').list('', { limit: 1 });
    return error ? 'fehler' : 'ok';
  } catch {
    return 'fehler';
  }
}

async function pruefeWarteschlange(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<{ offen: number; haengend: number }> {
  try {
    const [offen, haengend] = await Promise.all([
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'queued'),
      /*
       * „Hängend" heisst: seit mehr als der Lease in Bearbeitung. Entweder ist
       * der Worker mitten in der Arbeit gestorben, oder er kommt nicht durch.
       * `requeue_stale_jobs()` räumt das auf — dass es überhaupt vorkommt,
       * gehört trotzdem gemeldet.
       */
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'running')
        .lt('locked_at', new Date(Date.now() - JOB_LEASE_SECONDS * 1000).toISOString()),
    ]);

    return { offen: offen.count ?? 0, haengend: haengend.count ?? 0 };
  } catch {
    return { offen: 0, haengend: 0 };
  }
}
