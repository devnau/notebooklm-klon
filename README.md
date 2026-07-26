# Notebook Studio

Ein selbst gehosteter NotebookLM-Klon: eigene Quellen hochladen und mit belegten
Antworten durcharbeiten. Jede Aussage im Chat führt per Klick zur Textstelle, aus
der sie stammt.

Der Unterschied zu einem allgemeinen Chatbot ist das **Grounding**: das Modell
antwortet ausschließlich aus den hochgeladenen Quellen und markiert jede
Sachaussage mit einem Zitat. Deckt das Material eine Frage nicht ab, sagt es das
statt zu raten.

> **Status:** in Entwicklung. Der Fortschritt steht in [docs/roadmap.md](docs/roadmap.md).

## Funktionen

| Bereich     | Was es tut                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Quellen** | PDF, DOCX, Markdown, Textdateien, URLs und eingefügter Text. Werden extrahiert, strukturbewusst zerlegt und als Vektoren indexiert. |
| **Chat**    | Hybride Suche (Vektor + Volltext) über die Quellen, Antwort im Streaming, jede Aussage mit klickbarem Zitat.                        |
| **Notizen** | Eigene Notizen und gespeicherte Antworten, Markdown.                                                                                |
| **Studio**  | Generierte Artefakte: Zusammenfassung, Lernleitfaden, FAQ, Zeitleiste, Briefing, Mindmap.                                           |
| **Audio**   | Zweistimmiger Dialog über die Quellen als MP3, lokal per TTS erzeugt.                                                               |
| **Teilen**  | Notebooks mit Rollen (Owner, Editor, Viewer) und Links mit Ablaufdatum.                                                             |

## Technik

Next.js (App Router) und TypeScript im Frontend, Supabase self-hosted für
Datenbank, Auth und Storage, Postgres mit pgvector für die Suche, Claude für
Chat und Artefakte, Voyage AI für Embeddings, Piper und Kokoro für die
Sprachausgabe. Alles läuft in Docker auf einem einzelnen Server — es gibt
keine Abhängigkeit von einem Managed-Dienst außer den beiden Modell-APIs.

Wie die Teile zusammenspielen: [docs/architecture.md](docs/architecture.md).

## Schnellstart

Voraussetzungen: Docker und Node.js 22 oder neuer.

```bash
git clone https://github.com/devnau/notebooklm-klon.git
cd notebooklm-klon
npm install

# Secrets erzeugen (Postgres-Passwort, JWT-Secret, anon- und service_role-Key)
node scripts/generate-secrets.mjs > .env
chmod 600 .env

# ANTHROPIC_API_KEY und VOYAGE_API_KEY in .env eintragen, dann:
docker compose up -d --wait
npm run dev
```

Die App läuft auf <http://localhost:3000>, das API-Gateway auf
<http://localhost:8000>, abgefangene E-Mails (Magic Links) liegen in Mailpit auf
<http://localhost:8025>.

Ob der Stack wirklich funktioniert — nicht nur „läuft" — prüft:

```bash
node scripts/smoke-test.mjs
```

## Entwicklung

```bash
npm run dev          # Next.js im Entwicklungsmodus
npm test             # Unit- und Integrationstests
npm run typecheck    # TypeScript über alle Pakete
npm run lint         # ESLint
npm run format       # Prettier
```

Details, Konventionen und wie man eine Migration schreibt:
[docs/development.md](docs/development.md).

## Dokumentation

| Datei                                        | Inhalt                                           |
| -------------------------------------------- | ------------------------------------------------ |
| [docs/architecture.md](docs/architecture.md) | Komponenten, Datenflüsse, warum es so gebaut ist |
| [docs/data-model.md](docs/data-model.md)     | Tabellen, Beziehungen, RLS-Regeln                |
| [docs/security.md](docs/security.md)         | Bedrohungsmodell, Berechtigungsmatrix, Secrets   |
| [docs/development.md](docs/development.md)   | Lokales Setup, Tests, Migrationen, Konventionen  |
| [docs/adr/](docs/adr/)                       | Architekturentscheidungen samt Begründung        |
| [assets/PROMPTS.md](assets/PROMPTS.md)       | Bild-Prompts für alle Grafiken                   |

## Sicherheit

Mehrere Nutzer legen hier eigene Dokumente ab und teilen sie. Der teuerste
denkbare Fehler ist deshalb keine kaputte Schaltfläche, sondern ein Datenleck
zwischen zwei Notebooks. Entsprechend liegt der Schwerpunkt der Tests:

- Row Level Security auf **jeder** Tabelle, mit `FORCE`, geprüft gegen eine
  echte Datenbank statt gegen Annahmen.
- Uploads werden über Magic Bytes validiert, nicht über den `Content-Type`.
- Der URL-Import ist gegen SSRF abgesichert (private Netze, Metadaten-Endpunkte,
  Redirect-Ketten).
- Quellen-Inhalte gehen als Daten in den Prompt, klar abgegrenzt von
  Anweisungen; Prompt-Injection wird getestet.

Vollständig in [docs/security.md](docs/security.md). Ein Fund gehört nicht in ein
öffentliches Issue — bitte an <dev@dennis-nau.de>.

## Lizenz

MIT
