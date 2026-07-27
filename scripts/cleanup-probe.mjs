#!/usr/bin/env node
/**
 * Prüft den Aufräumjob gegen echte Dateien.
 *
 * Dieser Job **löscht Daten**. Ein Fehler darin ist nicht ärgerlich, sondern
 * teuer: er würde Quelldateien entfernen, die noch gebraucht werden, und das
 * fällt erst auf, wenn jemand ein Dokument öffnet. Ein Unit-Test mit
 * nachgebildeter Storage-API würde die interessanteste Frage nicht beantworten —
 * ob die Liste der bekannten Pfade wirklich alles enthält.
 *
 * Geprüft wird deshalb gegen den laufenden Stack, mit einer echten Quelle, einer
 * echten verwaisten Datei und einer, die zu jung ist.
 *
 * Aufruf:  docker compose up -d && node scripts/cleanup-probe.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL('.env', root), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const GATEWAY = env.PUBLIC_GATEWAY_URL ?? 'http://localhost:8000';
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-qtAX', '-c', sql],
    { encoding: 'utf8', cwd: root },
  ).trim();
}

async function upload(path, inhalt, typ = 'text/plain') {
  const response = await fetch(`${GATEWAY}/storage/v1/object/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE}`,
      apikey: SERVICE,
      'Content-Type': typ,
    },
    body: inhalt,
  });
  if (!response.ok) throw new Error(`Upload ${path}: ${await response.text()}`);
}

async function existiert(path) {
  const response = await fetch(`${GATEWAY}/storage/v1/object/${path}`, {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
  });
  return response.ok;
}

/**
 * Ruft den Aufräumjob über den Betriebsbefehl des Workers auf.
 *
 * Nicht über einen eigenen Wegwerf-Aufruf: `npm run cleanup` ist der Weg, den
 * auch ein Betreiber nimmt, und ein Test, der einen anderen Pfad prüft als den
 * benutzten, prüft das Falsche. Ein erster Entwurf schrieb eine temporäre
 * .mts-Datei in /tmp — dort findet Node die Pakete des Projekts nicht.
 */
function laufeAufraeumen() {
  return execFileSync('npm', ['run', '--silent', 'cleanup', '--workspace=@nlm/worker'], {
    encoding: 'utf8',
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function main() {
  if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY fehlt in .env');

  console.log('→ Ausgangslage herstellen ...');
  psql(`delete from auth.users where email = 'cleanup-probe@example.test';`);

  const userId = psql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'cleanup-probe@example.test', crypt('x', gen_salt('bf')),
            now(), now(), now())
    returning id;
  `);
  const notebookId = psql(
    `insert into public.notebooks (owner_id, title) values ('${userId}', 'Aufräum-Probe') returning id;`,
  );

  // 1. Eine echte Quelle mit Datei — muss überleben.
  const gueltig = `${notebookId}/${crypto.randomUUID()}.txt`;
  await upload(`sources/${gueltig}`, 'Inhalt einer echten Quelle.');
  const sourceId = psql(`
    insert into public.sources (notebook_id, kind, title, storage_path, byte_size, created_by)
    values ('${notebookId}', 'txt', 'Echte Quelle', '${gueltig}', 26, '${userId}')
    returning id;
  `);

  // 2. Ein extrahierter Text, der zur Quelle gehört — muss überleben.
  const textPfad = `${notebookId}/extrahiert/${sourceId}.md`;
  await upload(`sources/${textPfad}`, '# Extrahiert', 'text/markdown');
  psql(`update public.sources set text_path = '${textPfad}' where id = '${sourceId}';`);

  // 3. Eine verwaiste Datei, alt genug — muss weg.
  const verwaistAlt = `${notebookId}/${crypto.randomUUID()}.txt`;
  await upload(`sources/${verwaistAlt}`, 'Niemand kennt mich.');
  // Das Alter wird in storage.objects zurückgedreht; die Storage-API kennt
  // keinen Weg, ein Erstellungsdatum zu setzen.
  psql(`
    update storage.objects set created_at = now() - interval '3 hours'
    where bucket_id = 'sources' and name = '${verwaistAlt}';
  `);

  // 4. Eine verwaiste Datei, die zu jung ist — muss bleiben. Sie steht für den
  //    Upload, der gerade eintrifft und dessen Quelle noch nicht angelegt ist.
  const verwaistJung = `${notebookId}/${crypto.randomUUID()}.txt`;
  await upload(`sources/${verwaistJung}`, 'Gerade erst hochgeladen.');

  // 5. Eine verwaiste Audiodatei — muss weg.
  const audioVerwaist = `${notebookId}/${crypto.randomUUID()}.mp3`;
  await upload(`audio/${audioVerwaist}`, 'nicht wirklich mp3', 'audio/mpeg');
  psql(`
    update storage.objects set created_at = now() - interval '3 hours'
    where bucket_id = 'audio' and name = '${audioVerwaist}';
  `);

  console.log('  4 Dateien in sources, 1 in audio angelegt');

  console.log('→ Aufräumjob laufen lassen ...');
  const ausgabe = laufeAufraeumen();

  const ergebnis = JSON.parse(
    /ERGEBNIS (\{.*\})/.exec(ausgabe)?.[1] ?? '{"geprueft":0,"entfernt":0}',
  );
  console.log(`  ${ergebnis.geprueft} Objekte geprüft, ${ergebnis.entfernt} entfernt`);

  console.log('→ Ergebnis prüfen ...');

  /*
   * Die wichtigste Prüfung zuerst: was gebraucht wird, ist noch da. Ein Job,
   * der zu viel löscht, ist ungleich schlimmer als einer, der zu wenig löscht.
   */
  check('echte Quelldatei überlebt', await existiert(`sources/${gueltig}`));
  check('extrahierter Text überlebt', await existiert(`sources/${textPfad}`));
  check(
    'zu junge verwaiste Datei überlebt',
    await existiert(`sources/${verwaistJung}`),
    'sonst würden gerade eintreffende Uploads gelöscht',
  );

  check('alte verwaiste Datei ist weg', !(await existiert(`sources/${verwaistAlt}`)));
  check('verwaiste Audiodatei ist weg', !(await existiert(`audio/${audioVerwaist}`)));

  console.log('→ Aufräumen nach dem Löschen eines Notizbuchs ...');
  psql(`delete from public.notebooks where id = '${notebookId}';`);
  psql(`
    update storage.objects set created_at = now() - interval '3 hours'
    where name like '${notebookId}/%';
  `);

  laufeAufraeumen();

  /*
   * Das ist der Fall, um den es eigentlich geht — und der Grund, warum es
   * diesen Job überhaupt gibt: nach dem Löschen eines Notizbuchs bleiben die
   * Dateien liegen, weil Storage die Fremdschlüssel nicht kennt. Ein gelöschtes
   * Notizbuch soll gelöscht sein, nicht halb.
   */
  check(
    'Dateien eines gelöschten Notizbuchs sind weg',
    !(await existiert(`sources/${gueltig}`)) && !(await existiert(`sources/${textPfad}`)),
  );

  psql(`delete from auth.users where id = '${userId}';`);

  console.log(
    failures === 0
      ? '\n✓ Der Aufräumjob löscht das Richtige und nur das.'
      : `\n✗ ${failures} Prüfung(en) fehlgeschlagen.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
