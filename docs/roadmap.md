# Roadmap

Jede Phase endet mit einem Tag und einem lauffähigen Zustand. Innerhalb einer
Phase ist jeder Commit für sich lauffähig.

| Phase | Inhalt                                                   | Tag      | Status    |
| ----- | -------------------------------------------------------- | -------- | --------- |
| 0     | Monorepo, Docker-Stack, Datenmodell, CI, Dokumentation   | `v0.1.0` | ✅ fertig |
| 1     | Auth, Notebook-Verwaltung, App-Shell                     | `v0.2.0` | ✅ fertig |
| 2     | Quellen-Import: Upload, Extraktion, Chunking, Embeddings | `v0.3.0` | 🔨 läuft  |
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

## Phase 1 — Auth und Notebooks ✅

- Registrierung, Anmeldung, Magic Link, Passwort-Reset, Abmeldung
- Session-Erneuerung über `@supabase/ssr` im Next-Proxy
- Notebook-Übersicht, anlegen, umbenennen, löschen mit Bestätigung
- Profilseite, Theme-Umschalter mit Systemoption
- Dreispalten-Arbeitsfläche mit verschiebbaren Trennern, Tabs auf Mobil
- Design-System: Primitive auf Radix, Kontrast per Test abgesichert
- 24 E2E-Tests (Playwright) inklusive axe-Scans, 21 Unit-Tests
- Datenbanktypen generiert statt handgeschrieben (`npm run db:types`)

**Nachgezogen:** Command-Palette (⌘K) — sie braucht Quellen und Notizen, um
etwas zu durchsuchen, und kommt daher in Phase 2. Assets 1–4 warten auf die
Grafiken; die UI arbeitet bis dahin mit maßgleichen Platzhaltern.

**Drei Fehler, die diese Phase aufgedeckt hat:**

1. Kein Notebook ließ sich löschen — der Trigger gegen das Entfernen des
   letzten Owners blockierte die Kaskade (Migration 0003).
2. Die Abmeldung im Dropdown-Menü lief nie los: Radix entfernt den Button beim
   Schließen, bevor der Browser das Formular abschickt.
3. Die Farbpalette erreichte 3,99:1 statt der dokumentierten 4,5:1.

Alle drei wären ohne Tests gegen die echte Anwendung unentdeckt geblieben.

## Phase 2 — Quellen-Import 🔨

**Fertig:**

- Schema für `sources`, `chunks` (pgvector/HNSW + tsvector/GIN) und `jobs`
- `claim_job()` mit `FOR UPDATE SKIP LOCKED`, gegengeprüft mit zehn
  gleichzeitigen Workern; `requeue_stale_jobs()` mit Backoff
- SSRF-Schutz in zwei Stufen: Namensprüfung ohne DNS, dann Prüfung jeder
  aufgelösten Adresse und jeder Weiterleitung
- Upload-Prüfung über Magic Bytes statt `Content-Type`, kein SVG,
  Zip-Bomben-Erkennung
- Überschriftenbewusster Chunker mit exakten Zeichenoffsets, Seitenzahlen und
  Überlappung
- Extraktoren für PDF (seitenweise), DOCX, HTML (Readability), Text und Markdown
- Worker-Prozess: Job-Schleife, Statusübergänge, Fehlerbehandlung, sauberes
  Beenden auf SIGTERM
- Voyage-Client für Embeddings, in Stapeln mit Backoff und Jitter
- Private Storage-Buckets; der Job zum Import hängt am Insert der Quelle
- Upload-UI mit Drag & Drop, Adress- und Text-Import, Live-Status über Realtime
- Quellen-Viewer mit exakten Zitatankern
- Realtime-Dienst im Stack
- 145 Unit-Tests, davon 57 zum SSRF-Schutz und 22 gegen echte Dateien
- `scripts/ingest-e2e.mjs`: Storage → Trigger → Worker → Voyage → Chunks →
  Realtime gegen den laufenden Stack

- Playwright-Abdeckung für den Quellen-Weg: Anlegen, abgelehnte Adresse,
  Löschen mit Rückfrage

**Offen:**

- Command-Palette (⌘K), aus Phase 1 verschoben

**Vier Fehler, die diese Phase aufgedeckt hat**

1. **Abschnitt über eine Seitengrenze.** Er bekam die Seitenzahl seines Anfangs
   — die Hervorhebung hätte über einen Seitenumbruch hinweg markiert, während
   das Zitat auf eine Seite zeigt. Aufgefallen erst im Zusammenspiel von
   Extraktor und Chunker, nicht in den Tests der Einzelteile.
