#!/usr/bin/env node
/**
 * Funktionstest des laufenden Docker-Stacks. Prüft nicht, ob Container "up"
 * sind — das sagt nichts über Funktion aus — sondern ob der komplette Pfad
 * Gateway → Auth/REST/Storage → Postgres tatsächlich arbeitet.
 *
 * Aufruf:  node scripts/smoke-test.mjs
 * Erwartet eine .env im Projektwurzelverzeichnis und einen laufenden Stack.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
const ANON = env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}\n      ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * `quiet: true` schluckt stderr. Nötig bei Prüfungen, die absichtlich einen
 * Datenbankfehler auslösen — sonst steht die erwartete Meldung im Protokoll und
 * ein echter Fehler geht darin unter.
 */
function psql(sql, { quiet = false } = {}) {
  return execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${env.POSTGRES_PASSWORD}`,
      'db',
      'psql',
      '-tAX',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-c',
      sql,
    ],
    {
      encoding: 'utf8',
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    },
  ).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Ein Response-Body lässt sich nur einmal lesen. Diese Hülle liest ihn genau
 * einmal und gibt Status, Rohtext und geparstes JSON zurück — sonst scheitert
 * eine Fehlermeldung, die den Text ausgibt, an der späteren .json()-Auswertung.
 */
async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { ok: response.ok, status: response.status, text, json };
}

console.log('\nGateway');
await check('erreichbar', async () => {
  const response = await fetch(`${GATEWAY}/health`);
  assert(response.ok, `HTTP ${response.status}`);
  return await response.text();
});

console.log('\nAuth (GoTrue)');
await check('Health-Endpunkt antwortet', async () => {
  const response = await fetch(`${GATEWAY}/auth/v1/health`);
  assert(response.ok, `HTTP ${response.status}`);
  const body = await response.json();
  return `Version ${body.version ?? '?'}`;
});

/** Registriert einen Nutzer und gibt Token samt ID zurück. */
async function createUser() {
  const email = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'smoke-test-passwort-2026';
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ email, password });

  const signUp = await request(`${GATEWAY}/auth/v1/signup`, {
    method: 'POST',
    headers,
    body,
  });
  assert(signUp.ok, `signup: HTTP ${signUp.status} ${signUp.text}`);

  const signIn = await request(`${GATEWAY}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers,
    body,
  });
  assert(signIn.ok, `token: HTTP ${signIn.status} ${signIn.text}`);
  assert(signIn.json?.access_token, `kein access_token: ${signIn.text}`);

  return { email, token: signIn.json.access_token, userId: signIn.json.user.id };
}

/** Zustand zwischen den Prüfungen. */
const state = {};

await check('Registrierung und Login funktionieren', async () => {
  state.user = await createUser();
  return `Nutzer ${state.user.userId.slice(0, 8)}…`;
});

await check('Trigger legt das Profil automatisch an', () => {
  assert(state.user, 'Voraussetzung fehlt: kein angemeldeter Nutzer');
  const count = psql(
    `select count(*) from public.profiles where id = '${state.user.userId}'`,
  );
  assert(count === '1', `profiles-Zeilen: ${count} (erwartet 1)`);
});

console.log('\nREST (PostgREST)');
await check('anon-Key erreicht die API', async () => {
  const response = await request(`${GATEWAY}/rest/v1/`, { headers: { apikey: ANON } });
  assert(response.ok, `HTTP ${response.status} ${response.text.slice(0, 200)}`);
  return 'OpenAPI-Schema ausgeliefert';
});

await check('RLS blockt anonymen Zugriff auf notebooks', async () => {
  const response = await request(`${GATEWAY}/rest/v1/notebooks?select=id`, {
    headers: { apikey: ANON },
  });
  // Ohne Nutzer-JWT gilt die Rolle anon, die keine Policy erfüllt: leer, nicht Fehler.
  assert(
    Array.isArray(response.json) && response.json.length === 0,
    `unerwartete Antwort: ${response.text.slice(0, 200)}`,
  );
  return 'leeres Ergebnis, wie erwartet';
});

await check('angemeldeter Nutzer kann ein Notebook anlegen und lesen', async () => {
  assert(state.user, 'Voraussetzung fehlt: kein angemeldeter Nutzer');
  const { token, userId } = state.user;

  const created = await request(`${GATEWAY}/rest/v1/notebooks`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ title: 'Smoke-Test-Notebook', owner_id: userId }),
  });
  assert(created.ok, `insert: HTTP ${created.status} ${created.text.slice(0, 300)}`);
  const notebook = created.json?.[0];
  assert(notebook?.id, `keine ID in der Antwort: ${created.text.slice(0, 200)}`);

  const read = await request(
    `${GATEWAY}/rest/v1/notebooks?select=id,title&id=eq.${notebook.id}`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  assert(read.json?.length === 1, `Lesen ergab ${read.json?.length} Zeilen`);

  state.notebookId = notebook.id;
  return `Notebook ${notebook.id.slice(0, 8)}…`;
});

