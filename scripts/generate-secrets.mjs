#!/usr/bin/env node
/**
 * Erzeugt alle Secrets für eine .env: Postgres-Passwort, JWT-Secret und die
 * beiden Supabase-Schlüssel (anon, service_role).
 *
 * Beim Self-Hosting sind anon/service_role keine zufälligen Strings, sondern
 * JWTs, die mit dem JWT_SECRET signiert sind — PostgREST und Storage prüfen die
 * Signatur. Manuell zusammengebaut ist das eine typische Fehlerquelle, deshalb
 * dieses Skript. Ohne Abhängigkeiten, nur node:crypto.
 *
 * Aufruf:  node scripts/generate-secrets.mjs > .env
 */

import { createHmac, randomBytes } from 'node:crypto';

/** ~10 Jahre. Ein rotierender Schlüssel wäre hier nur Reibung ohne Gewinn: */
/** wer ihn kompromittiert, ändert das JWT_SECRET und generiert beide neu.    */
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 365 * 10;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function supabaseKey(role, secret) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      role,
      iss: 'supabase',
      iat: issuedAt,
      exp: issuedAt + TOKEN_LIFETIME_SECONDS,
    },
    secret,
  );
}

/** Passwortsicheres Alphabet ohne Zeichen, die in URLs oder Shells stören. */
function password(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

const jwtSecret = randomBytes(48).toString('hex');
const postgresPassword = password(24);
const anonKey = supabaseKey('anon', jwtSecret);
const serviceRoleKey = supabaseKey('service_role', jwtSecret);
/*
 * Realtime verschlüsselt die Tenant-Zugangsdaten in seiner eigenen Tabelle mit
 * DB_ENC_KEY. Die Länge ist nicht frei wählbar: der Dienst erwartet exakt
 * 16 Zeichen (AES-128) und startet sonst nicht.
 */
const realtimeEncKey = randomBytes(8).toString('hex');
/** Phoenix signiert damit Session-Cookies; 64 Zeichen sind das Minimum. */
const realtimeSecretKeyBase = randomBytes(32).toString('hex');

process.stdout.write(`# Generiert von scripts/generate-secrets.mjs — NICHT committen.
# Diese Datei enthält echte Secrets. Auf dem Server: chmod 600 .env

# ── Datenbank ────────────────────────────────────────────────────────────────
POSTGRES_PASSWORD=${postgresPassword}
POSTGRES_PORT=54322

# ── JWT ──────────────────────────────────────────────────────────────────────
# Wird von GoTrue, PostgREST und Storage geteilt. Ändert sich dieser Wert,
# müssen ANON_KEY und SERVICE_ROLE_KEY neu generiert werden.
JWT_SECRET=${jwtSecret}

# Signierte JWTs, keine Zufallsstrings. Der anon-Key ist öffentlich (er landet
# im Browser-Bundle); der service_role-Key umgeht RLS vollständig und darf
# ausschließlich serverseitig verwendet werden.
SUPABASE_ANON_KEY=${anonKey}
SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}

# ── URLs ─────────────────────────────────────────────────────────────────────
PUBLIC_GATEWAY_URL=http://localhost:8000
PUBLIC_APP_URL=http://localhost:3000

# Dieselben Werte noch einmal unter NEXT_PUBLIC_-Namen: nur so nimmt Next.js
# sie ins Browser-Bundle auf. Der anon-Key ist dafür vorgesehen — er unterliegt
# vollständig der Row Level Security. Der service_role-Key darf hier NIE stehen.
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}
GATEWAY_PORT=8000
MAILPIT_UI_PORT=8025

# ── Realtime ─────────────────────────────────────────────────────────────────
# DB_ENC_KEY muss exakt 16 Zeichen haben, SECRET_KEY_BASE mindestens 64.
REALTIME_ENC_KEY=${realtimeEncKey}
REALTIME_SECRET_KEY_BASE=${realtimeSecretKeyBase}

# ── Verhalten ────────────────────────────────────────────────────────────────
DISABLE_SIGNUP=false
MAILER_AUTOCONFIRM=true
LOG_LEVEL=info

# ── Externe Dienste (bitte selbst eintragen) ─────────────────────────────────
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
`);