2. **Zitatanker sassen daneben.** Der Chunker setzte den Inhalt aus Blöcken
   zusammen und trimmte ihn, liess die Zeichengrenzen aber ungetrimmt;
   `text.slice(charStart, charEnd)` ergab damit nicht `content`. Antwort und
   Verweis hätten gestimmt, nur die Markierung wäre verrutscht — niemand hätte
   es als Fehler gemeldet, man hätte der Anwendung nur weniger geglaubt.
   Inhalte werden jetzt aus dem Originaltext geschnitten; sechs Tests halten
   die Zusicherung fest. Gefunden von der Ende-zu-Ende-Probe, nicht von einem
   Unit-Test.
3. **Realtime gab es gar nicht.** Die Quellenliste abonnierte Statusänderungen,
   aber kein Container hörte zu. Die Oberfläche wäre stehengeblieben, bis
   jemand neu lädt — und nach dem Reload stimmt der Zustand ja, also wäre es
   beim Klicken nicht aufgefallen.
4. **Der Stack startete nicht frisch.** Die Bucket-Migration lief vor dem
   Storage-Dienst, der `storage.buckets` erst selbst anlegt. Lokal nie
   sichtbar, weil das Volume schon bestand — genau der Fehler, den der erste
   Fremde beim ersten `docker compose up` trifft.

## Phase 3 — Chat und Zitate 🔨

**Fertig:**

- `match_chunks` mit Reciprocal Rank Fusion, Quellenfilter, `security invoker`
- `chats` und `messages` mit Zitaten als jsonb, kein UPDATE auf Nachrichten
- Zitatformat `[S1:4]`, Parser mit Prüfung gegen den tatsächlichen Kontext
- Streaming-Route (NDJSON) mit Prompt Caching auf Systemprompt und
  Quellenübersicht
- Chat-UI: Streaming, anklickbare Belege, Sprung in den Viewer an die
  Textstelle, Abbrechen
- Quellenfilter in der Oberfläche
- `npm run rag:e2e`: 16 Prüfungen gegen den laufenden Stack mit echten
  Modellaufrufen — Recall, Zitat-Integrität, Abstinenz, Injection-Abwehr,
  Cache-Treffer

**Offen:**

- Mehrere Unterhaltungen pro Notizbuch verwalten (aktuell wird die zuletzt
  bearbeitete fortgesetzt)
- „Antwort als Notiz speichern" — kommt mit Phase 4
- Command-Palette (⌘K), weiter offen aus Phase 1

**Was der Golden-Set-Lauf gezeigt hat:** die Injection-Abwehr hält. Das
Testdokument enthält eine eingebettete Anweisung samt Codewort; das Modell hat
die Sachfrage korrekt beantwortet, das Codewort nicht ausgegeben, den
Systemprompt auch auf direkte Aufforderung nicht genannt — und den Nutzer von
sich aus auf den Manipulationsversuch hingewiesen. Letzteres ist erfreulich,
aber nichts, worauf sich ein Test stützen sollte: es hängt am Modell, nicht an
unserem Code.

**Ein Test war falsch, nicht die Antwort:** die Prüfung „keine erfundene Zahl"
verlangte, dass in einer Antwort auf eine nicht gedeckte Frage gar keine
dreistellige Zahl vorkommt — und schlug an der Jahreszahl aus der Frage selbst
fehl. Geprüft wird jetzt auf eine Umsatzangabe.

## Phase 4 — Notizen und Studio 🔨

**Fertig:**

- Notizen: anlegen, bearbeiten, löschen; Markdown wird beim Anzeigen sanitisiert
- „Antwort als Notiz speichern" — die Belege wandern mit
- Sechs Artefaktarten über Structured Outputs, je eigenes Zod-Schema
- Mermaid für die Mindmap, nachgeladen statt mitgebündelt
- Ein Artefakt je Art und Notizbuch; „veraltet"-Hinweis, sobald eine Quelle
  dazugekommen ist
- 14 Tests gegen die Sanitisierung, 12 gegen die Kontext-Abtastung,
  10 gegen den Mermaid-Erzeuger
- `npm run rag:e2e` prüft zusätzlich drei Artefaktarten Ende zu Ende: Struktur
  vorhanden, Belege zeigen auf echte Abschnitte