await check('Owner-Trigger setzt die Mitgliedschaft', () => {
  assert(state.notebookId, 'Voraussetzung fehlt: kein Notebook');
  const role = psql(
    `select role from public.notebook_members where notebook_id = '${state.notebookId}'`,
  );
  assert(role === 'owner', `Rolle: "${role}" (erwartet "owner")`);
});

await check('fremder Nutzer sieht das Notebook nicht', async () => {
  assert(state.notebookId, 'Voraussetzung fehlt: kein Notebook');
  const other = await createUser();

  const response = await request(
    `${GATEWAY}/rest/v1/notebooks?select=id&id=eq.${state.notebookId}`,
    { headers: { apikey: ANON, Authorization: `Bearer ${other.token}` } },
  );
  assert(
    Array.isArray(response.json),
    `unerwartete Antwort: ${response.text.slice(0, 200)}`,
  );
  assert(
    response.json.length === 0,
    `Datenleck: fremder Nutzer sah ${response.json.length} Zeile(n)`,
  );
  return 'kein Zugriff, wie erwartet';
});

await check('fremder Nutzer kann das Notebook nicht ändern', async () => {
  assert(state.notebookId, 'Voraussetzung fehlt: kein Notebook');
  const other = await createUser();

  const response = await request(`${GATEWAY}/rest/v1/notebooks?id=eq.${state.notebookId}`, {
    method: 'PATCH',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${other.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ title: 'übernommen' }),
  });
  // PostgREST meldet keinen Fehler, es trifft nur keine Zeile — das ist korrekt.
  const changed = Array.isArray(response.json) ? response.json.length : 0;
  assert(changed === 0, `Datenleck: ${changed} Zeile(n) verändert`);

  const title = psql(`select title from public.notebooks where id = '${state.notebookId}'`);
  assert(title === 'Smoke-Test-Notebook', `Titel wurde verändert: "${title}"`);
  return 'Schreibzugriff abgewiesen';
});

console.log('\nStorage');
await check('Status-Endpunkt antwortet', async () => {
  const response = await fetch(`${GATEWAY}/storage/v1/status`);
  assert(response.ok, `HTTP ${response.status}`);
  return 'ok';
});

