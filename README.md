# Notebook Studio

Ein selbst gehosteter NotebookLM-Klon: eigene Quellen hochladen und mit belegten
Antworten durcharbeiten. Jede Aussage im Chat führt per Klick zur Textstelle, aus
der sie stammt.

> **Hinweis:** Dieses Projekt ist ein unabhängiges Lern- und Demonstrationsprojekt.
> Es steht in keiner Verbindung zu Google und wird weder von Google entwickelt
> noch unterstützt.

Der Unterschied zu einem allgemeinen Chatbot ist das **Grounding**: Das Modell
antwortet ausschließlich aus den hochgeladenen Quellen und markiert jede
Sachaussage mit einem Zitat. Deckt das Material eine Frage nicht ab, sagt es das,
statt zu raten.

> **Status:** einsatzfähig für den Eigenbetrieb. Quellenimport, belegter Chat,
> Notizen, Studio-Artefakte und Audio-Überblicke funktionieren. Teilen und
> Zusammenarbeit sind architektonisch vorbereitet, aber noch nicht über die
> Oberfläche verfügbar. Der aktuelle Stand und offene Punkte stehen in
> [docs/roadmap.md](docs/roadmap.md).

## Projektziel

Ziel ist nicht, jede Funktion von NotebookLM nachzubauen. Der Schwerpunkt liegt
auf einem belastbaren Kern: Quellen sicher importieren, Antworten ausschließlich
aus diesen Quellen erzeugen und jede Aussage nachvollziehbar belegen.

## Schnell ansehen

Der wichtigste Ablauf für eine Demo:

1. Notebook anlegen
2. PDF, DOCX, URL oder Text als Quelle hinzufügen
3. Eine Frage zu den Quellen stellen
4. Über ein Zitat direkt zur belegenden Textstelle springen
5. Aus denselben Quellen ein Studio-Artefakt oder einen Audio-Überblick erzeugen

Eine gehostete Demo ist bewusst nicht Teil des Repositories, da dafür externe
Modell-APIs und ein eigener Server benötigt werden. Der lokale Schnellstart unten
setzt die vollständige Anwendung reproduzierbar auf.

## Funktionen

| Bereich | Status | Was es tut |
| --- | --- | --- |
| **Quellen** | ✅ verfügbar | PDF, DOCX, Markdown, Textdateien, URLs und eingefügter Text. Inhalte werden extrahiert, strukturbewusst zerlegt und als Vektoren indexiert. |
| **Chat** | ✅ verfügbar | Hybride Suche aus Vektor- und Volltexttreffern, Streaming-Antworten und klickbare Zitate für belegte Aussagen. |
| **Notizen** | ✅ verfügbar | Eigene Markdown-Notizen und gespeicherte Antworten einschließlich ihrer Belege. |
| **Studio** | ✅ verfügbar | Zusammenfassung, Lernleitfaden, FAQ, Zeitleiste, Briefing und Mindmap aus den ausgewählten Quellen. |
| **Audio** | ✅ verfügbar | Zweistimmiger Dialog über die Quellen als MP3, lokal per TTS erzeugt. |
| **Zusammenarbeit** | 🚧 vorbereitet | Rollenmodell für Owner, Editor und Viewer ist vorhanden. Einladungen und Freigabelinks fehlen noch. |

## Technik

Next.js (App Router) und TypeScript im Frontend, Supabase self-hosted für
Datenbank, Auth und Storage, Postgres mit pgvector für die Suche, Claude für
Chat und Artefakte, Voyage AI für Embeddings, Piper und Kokoro für die
Sprachausgabe. Alles läuft in Docker auf einem einzelnen Server — es gibt
keine Abhängigkeit von einem Managed-Dienst außer den beiden Modell-APIs.

Wie die Teile zusammenspielen: [docs/architecture.md](docs/architecture.md).

## Voraussetzungen und laufende Kosten

Für den Betrieb werden Docker, Node.js 24 sowie eigene API-Zugänge für Anthropic
und Voyage AI benötigt. Die Nutzung dieser APIs kann abhängig von Dokumentmenge,
Fragen, Artefakten und Embeddings Kosten verursachen. Das Repository enthält
keine API-Schlüssel und stellt keine kostenlosen Modellkontingente bereit.

## Schnellstart

Voraussetzungen: Docker und Node.js 24.

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

Ob der Stack wirklich funktioniert — nicht nur „läuft“ — prüft:

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

## Qualitätssicherung

Die CI prüft jeden Pull Request und Änderungen auf `main` mit:

- Linting, Formatierung und TypeScript
- Unit- und Integrationstests
- frischem Produktionsbuild
- RLS- und Datenbanktests gegen einen echten Stack
- Playwright-End-to-End-Tests
- Secret-Scan über die vollständige Git-Historie
- Audit der npm-Abhängigkeiten

## Dokumentation

| Datei | Inhalt |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Komponenten, Datenflüsse, warum es so gebaut ist |
| [docs/data-model.md](docs/data-model.md) | Tabellen, Beziehungen, RLS-Regeln |
| [docs/security.md](docs/security.md) | Bedrohungsmodell, Berechtigungsmatrix, Secrets |
| [docs/development.md](docs/development.md) | Lokales Setup, Tests, Migrationen, Konventionen |
| [docs/rag.md](docs/rag.md) | Chunking, Hybrid-Suche, Zitate, Prompt-Aufbau |
| [docs/deployment.md](docs/deployment.md) | Server aufsetzen, Abnahmeliste, Aktualisieren |
| [docs/operations.md](docs/operations.md) | Runbooks: Sichern, Wiederherstellen, Störungen |
| [docs/adr/](docs/adr/) | Architekturentscheidungen samt Begründung |
| [assets/PROMPTS.md](assets/PROMPTS.md) | Bild-Prompts für alle Grafiken |
| [SECURITY.md](SECURITY.md) | Sicherheitslücken verantwortungsvoll melden |
| [docs/public-release-checklist.md](docs/public-release-checklist.md) | Checkliste vor dem öffentlichen Release |

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
- Content-Security-Policy mit Nonce je Anfrage, geprüft gegen den
  Produktionsbuild — dort, wo eine zu strenge Richtlinie die Anwendung
  stillschweigend lähmt.
- Kontingente je Nutzer für alles, was Geld kostet, gezählt in der Datenbank
  statt im Prozessspeicher.

Vollständig in [docs/security.md](docs/security.md). Sicherheitslücken bitte
nicht öffentlich melden, sondern gemäß [SECURITY.md](SECURITY.md).

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](LICENSE). Dadurch darf der Code auch
verändert, weitergegeben und kommerziell genutzt werden, solange der Copyright-
und Lizenzhinweis erhalten bleibt.
