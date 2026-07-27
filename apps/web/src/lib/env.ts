import { z } from 'zod';

/**
 * Umgebungsvariablen werden beim ersten Zugriff validiert, nicht mitten im
 * Request. Eine fehlende Variable soll beim Start auffallen und nicht als
 * kryptischer Laufzeitfehler in einem Route Handler.
 *
 * Die Trennung ist wichtiger als sie aussieht: `clientEnv` darf ausschließlich
 * NEXT_PUBLIC_-Werte enthalten. Next.js inlined diese ins Browser-Bundle — ein
 * Secret an dieser Stelle wäre öffentlich und nicht zurückzuholen.
 */

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

const serverSchema = z.object({
  // Nur serverseitig: umgeht Row Level Security vollständig.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  VOYAGE_API_KEY: z.string().min(10).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

function fail(scope: string, error: z.ZodError): never {
  const missing = error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Ungültige ${scope}-Umgebung:\n${missing}\n\n` +
      'Fehlt eine .env? Erzeugen mit: node scripts/generate-secrets.mjs > .env',
  );
}

/**
 * Die Werte werden hier einzeln aufgeführt statt über process.env gestreut:
 * Next.js ersetzt NEXT_PUBLIC_-Zugriffe zur Build-Zeit nur bei statischer
 * Schreibweise. Ein dynamischer Zugriff wie process.env[name] ergibt im
 * Browser undefined.
 */
function readClientEnv() {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) fail('Client', parsed.error);
  return parsed.data;
}

let clientCache: z.infer<typeof clientSchema> | undefined;
let serverCache: z.infer<typeof serverSchema> | undefined;

export function clientEnv(): z.infer<typeof clientSchema> {
  clientCache ??= readClientEnv();
  return clientCache;
}

/**
 * Ein Schlüssel, der zur Laufzeit wirklich gebraucht wird.
 *
 * ANTHROPIC_API_KEY und VOYAGE_API_KEY sind im Schema optional, damit `next
 * build` ohne sie durchläuft — die CI baut die Anwendung, ohne je ein Modell
 * aufzurufen. Verlangt werden sie erst dort, wo ohne sie nichts geht, und dann
 * mit einer Meldung, die sagt, was zu tun ist.
 */
export function requireKey(name: 'ANTHROPIC_API_KEY' | 'VOYAGE_API_KEY'): string {
  const value = serverEnv()[name];
  if (!value) {
    throw new Error(
      `${name} fehlt. Der Schlüssel gehört in die .env im Projektwurzelverzeichnis ` +
        'und wird nicht ins Repository eingecheckt.',
    );
  }
  return value;
}

export function serverEnv(): z.infer<typeof serverSchema> {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() darf nicht im Browser aufgerufen werden.');
  }
  if (!serverCache) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) fail('Server', parsed.error);
    serverCache = parsed.data;
  }
  return serverCache;
}