await check('Bucket anlegen und wieder entfernen', async () => {
  const headers = {
    Authorization: `Bearer ${SERVICE}`,
    apikey: SERVICE,
    'Content-Type': 'application/json',
  };
  const name = `smoke-${Date.now()}`;
  const created = await fetch(`${GATEWAY}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, id: name, public: false }),
  });
  assert(created.ok, `create: HTTP ${created.status} ${await created.text()}`);

  const removed = await fetch(`${GATEWAY}/storage/v1/bucket/${name}`, {
    method: 'DELETE',
    headers,
  });
  assert(removed.ok, `delete: HTTP ${removed.status} ${await removed.text()}`);
  return name;
});

console.log('\nDatenbank');
await check('pgvector ist installiert', () => {
  const version = psql("select extversion from pg_extension where extname = 'vector'");
  assert(version, 'Extension vector fehlt');
  return `Version ${version}`;
});

await check('HNSW-Indextyp verfügbar', () => {
  const exists = psql("select count(*) from pg_am where amname = 'hnsw'");
  assert(exists === '1', 'Zugriffsmethode hnsw fehlt');
});

await check('RLS ist auf allen Anwendungstabellen aktiv', () => {
  const unprotected = psql(`
    select coalesce(string_agg(c.relname, ', '), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname <> 'schema_migrations'
      and not c.relrowsecurity
  `);
  assert(unprotected === '', `Tabellen ohne RLS: ${unprotected}`);
});

await check('FORCE RLS gilt auch für den Tabelleneigentümer', () => {
  const unforced = psql(`
    select coalesce(string_agg(c.relname, ', '), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname <> 'schema_migrations'
      and c.relrowsecurity
      and not c.relforcerowsecurity
  `);
  assert(unforced === '', `Tabellen ohne FORCE RLS: ${unforced}`);
});

await check('Notebook lässt sich löschen (Kaskade blockiert nicht)', () => {
  // Diese Prüfung fehlte anfangs — und genau darin lag ein Fehler: der Trigger
  // gegen das Entfernen des letzten Owners feuerte auch während der Kaskade
  // beim Löschen des Notebooks und machte Notebooks unlöschbar. Die Prüfung
  // „letzter Owner kann nicht entfernt werden" war grün, während Löschen
  // vollständig kaputt war.
  // Nur die erste Zeile: bei `insert ... returning` gibt psql zusätzlich die
  // Statuszeile „INSERT 0 1" aus, die sonst in die UUID rutscht.
  const notebookId =
    psql(`
    insert into public.notebooks (title, owner_id)
    values ('Kaskadenprobe', (select id from auth.users limit 1))
    returning id
  `).split('\n')[0] ?? '';
  assert(/^[0-9a-f-]{36}$/.test(notebookId), `unerwartete ID: "${notebookId}"`);
  psql(`delete from public.notebooks where id = '${notebookId}'`);
  const remaining = psql(
    `select count(*) from public.notebooks where id = '${notebookId}'`,
  );
  assert(remaining === '0', 'Notebook wurde nicht gelöscht');

  const orphanMembers = psql(
    `select count(*) from public.notebook_members where notebook_id = '${notebookId}'`,
  );
  assert(orphanMembers === '0', `verwaiste Mitgliedschaften: ${orphanMembers}`);
});

await check('letzter Owner kann nicht entfernt werden', () => {
  assert(state.notebookId, 'Voraussetzung fehlt: kein Notebook');
  let message = '';
  try {
    psql(`delete from public.notebook_members where notebook_id = '${state.notebookId}'`, {
      quiet: true,
    });
  } catch (error) {
    message = `${String(error)} ${error?.stderr ?? ''}`;
  }
  assert(message !== '', 'Löschen des letzten Owners wurde nicht verhindert');
  assert(
    message.includes('mindestens einen Owner'),
    `Abbruch aus falschem Grund: ${message.slice(0, 200)}`,
  );
  // Gegenprobe: die Zeile muss noch existieren.
  const remaining = psql(
    `select count(*) from public.notebook_members where notebook_id = '${state.notebookId}'`,
  );
  assert(remaining === '1', `Mitgliedschaften nach Abbruch: ${remaining} (erwartet 1)`);
});

console.log('\nChat und Retrieval');

await check('match_chunks liefert bei fremdem Notizbuch nichts', () => {
  /*
   * Die Falle bei RAG: die Zugriffsprüfung sitzt in der Anwendung, und die
   * Suchfunktion umgeht sie. match_chunks ist deshalb `security invoker` — RLS
   * auf chunks entscheidet, was sie sieht. Geprüft mit einem Nullvektor: es
   * geht nicht um Trefferqualität, sondern darum, dass gar nichts kommt.
   */
  const zero = `[${Array.from({ length: 1024 }, () => '0').join(',')}]`;
  const rows = psql(`
    select count(*) from public.match_chunks(
      gen_random_uuid(), 'irgendetwas', '${zero}'::extensions.vector(1024), null, 10, 60
    )
  `);
  assert(rows === '0', `Datenleck: ${rows} Abschnitt(e) aus fremdem Notizbuch`);
});

await check('match_chunks ist nicht security definer', () => {
  // Eine spätere Änderung auf `security definer` würde die Prüfung oben
  // aushebeln, ohne dass sie rot wird — der Aufruf käme dann als Eigentümer
  // und sähe alles. Deshalb wird die Eigenschaft selbst geprüft.
  const isDefiner = psql(`
    select prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'match_chunks'
  `);
  assert(isDefiner === 'f', 'match_chunks läuft als security definer');
});

await check('fremder Nutzer sieht Unterhaltungen und Nachrichten nicht', async () => {
  assert(state.user, 'Voraussetzung fehlt: kein angemeldeter Nutzer');
  assert(state.notebookId, 'Voraussetzung fehlt: kein Notebook');

  const chatId = psql(`
    insert into public.chats (notebook_id, title, created_by)
    values ('${state.notebookId}', 'Geheime Unterhaltung', '${state.user.userId}')
    returning id
  `).split('\n')[0];

  psql(`
    insert into public.messages (chat_id, notebook_id, role, content, created_by)
    values ('${chatId}', '${state.notebookId}', 'user', 'Vertrauliche Frage', '${state.user.userId}')
  `);

  const other = await createUser();

  for (const table of ['chats', 'messages']) {
    const response = await request(
      `${GATEWAY}/rest/v1/${table}?select=id&notebook_id=eq.${state.notebookId}`,
      { headers: { apikey: ANON, Authorization: `Bearer ${other.token}` } },
    );
    assert(Array.isArray(response.json), `${table}: ${response.text.slice(0, 200)}`);
    assert(
      response.json.length === 0,
      `Datenleck in ${table}: fremder Nutzer sah ${response.json.length} Zeile(n)`,
    );
  }

  state.chatId = chatId;
  return 'beide Tabellen dicht';
});

await check('fremder Nutzer kann keine Frage in fremdem Notizbuch stellen', async () => {
  assert(state.chatId, 'Voraussetzung fehlt: keine Unterhaltung');
  const other = await createUser();

  const response = await request(`${GATEWAY}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${other.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      chat_id: state.chatId,
      notebook_id: state.notebookId,
      role: 'user',
      content: 'Untergeschoben',
    }),
  });

  assert(!response.ok, `Insert wurde akzeptiert: HTTP ${response.status}`);
  const count = psql(
    `select count(*) from public.messages where content = 'Untergeschoben'`,
  );
  assert(count === '0', `Datenleck: ${count} untergeschobene Nachricht(en)`);
  return `abgewiesen mit HTTP ${response.status}`;
});

