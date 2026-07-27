import { z } from 'zod';

/**
 * Konfiguration des Workers.
 *
 * Wird beim Start geprüft und nicht beim ersten Job: eine fehlende Variable
 * soll den Prozess sofort beenden, nicht eine halbe Stunde später mitten in
 * einem Import.
 */
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  // Der Worker arbeitet bewusst mit service_role: er schreibt Chunks, die
  // niemand sonst schreiben darf. Damit umgeht er RLS und muss selbst prüfen,
  // was er anfasst — jeder Job trägt seine notebook_id.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  VOYAGE_API_KEY: z.string().min(10),
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  // Sprachausgabe. Beide nur für den Audio-Überblick nötig; die Vorgaben
  // zeigen auf die Dienstnamen im Docker-Netz.
  PIPER_URL: z.string().url().default('http://piper:5000'),
  KOKORO_URL: z.string().url().default('http://kokoro:8880'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  /** Erlaubt mehrere Worker: der Name landet in jobs.locked_by. */
  WORKER_ID: z.string().default(`worker-${process.pid}`),
});

export type WorkerConfig = z.infer<typeof schema>;

/**
 * Leere Werte wie nicht gesetzte behandeln.
 *
 * `.env`-Dateien enthalten typischerweise Zeilen wie `ANTHROPIC_API_KEY=` als
 * Platzhalter. Ohne diese Umwandlung wäre das ein *gesetzter* leerer String,
 * und eine als optional gedachte Variable scheiterte an der Mindestlänge — mit
 * einer Fehlermeldung, die einen Schlüssel verlangt, der gar nicht nötig ist.
 */
function blankToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = schema.safeParse({
    // Der Worker läuft im Docker-Netz und spricht das Gateway intern an, nicht
    // über die öffentliche Adresse.
    SUPABASE_URL: blankToUndefined(
      env.SUPABASE_INTERNAL_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    SUPABASE_SERVICE_ROLE_KEY: blankToUndefined(env.SUPABASE_SERVICE_ROLE_KEY),
    VOYAGE_API_KEY: blankToUndefined(env.VOYAGE_API_KEY),
    ANTHROPIC_API_KEY: blankToUndefined(env.ANTHROPIC_API_KEY),
    PIPER_URL: blankToUndefined(env.PIPER_URL),
    KOKORO_URL: blankToUndefined(env.KOKORO_URL),
    LOG_LEVEL: blankToUndefined(env.LOG_LEVEL),
    WORKER_ID: blankToUndefined(env.WORKER_ID),
  });

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Der Worker ist nicht vollständig konfiguriert:\n${missing}\n\n` +
        'Fehlt eine .env? Erzeugen mit: node scripts/generate-secrets.mjs > .env\n' +
        'VOYAGE_API_KEY und ANTHROPIC_API_KEY müssen von Hand ergänzt werden.',
    );
  }

  return parsed.data;
}
