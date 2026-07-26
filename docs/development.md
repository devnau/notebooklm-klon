# Entwicklung

## Setup

Voraussetzungen: Docker, Node.js 22+. Für den lokalen Secret-Scan zusätzlich
`brew install gitleaks` (optional — die CI prüft ohnehin).

```bash
npm install
node scripts/generate-secrets.mjs > .env
chmod 600 .env
# ANTHROPIC_API_KEY und VOYAGE_API_KEY ergänzen
docker compose up -d --wait
npm run dev
```

| Adresse                 | Was                               |
| ----------------------- | --------------------------------- |
| <http://localhost:3000> | die App                           |
| <http://localhost:8000> | API-Gateway (Auth, REST, Storage) |
| <http://localhost:8025> | Mailpit — hier landen Magic Links |
| `localhost:54322`       | Postgres (nur lokal gebunden)     |

## Befehle

```bash
npm run dev            # Next.js im Entwicklungsmodus
npm run build          # shared bauen, dann Next.js
npm test               # Vitest
npm run test:watch
npm run typecheck      # alle drei tsconfig-Projekte
npm run lint
npm run format

node scripts/smoke-test.mjs   # Funktionstest gegen den laufenden Stack
```

## Aufbau des Monorepos

npm workspaces, drei Pakete:

| Paket                             | Zweck                                                                |
| --------------------------------- | -------------------------------------------------------------------- |
| `packages/shared` (`@nlm/shared`) | Typen, Zod-Schemas, Konstanten, Prompts — von App und Worker genutzt |
| `apps/web` (`@nlm/web`)           | Next.js                                                              |
| `apps/worker` (`@nlm/worker`)     | Job-Worker (ab Phase 2)                                              |

### Die tsconfig-Struktur

Das ist der einzige nicht offensichtliche Teil des Setups:

| Datei                                 | Rolle                                                      |
| ------------------------------------- | ---------------------------------------------------------- |
| `tsconfig.base.json`                  | gemeinsame strenge Optionen                                |
| `tsconfig.json`                       | Solution-File, referenziert nur Build-Projekte             |
| `packages/shared/tsconfig.json`       | Editor und ESLint, **enthält die Tests**, emittiert nichts |
| `packages/shared/tsconfig.build.json` | erzeugt `dist/` mit Declarations, **ohne** Tests           |
| `apps/web/tsconfig.json`              | `noEmit`, Next.js emittiert selbst                         |

Warum getrennt: Testdateien sollen nicht in `dist/` landen, müssen aber
typgeprüft werden — und ESLints `projectService` findet nur Dateien, die in einer
`tsconfig.json` stehen. Ein einziges Projekt kann nicht beides.

`npm run typecheck` deckt deshalb alle drei Projekte ab.

## Migrationen schreiben

1. Neue Datei in `supabase/migrations/` mit der nächsten Nummer:
   `0003_sources_and_chunks.sql`.
2. `docker compose up -d migrate` — das Skript wendet nur neue Dateien an.
3. `node scripts/smoke-test.mjs` als Gegenprobe.

**Angewandte Migrationen sind unveränderlich.** `migrate.sh` speichert eine
MD5-Summe je Datei und bricht mit einer deutlichen Meldung ab, wenn sich eine
bereits angewandte Datei geändert hat. Sonst driften Entwicklungs- und
Produktionsschema unbemerkt auseinander. Korrekturen kommen als neue Migration.

Beim Zurücksetzen der lokalen Datenbank (verwirft alle Daten):

```bash
docker compose down -v && docker compose up -d --wait
```

### Checkliste für jede neue Tabelle

Wird einer dieser Punkte vergessen, entsteht ein Datenleck — deshalb prüft der
Smoke-Test die ersten drei automatisch für alle Tabellen im Schema `public`:

- [ ] `alter table ... enable row level security;`
- [ ] `alter table ... force row level security;`
- [ ] Policies für SELECT, INSERT, UPDATE, DELETE, jeweils `to authenticated`
- [ ] Policies delegieren an `public.is_notebook_member(notebook_id, '...')`
- [ ] `grant` an `authenticated` und `service_role`, **nichts** an `anon`
- [ ] `notebook_id` direkt auf der Tabelle, wenn sie zu einem Notebook gehört
      (spart der Policy einen Join)
- [ ] Trigger `set_updated_at`, falls es ein `updated_at` gibt
- [ ] Neue Statuswerte auch in `packages/shared/src/domain.ts` ergänzen

## Konventionen

**Commits** folgen Conventional Commits mit begrenzten Scopes (siehe
`commitlint.config.mjs`). Der Betreff ist kleingeschrieben und beschreibt das
Ergebnis, nicht die Tätigkeit.

```
feat(rag): hybrid retrieval with reciprocal rank fusion
fix(ingest): keep trailing newline in extracted markdown
test(security): cover cross-notebook chunk access
```

Ein Commit ist ein lauffähiger Schritt. Lieber fünf kleine als einer, der eine
ganze Phase enthält.

**Code:** kein `any` ohne Begründung. Keine eigenen Typen für Dinge, die
`@nlm/shared` oder das Supabase-SDK schon definieren. Kommentare erklären, _warum_
etwas so ist — was der Code tut, steht im Code.

**UI:** Farben, Radien und Abstände kommen ausschließlich aus den Tokens in
`globals.css`. Keine Hex-Werte im Markup. Neue interaktive Komponenten sind
tastaturbedienbar und haben einen sichtbaren Fokus-Ring, bevor sie als fertig
gelten.

## Fehlersuche

**Container startet nicht.** `docker compose logs <service> --tail 50`. Häufigste
Ursache: `.env` fehlt oder unvollständig — Compose bricht mit
`... fehlt in .env` ab.

**GoTrue oder Storage melden `28P01`.** Passwörter der Service-Rollen sind nicht
synchron. `docker compose up -d migrate` setzt sie neu, danach
`docker compose restart auth rest storage`.

**PostgREST kennt eine neue Tabelle nicht.** Schema-Cache. `migrate.sh` schickt
am Ende ein `notify pgrst`; manuell:

```bash
docker compose exec db psql -U postgres -c "notify pgrst, 'reload schema'"
```

**`42501 new row violates row-level security policy` beim Insert.** Prüfen, ob es
die WITH-CHECK-Klausel oder die SELECT-Policy für `returning` ist — beide melden
denselben Fehler. Test: derselbe Insert ohne `returning`. Gelingt er, ist die
SELECT-Policy die Ursache (siehe `notebooks` in
[data-model.md](data-model.md)).

**ESLint: `was not found by the project service`.** Die Datei steht in keiner
`tsconfig.json`. Entweder ins passende Projekt aufnehmen oder in
`allowDefaultProject` in `eslint.config.mjs` ergänzen.