await check('Nachrichten sind unveränderlich', async () => {
  /*
   * Eine Antwort samt Zitaten ist ein Protokoll: sie hält fest, was das Modell
   * auf Basis welcher Auszüge gesagt hat. Liesse sie sich nachträglich ändern,
   * wäre sie als Beleg wertlos — und der Unterschied fiele niemandem auf.
   */
  assert(state.user, 'Voraussetzung fehlt: kein angemeldeter Nutzer');
  const response = await request(
    `${GATEWAY}/rest/v1/messages?notebook_id=eq.${state.notebookId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${state.user.token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ content: 'nachträglich geändert' }),
    },
  );

  const changed = Array.isArray(response.json) ? response.json.length : 0;
  assert(changed === 0, `${changed} Nachricht(en) nachträglich geändert`);
  const tampered = psql(
    `select count(*) from public.messages where content = 'nachträglich geändert'`,
  );
  assert(tampered === '0', 'Nachricht liess sich ändern');
  return 'auch der Eigentümer kann nicht ändern';
});

await check('Notizbuch mit Artefakt lässt sich löschen', () => {
  /*
   * Die zweite Auflage desselben Fehlers: ein Trigger, der beim Löschen eines
   * Artefakts die Audiodatei aus storage.objects entfernen wollte. Der
   * Storage-Dienst verbietet das, und weil die Kaskade beim Löschen eines
   * Notizbuchs auch die Artefakte mitnimmt, war damit das Löschen ganzer
   * Notizbücher kaputt — nicht nur das Aufräumen.
   *
   * Beim ersten Mal (0003, Owner-Trigger) hat es der E2E-Lauf gefunden, beim
   * zweiten Mal (0010) der Ende-zu-Ende-Lauf des Audio-Wegs. Diese Prüfung
   * schliesst die Lücke: sie deckt die Kaskade über alle Kindtabellen ab.
   */
  const userId = psql('select id from auth.users limit 1');
  assert(/^[0-9a-f-]{36}$/.test(userId), 'kein Testnutzer vorhanden');

  const notebookId =
    psql(`
    insert into public.notebooks (title, owner_id)
    values ('Kaskade mit Artefakt', '${userId}')
    returning id
  `).split('\n')[0] ?? '';
  assert(/^[0-9a-f-]{36}$/.test(notebookId), `unerwartete ID: "${notebookId}"`);

  psql(`
    insert into public.artifacts (notebook_id, kind, status, storage_path)
    values ('${notebookId}', 'audio', 'ready', '${notebookId}/probe.mp3')
  `);
  psql(`
    insert into public.notes (notebook_id, title, content)
    values ('${notebookId}', 'Probe', 'Inhalt')
  `);
  const chatId =
    psql(`
    insert into public.chats (notebook_id, title) values ('${notebookId}', 'Probe')
    returning id
  `).split('\n')[0] ?? '';
  psql(`
    insert into public.messages (chat_id, notebook_id, role, content)
    values ('${chatId}', '${notebookId}', 'user', 'Frage')
  `);

  psql(`delete from public.notebooks where id = '${notebookId}'`);

  const remaining = psql(
    `select count(*) from public.notebooks where id = '${notebookId}'`,
  );
  assert(remaining === '0', 'Notizbuch liess sich nicht löschen');
  return 'Kaskade über Artefakte, Notizen, Chats und Nachrichten';
});

console.log(
  failures === 0
    ? '\n✓ Alle Prüfungen bestanden.\n'
    : `\n✗ ${failures} Prüfung(en) fehlgeschlagen.\n`,
);
process.exit(failures === 0 ? 0 : 1);