**Offen:**

- „Artefakt als Notiz speichern" (Antwort geht schon)
- Playwright-Abdeckung für Notizen und Artefakte — beides braucht eine fertig
  verarbeitete Quelle und damit einen laufenden Worker

**Drei Fehler, die diese Phase aufgedeckt hat**

1. **Structured Outputs nehmen nicht jedes JSON-Schema.** Bei Arrays ist
   `maxItems` gar nicht erlaubt und `minItems` nur mit 0 oder 1. Alle
   Unit-Tests waren grün, und dann lehnte die API jedes einzelne
   Artefaktschema mit HTTP 400 ab. `toStructuredOutputSchema()` dreht die
   Schemas für den Versand; die Anzahlen bleiben in Zod und werden nach der
   Antwort geprüft.
2. **Ein Test war grün, ohne etwas zu prüfen.** Die Sanitizer-Tests
   verwendeten `.process()` ohne `await`; `String(promise)` ergibt
   `'[object Promise]'`, und jede Negativprüfung ging damit durch. Aufgefallen
   ist es nur, weil daneben Positivprüfungen standen.
3. **Fünf Datenbankabfragen nacheinander.** Mit Artefakten und Notizen wurde
   der Seitenaufbau so träge, dass der Playwright-Lauf in der CI scheiterte.
   Jetzt laufen sie nebenläufig — derselbe Gewinn für jeden echten Aufruf.

## Phase 5 — Audio-Überblick 🔨

**Fertig:**

- TTS-Adapter mit zwei Anbietern: Piper für Deutsch, Kokoro für Englisch
- Eigene HTTP-Hülle um Piper (`docker/piper`), damit beide dasselbe Protokoll
  sprechen
- Dialogskript per Structured Output, zwei Sprecherrollen
- ffmpeg: Zusammenschnitt, Pausen, Angleichung der Abtastrate,
  Lautheitsnormalisierung auf −16 LUFS
- Player mit mitlaufendem Transkript; Klick auf einen Beitrag springt dorthin
- Fortschritt live über Realtime, mit echter Beitragszahl statt Schätzung
- 7 Tests gegen echtes ffmpeg
- `AUDIO=1 npm run rag:e2e` prüft den ganzen Weg: 34 Beiträge, 3,4 MB MP3,
  297 Sekunden, beide Sprecher, aufsteigende Startzeiten

**Offen (zurückgestellt, nicht vergessen):**

- **Audio-Cover (Asset 7).** Platzhalter steht, Prompt ist noch zu schreiben —
  1200 × 1200 für die Player-Karte.
- **Stimmenauswahl in der Oberfläche.** Aktuell entscheidet die
  Notebook-Sprache; die Stimmen stehen fest in `VOICES` (worker/src/lib/tts.ts)
  und in der Positivliste von `docker/piper/server.py`. Beide müssten dann
  zusammen erweitert werden — sie sind der Vertrag zwischen Worker und
  Container.
