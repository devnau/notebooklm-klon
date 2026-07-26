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
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  /** Erlaubt mehrere Worker: der Name landet in jobs.locked_by. */
  WORKER_ID: z.string().default(`worker-${process.pid}`),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = schema.safeParse({
    // Der Worker läuft im Docker-Netz und spricht das Gateway intern an, nicht
    // über die öffentliche Adresse.
    SUPABASE_URL: env.SUPABASE_INTERNAL_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    VOYAGE_API_KEY: env.VOYAGE_API_KEY,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    LOG_LEVEL: env.LOG_LEVEL,
    WORKER_ID: env.WORKER_ID,
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
