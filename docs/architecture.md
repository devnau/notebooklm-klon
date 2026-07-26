# Architektur

## Überblick

```
┌──────────────────────────────┐        ┌────────────────────────────┐
│  Next.js (App Router, TS)    │        │  Worker (Node, TS)         │
│                              │        │                            │
│  Server Components: UI       │        │  Poll jobs-Tabelle mit     │
│  Route Handlers:             │        │  FOR UPDATE SKIP LOCKED    │
│   /api/chat      SSE         │        │   • ingest_source          │
│   /api/sources   Upload      │        │   • generate_artifact      │
│   /api/artifacts Job         │        │   • render_audio           │
└──────────────┬───────────────┘        └─────────────┬──────────────┘
               │                                      │
   ┌───────────▼──────────────────────────────────────▼─────────────┐
   │  Caddy (Gateway)                                               │
   │   /auth/v1/*     → GoTrue                                      │
   │   /rest/v1/*     → PostgREST                                   │
   │   /storage/v1/*  → Storage-API                                 │
   └───────────┬────────────────────────────────────────────────────┘
               │
   ┌───────────▼────────────────────────────────────────────────────┐
   │  Postgres 17 + pgvector                                        │
   │   public.*   Anwendungsdaten, RLS auf jeder Tabelle            │
   │   auth.*     GoTrue                                            │
   │   storage.*  Storage-API                                       │
   └────────────────────────────────────────────────────────────────┘

   Externe APIs:  Anthropic (Chat, Artefakte) · Voyage AI (Embeddings)
   Lokale Dienste: Piper / Kokoro (TTS, ab Phase 5)
```

Nach außen ist in Produktion nur Caddy auf 80/443 offen. Postgres, Storage und
die TTS-Dienste liegen im internen Docker-Netz und haben keinen veröffentlichten
Port.

## Warum es so gebaut ist

### Ein eigener Worker statt Edge Functions

Ingestion (ein 200-Seiten-PDF lesen, zerlegen, einbetten) und TTS-Rendering
dauern Minuten. Das passt in kein Request-Timeout. Der Worker ist ein
langlaufender Node-Container, der eine `jobs`-Tabelle mit
`SELECT ... FOR UPDATE SKIP LOCKED` abarbeitet.

Vorteile gegenüber Deno-Edge-Functions plus `pg_cron`: dieselbe Sprache und
dieselben Typen wie die App, Retries und Fortschritt liegen als Zeilen in der
Datenbank (und sind damit ohne Zusatzarbeit in der UI sichtbar), und Debugging
ist ein normaler Node-Prozess. `SKIP LOCKED` erlaubt außerdem mehrere
Worker-Instanzen ohne Koordinationsdienst.

### Caddy als Gateway statt Kong

`@supabase/supabase-js` erwartet Auth, REST und Storage unter einer Origin. Das
offizielle Supabase-Setup löst das mit Kong. Wir brauchen für TLS ohnehin einen
Reverse Proxy, also macht Caddy beides. Das spart einen Container und eine
Konfigurationssprache. Siehe [ADR 0002](adr/0002-caddy-statt-kong.md).

### Hybride Suche statt Long-Context

Alle Quellen in jeden Prompt zu legen wäre einfacher, aber teuer und bei
größeren Sammlungen unmöglich. Vektorsuche allein verfehlt exakte Begriffe —
Eigennamen, Aktenzeichen, Paragraphen. Deshalb beides: Vektor und Volltext
getrennt, dann per Reciprocal Rank Fusion zusammengeführt. Siehe
[ADR 0003](adr/0003-hybrid-retrieval.md).

### Ein Ort für Zugriffsentscheidungen

Sämtliche RLS-Policies delegieren an `public.is_notebook_member(nb, min_role)`.
Wird das Berechtigungsmodell erweitert, ändert sich eine Funktion statt zwanzig
Policies. Das ist der Grund, warum Sharing (Phase 6) keine Umbauten am
Datenmodell braucht.

## Datenfluss: Upload bis Antwort

```
1  Browser lädt Datei hoch
     → Route Handler prüft Größe, MIME-Typ und Magic Bytes
     → Datei in Storage-Bucket 'sources'
     → Zeile in sources (status: pending) + Zeile in jobs (ingest_source)

2  Worker greift den Job
     → status: extracting
     → Text extrahieren (PDF pro Seite, DOCX über Mammoth, HTML über Readability)
     → an Überschriften zerlegen, dann auf ~800 Tokens mit Überlappung
     → status: embedding
     → Embeddings in Batches von 128 bei Voyage
     → chunks in einem Insert schreiben
     → Kurzzusammenfassung und Schlagworte per Claude
     → status: ready

   Die UI verfolgt jeden Schritt live über Supabase Realtime.

3  Nutzer stellt eine Frage
     → Query-Embedding
     → match_chunks(): Vektor-Top-60 + Volltext-Top-60 → RRF → Top-20
     → Prompt: stabiler Prefix (System + Quellenübersicht, gecacht)
               danach die variable Frage
     → Claude streamt die Antwort
     → Zitatmarker [S3:12] werden serverseitig geparst und persistiert

4  Nutzer klickt ein Zitat
     → Source-Viewer öffnet, springt an char_start/char_end bzw. die Seite
```

## Zitatformat

Im Prompt bekommt jeder Auszug ein stabiles Label:

```
[S3:12] (Quelle 3, Chunk 12) · Kapitel 2 › Methodik
<Text des Auszugs>
```

Das Modell markiert damit jede Sachaussage. Serverseitig wird jeder Marker gegen
die tatsächlich gelieferten Chunks geprüft — ein Marker, der auf einen nicht
gelieferten Chunk zeigt, ist ein erfundenes Zitat und wird verworfen statt
angezeigt. Der Test dafür liegt in `tests/rag/`.

## Prompt Caching

Der Systemprompt und die Quellenübersicht bilden einen unveränderlichen Prefix
mit `cache_control`. Nur die Frage variiert und steht dahinter. Bei Folgefragen
im gleichen Notebook wird der Großteil der Eingabe aus dem Cache gelesen.

Damit das funktioniert, darf in den Prefix nichts Wechselndes geraten: kein
Zeitstempel, keine Anfrage-ID, keine nach Zufall sortierten Chunks. Die
Chunk-Reihenfolge ist deshalb deterministisch (nach Score, dann nach ID).
`usage.cache_read_input_tokens` in der Antwort ist der Beleg, dass es greift.

## Verzeichnisstruktur

```
apps/web/               Next.js
  src/app/              Routen (App Router)
  src/components/       UI-Komponenten
  src/lib/              supabase, rag, llm, security, i18n
apps/worker/            Job-Worker
packages/shared/        Typen, Zod-Schemas, Konstanten, Prompts
supabase/migrations/    SQL, aufsteigend numeriert, unveränderlich
docker/                 Caddy- und DB-Konfiguration
scripts/                Secrets erzeugen, Smoke-Test
tests/security/         RLS- und Authz-Suite gegen echtes Postgres
docs/                   diese Dokumentation
```
