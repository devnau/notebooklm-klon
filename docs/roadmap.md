# Roadmap

Jede Phase endet mit einem Tag und einem lauffähigen Zustand. Innerhalb einer
Phase ist jeder Commit für sich lauffähig.

| Phase | Inhalt                                                   | Tag      | Status    |
| ----- | -------------------------------------------------------- | -------- | --------- |
| 0     | Monorepo, Docker-Stack, Datenmodell, CI, Dokumentation   | `v0.1.0` | ✅ fertig |
| 1     | Auth, Notebook-Verwaltung, App-Shell                     | `v0.2.0` | –         |
| 2     | Quellen-Import: Upload, Extraktion, Chunking, Embeddings | `v0.3.0` | –         |
| 3     | Chat mit hybrider Suche und klickbaren Zitaten           | `v0.4.0` | –         |
| 4     | Notizen und Studio-Artefakte                             | `v0.5.0` | –         |
| 5     | Audio-Überblick                                          | `v0.6.0` | –         |
| 6     | Teilen und Zusammenarbeit                                | `v0.7.0` | –         |
| 7     | Härtung, Betrieb, Politur                                | `v1.0.0` | –         |

## Phase 0 — Fundament ✅

- npm-Workspaces mit `apps/web`, `packages/shared`
- Next.js 16, TypeScript, Tailwind v4 mit Design-Tokens in oklch, Dark Mode
- Docker-Stack: Postgres 17 mit pgvector, GoTrue, PostgREST, Storage, Caddy als
  Gateway, Mailpit für Magic Links
- Migrationen mit Unveränderlichkeitsprüfung über Checksummen
- Datenmodell für Profile, Notebooks und Mitgliedschaften, RLS auf jeder Tabelle
- `scripts/generate-secrets.mjs`, `scripts/smoke-test.mjs` (17 Prüfungen)
- CI: Lint, Typen, Tests, Build, RLS gegen echten Stack, gitleaks, npm audit
- Dokumentation: Architektur, Datenmodell, Sicherheit, Entwicklung, 7 ADRs

## Phase 1 — Auth und Notebooks

- Registrierung, Anmeldung, Magic Link, Abmeldung
- Session-Erneuerung über `@supabase/ssr`-Middleware
- Notebook-Übersicht, anlegen, umbenennen, löschen
- Dreispalten-Shell mit verschiebbaren Trennern, Tab-Navigation auf Mobil
- Theme-Umschalter, Command-Palette (⌘K)
- RLS-Testsuite für Notebooks und Mitgliedschaften
- Assets 1–4 aus `assets/PROMPTS.md`

## Phase 2 — Quellen-Import

- Upload per Drag & Drop, Mehrfachauswahl, Fortschritt
- URL-Import mit SSRF-Schutz, Einfügen von Text
- `jobs`-Tabelle und Worker mit `SKIP LOCKED`
- Extraktion: PDF (seitenweise), DOCX, HTML, Markdown, Text
- Überschriftenbewusstes Chunking mit Überlappung
- Voyage-Embeddings in Stapeln, mit Backoff
- Live-Status über Realtime, Quellen-Viewer mit Sprungmarken

## Phase 3 — Chat und Zitate

- `match_chunks` mit RRF, Quellenfilter
- Systemprompt mit Prompt Caching
- Streaming-Route, Zitat-Parsing und -Validierung
- Klick auf Zitat springt zur Textstelle
- Golden-Set-Tests: Recall, Zitat-Integrität, Abstinenz bei fehlender Deckung
- Prompt-Injection-Test

## Phase 4 — Notizen und Studio

- Notizen mit sanitisiertem Markdown-Editor
- Artefakte: Zusammenfassung, Lernleitfaden, FAQ, Zeitleiste, Briefing, Mindmap
- Structured Outputs je Typ, Mermaid für die Mindmap
- Antwort oder Artefakt als Notiz speichern

## Phase 5 — Audio-Überblick

- TTS-Adapter: Piper für Deutsch, Kokoro für Englisch
- Dialogskript per Structured Output, zwei Sprecherrollen
- ffmpeg: Zusammenschnitt, Pausen, Lautheitsnormalisierung
- Player mit mitlaufendem Transkript

## Phase 6 — Teilen

- Mitglieder einladen, Rollen ändern, entfernen
- Links mit Token und Ablaufdatum
- RLS-Erweiterung für Token-Zugriff
- Nur-Lese-Modus für viewer, Presence im Chat
- größte Erweiterung der Sicherheitssuite

## Phase 7 — Härtung und Betrieb

- i18n (de, en), Rate-Limits, Kostenerfassung in `llm_usage`
- `pino`-Logging, `/api/health` mit DB-, Storage- und Worker-Prüfung
- `docker-compose.prod.yml` mit Caddy, TLS, CSP und HSTS
- Backup-Skript und einmal echt geprobter Restore
- Accessibility-Durchgang mit axe, Performance, Bundle-Analyse
- `docs/deployment.md`, `docs/operations.md`
