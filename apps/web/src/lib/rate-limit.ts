import {
  RATE_LIMIT_ARTIFACT_PER_HOUR,
  RATE_LIMIT_AUDIO_PER_HOUR,
  RATE_LIMIT_CHAT_PER_HOUR,
  RATE_LIMIT_UPLOAD_PER_HOUR,
} from '@nlm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/supabase/types';

/**
 * Kontingente für kostenrelevante Aktionen.
 *
 * Die Zählung läuft in der Datenbank, nicht im Prozessspeicher. Ein Zähler im
 * Speicher gilt pro Prozess; sobald die Anwendung zweimal läuft — und genau
 * dafür ist sie gebaut —, hat jeder sein eigenes Limit, und aus 120 pro Stunde
 * werden 240.
 *
 * Geprüft und verbucht wird in einem Schritt (`consume_rate_limit`). Zwei
 * getrennte Aufrufe hätten ein Zeitfenster dazwischen, in dem zwei
 * gleichzeitige Anfragen beide „ja" bekommen.
 */

export type RateLimitAction = 'chat' | 'upload' | 'artifact' | 'audio';

const LIMITS: Record<RateLimitAction, number> = {
  chat: RATE_LIMIT_CHAT_PER_HOUR,
  upload: RATE_LIMIT_UPLOAD_PER_HOUR,
  artifact: RATE_LIMIT_ARTIFACT_PER_HOUR,
  audio: RATE_LIMIT_AUDIO_PER_HOUR,
};

/** Wie die Aktion in einer Meldung an den Nutzer heisst. */
const LABELS: Record<RateLimitAction, string> = {
  chat: 'Fragen',
  upload: 'Uploads',
  artifact: 'Übersichten',
  audio: 'Audio-Überblicke',
};

export type RateLimitResult =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly message: string };

export async function consumeRateLimit(
  supabase: SupabaseClient<Database>,
  action: RateLimitAction,
): Promise<RateLimitResult> {
  const limit = LIMITS[action];

  const { data, error } = await supabase.rpc('consume_rate_limit', {
    p_action: action,
    p_limit: limit,
    p_window_seconds: 3600,
  });

  if (error) {
    /*
     * Ein Fehler beim Zählen darf die Aktion nicht blockieren. Das Limit
     * schützt vor Kosten und Missbrauch, nicht vor Datenverlust — es zur
     * harten Voraussetzung zu machen hiesse, dass ein Schluckauf der Datenbank
     * den Chat abschaltet. Protokolliert wird es trotzdem.
     */
    console.warn('[rate-limit] Zählung fehlgeschlagen', { action, error: error.message });
    return { ok: true, remaining: limit };
  }

  const remaining = typeof data === 'number' ? data : limit;

  if (remaining < 0) {
    return {
      ok: false,
      message: `Das Kontingent für ${LABELS[action]} ist erschöpft (${String(limit)} pro Stunde). Bitte später erneut versuchen.`,
    };
  }

  return { ok: true, remaining };
}

/**
 * Verbucht den Verbrauch eines Modellaufrufs.
 *
 * Getrennt vom Rate-Limit, weil es eine andere Frage beantwortet: das Limit
 * fragt „darf noch?", die Erfassung „was hat es gekostet?". Ein abgelehnter
 * Aufruf taucht im Limit auf, in der Kostenerfassung nicht.
 *
 * Schlägt das Schreiben fehl, wird der Aufruf **nicht** abgebrochen. Die
 * Antwort steht bereits, das Geld ist ausgegeben — sie dem Nutzer wegen einer
 * misslungenen Buchung vorzuenthalten wäre die schlechtere von zwei
 * Möglichkeiten.
 */
export async function recordUsage(
  supabase: SupabaseClient<Database>,
  usage: {
    readonly notebookId: string | null;
    readonly userId: string | null;
    readonly kind: string;
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
  },
): Promise<void> {
  const { error } = await supabase.from('llm_usage').insert({
    notebook_id: usage.notebookId,
    user_id: usage.userId,
    kind: usage.kind,
    model: usage.model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: usage.cacheReadTokens ?? 0,
    cache_write_tokens: usage.cacheWriteTokens ?? 0,
  });

  if (error) {
    console.warn('[usage] Verbrauch nicht gespeichert', { error: error.message });
  }
}