- **TTS-Container in ein Compose-Profil.** Sie starten heute bei jedem
  `docker compose up` mit, und Kokoro lädt beim ersten Start ein Modell
  (rund drei Minuten bis „healthy"). Wer keinen Audio-Überblick braucht,
  wartet umsonst. Behelf bis dahin:
  `docker compose up -d --scale piper=0 --scale kokoro=0`.
- **`ffmpeg` ins Worker-Image.** Der Worker läuft heute auf dem Host, wo
  ffmpeg vorausgesetzt wird. Sobald er in Phase 7 containerisiert wird, muss
  es ins Image — sonst schlägt jeder Audio-Job mit `spawn ffmpeg ENOENT` fehl.
- **Verwaiste Audiodateien beim Löschen eines Notizbuchs.** Die Kaskade räumt
  `artifacts` ab, die MP3 im Bucket bleibt liegen. Dasselbe gilt schon für
  hochgeladene Quellen. Ein Aufräumjob gehört zu Phase 7 (siehe dort); ein
  Datenbank-Trigger scheidet aus, siehe Migration 0011.
- **Kein Playwright-Test für den Player.** Er bräuchte einen fertig
  gerenderten Überblick und damit mehrere Minuten Rechenzeit je Lauf. Geprüft
  wird der Weg über `AUDIO=1 npm run rag:e2e`.

**Ein Fehler, den diese Phase aufgedeckt hat — zum zweiten Mal derselbe Typ:**
Migration 0010 brachte einen Trigger mit, der beim Löschen eines Artefakts die
MP3 aus `storage.objects` entfernen sollte. Der Storage-Dienst verbietet das
ausdrücklich, und weil die Kaskade beim Löschen eines Notizbuchs auch die
Artefakte mitnimmt, war damit **das Löschen ganzer Notizbücher kaputt** — nicht
nur das Aufräumen. Genau wie beim Owner-Trigger in 0003 sah der Einzelfall gut
aus, und eine ganz andere Operation lag am Boden. Gefunden hat es wieder nur
der Ende-zu-Ende-Lauf, und zwar beim Aufräumen am Ende. Der Smoke-Test deckt
die Kaskade jetzt über alle Kindtabellen ab.

## Phase 6 — Teilen ⏸️ zurückgestellt

Auf Wunsch vorerst ausgelassen; Phase 7 kommt vorgezogen.

- Mitglieder einladen, Rollen ändern, entfernen
- Links mit Token und Ablaufdatum
- RLS-Erweiterung für Token-Zugriff
- Nur-Lese-Modus für viewer, Presence im Chat
- größte Erweiterung der Sicherheitssuite

**Was das für den jetzigen Stand bedeutet.** Das Rollenmodell existiert
vollständig — `notebook_members` mit owner, editor und viewer, alle Policies
delegieren an `is_notebook_member`, und die Oberfläche prüft überall
`hasAtLeastRole`. Nur gibt es keinen Weg, jemanden _einzuladen_: jedes
Notizbuch hat genau ein Mitglied, seinen Eigentümer.

Zwei Folgen, die man kennen sollte:

1. **Die Angriffsfläche des Teilens gibt es noch nicht.** Kein Token, kein
   öffentlicher Link, keine fremde Sitzung in einem fremden Notizbuch. Das ist
   der angenehme Teil.
2. **Die viewer-Pfade sind gebaut, aber nie im Einsatz.** Read-only-Zustände,
   ausgeblendete Schaltflächen, der Playwright-Test „ein viewer bekommt keine
   Schaltfläche zum Hinzufügen" — sie prüfen bisher nur den Eigentümerfall.
   Wenn Phase 6 kommt, sind das die ersten Stellen, die eine echte Prüfung
   brauchen.

Die Sicherheitssuite prüft die Rollentrennung heute schon auf Datenbankebene
(fremder Nutzer sieht nichts, kann nichts schreiben). Was fehlt, ist der Fall
„Mitglied mit zu geringer Rolle" — den gibt es ohne Einladungen nicht
herzustellen.

## Phase 7 — Härtung und Betrieb

- **Aufräumjob für verwaiste Dateien.** Beim Löschen eines Notizbuchs räumt
  die Kaskade die Datenbank ab, im Storage bleiben Quelldateien, extrahierte
  Texte und Audiodateien liegen. Ein Datenbank-Trigger scheidet aus — der
  Storage-Dienst verbietet direktes Löschen aus seinen Tabellen und machte
  damit einmal das Löschen ganzer Notizbücher unmöglich (Migration 0011). Der
  Job gehört in den Worker: Objekte auflisten, gegen `sources` und `artifacts`
  abgleichen, Verwaiste über die Storage-API entfernen. Das ist auch ein
  Datenschutzthema — ein gelöschtes Notizbuch soll gelöscht sein.
- **`ffmpeg` ins Worker-Image**, sobald der Worker containerisiert wird.
- **Standalone-Server statt `next start`.** Die Anwendung baut mit
  `output: standalone`; `next start` warnt dabei ausdrücklich, dass das nicht
  vorgesehen ist, und liefert trotzdem aus. Für das Produktionsimage ist
  `node .next/standalone/server.js` der richtige Weg — mit den Kopierschritten
  für `.next/static` und `public`. Sobald das steht, sollte auch der
  Playwright-Lauf in der CI darauf umgestellt werden, damit dort genau das
  läuft, was ausgeliefert wird.
- i18n (de, en), Rate-Limits, Kostenerfassung in `llm_usage`
- `pino`-Logging, `/api/health` mit DB-, Storage- und Worker-Prüfung
- `docker-compose.prod.yml` mit Caddy, TLS, CSP und HSTS
- Backup-Skript und einmal echt geprobter Restore
- Accessibility-Durchgang mit axe, Performance, Bundle-Analyse
- `docs/deployment.md`, `docs/operations.md`
