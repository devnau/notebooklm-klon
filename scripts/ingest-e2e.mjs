#!/usr/bin/env node
/**
 * End-to-End-Probe der Ingestion gegen den laufenden Stack.
 *
 * Läuft absichtlich nicht in der CI: der Schritt „Embedding" ruft Voyage auf,
 * kostet also Geld und braucht einen Schlüssel. Die Bausteine sind einzeln
 * durch Unit-Tests abgedeckt; was hier geprüft wird, ist genau das, was kein
 * Unit-Test zeigen kann — dass Storage, Datenbank, Job-Trigger, Worker und
 * Voyage in dieser Reihenfolge tatsächlich zusammenspielen.
 *
 * Aufruf:  node scripts/ingest-e2e.mjs
 * Voraussetzung: `docker compose up -d`, VOYAGE_API_KEY in .env, laufender
 * Worker (`npm run dev --workspace=@nlm/worker`).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const GATEWAY = env.PUBLIC_GATEWAY_URL ?? 'http://localhost:8000';
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const TIMEOUT_MS = 120_000;

/*
 * `-q` unterdrückt die Befehlsmeldungen ("INSERT 0 1"), die psql sonst zwischen
 * die Ergebniszeilen mischt — bei einem `insert ... returning` steht die ID
 * dann in derselben Ausgabe wie die Statuszeile und lässt sich nicht mehr als
 * UUID weiterverwenden.
 */
function psql(sql) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-qtAX', '-c', sql],
    { encoding: 'utf8', cwd: new URL('..', import.meta.url) },
  ).trim();
}

async function main() {
  if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY fehlt in .env');
  if (!env.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY fehlt in .env');

  console.log('→ Testnutzer und Notebook anlegen ...');
  // Reste eines abgebrochenen Laufs entfernen: die E-Mail ist eindeutig, und
  // ein Fehlschlag in der Mitte hinterlässt sonst einen Nutzer, der jeden
  // weiteren Lauf blockiert.
  psql(`delete from auth.users where email = 'ingest-e2e@example.test';`);
  const userId = psql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'ingest-e2e@example.test', crypt('x', gen_salt('bf')),
            now(), now(), now())
    returning id;
  `);

  const notebookId = psql(
    `insert into public.notebooks (owner_id, title) values ('${userId}', 'Ingest-Probe') returning id;`,
  );

  // Eine echte Datei, kein Attrappen-Text: der Extraktor soll wirklich arbeiten.
  const pdf = readFileSync(new URL('../tests/fixtures/zwei-seiten.pdf', import.meta.url));
  const storagePath = `${notebookId}/${crypto.randomUUID()}.pdf`;

  console.log('→ Datei in den Bucket legen ...');
  const upload = await fetch(`${GATEWAY}/storage/v1/object/sources/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE}`,
      apikey: SERVICE,
      'Content-Type': 'application/pdf',
    },
    body: pdf,
  });
  if (!upload.ok)
    throw new Error(`Upload fehlgeschlagen: ${upload.status} ${await upload.text()}`);

  console.log('→ Quelle eintragen (der Trigger legt den Job an) ...');
  const sourceId = psql(`
    insert into public.sources (notebook_id, kind, title, storage_path, byte_size, mime_type, created_by)
    values ('${notebookId}', 'pdf', 'zwei-seiten.pdf', '${storagePath}',
            ${pdf.byteLength}, 'application/pdf', '${userId}')
    returning id;
  `);

  const jobCount = psql(
    `select count(*) from public.jobs where payload->>'sourceId' = '${sourceId}';`,
  );
  if (jobCount !== '1') throw new Error(`Erwartet 1 Job, gefunden: ${jobCount}`);
  console.log('  ✓ Job automatisch eingereiht');

  console.log('→ Auf den Worker warten ...');
  const deadline = Date.now() + TIMEOUT_MS;
  let status = '';
  let lastReport = '';

  while (Date.now() < deadline) {
    status = psql(`select status from public.sources where id = '${sourceId}';`);
    if (status !== lastReport) {
      console.log(`  · ${status}`);
      lastReport = status;
    }
    if (status === 'ready' || status === 'failed') break;
    await sleep(1000);
  }

  if (status === 'failed') {
    const error = psql(`select error from public.sources where id = '${sourceId}';`);
    throw new Error(`Import fehlgeschlagen: ${error}`);
  }
  if (status !== 'ready') {
    throw new Error(`Zeitüberschreitung, Status blieb bei "${status}". Läuft der Worker?`);
  }

  // Der eigentliche Prüfpunkt: nicht „der Status steht auf ready", sondern
  // „es liegen brauchbare Abschnitte mit vollständigen Vektoren vor".
  const [chunks, ohneVektor, minLen, maxLen, seiten] = psql(`
    select count(*),
           count(*) filter (where embedding is null),
           min(char_length(content)),
           max(char_length(content)),
           count(distinct page)
    from public.chunks where source_id = '${sourceId}';
  `).split('|');

  console.log(`  ✓ ${chunks} Abschnitte, ${seiten} Seiten, ${minLen}–${maxLen} Zeichen`);
  if (Number(chunks) === 0) throw new Error('Keine Abschnitte erzeugt');
  if (Number(ohneVektor) !== 0) throw new Error(`${ohneVektor} Abschnitte ohne Vektor`);

  // Die Volltextspalte ist `generated always` — wenn sie leer bleibt, greift
  // die Hybrid-Suche später nur zur Hälfte, ohne dass irgendetwas scheitert.
  const ohneTsv = psql(
    `select count(*) from public.chunks where source_id = '${sourceId}' and tsv is null;`,
  );
  if (ohneTsv !== '0') throw new Error(`${ohneTsv} Abschnitte ohne tsvector`);
  console.log('  ✓ Volltextindex gefüllt');

  const jobStatus = psql(
    `select status from public.jobs where payload->>'sourceId' = '${sourceId}';`,
  );
  if (jobStatus !== 'done')
    throw new Error(`Job steht auf "${jobStatus}", erwartet "done"`);
  console.log('  ✓ Job abgeschlossen');

  console.log('→ Aufräumen ...');
  psql(`delete from public.notebooks where id = '${notebookId}';`);
  psql(`delete from auth.users where id = '${userId}';`);
  await fetch(`${GATEWAY}/storage/v1/object/sources/${storagePath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
  });

  console.log('\n✓ Ingestion funktioniert Ende zu Ende.');
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
