# Betrieb

Runbooks für die Fälle, die eintreten. Jeder Abschnitt beantwortet zwei Fragen:
woran man es merkt, und was man dann tut.

## Zustand prüfen

```bash
curl -s https://notizbuch.example.de/api/health | jq
```

```json
{
  "status": "ok",
  "datenbank": "ok",
  "storage": "ok",
  "worker": "unbekannt",
  "warteschlange": { "offen": 0, "haengend": 0 }
}
```

`worker: "unbekannt"` ist **kein Fehler**. Der Worker hört auf keinem Port; ob
er lebt, lässt sich nur an seiner Arbeit ablesen, und „nichts zu tun" ist der
Normalfall. Als `fehler` erscheint er, wenn Jobs hängen oder sich mehr als 25
stauen.

Der Endpunkt antwortet mit **503**, sobald etwas klemmt — nicht mit 200 und
einem Fehlerfeld. Ein Uptime-Prüfer, der nur den Statuscode ansieht, hielte das
sonst für gesund.

Für einen Überblick über die Container:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose logs --tail 100 worker
```

---

## Ein Import bleibt hängen

**Woran man es merkt.** Eine Quelle steht in der Oberfläche dauerhaft auf „Wird
gelesen" oder „Wird indexiert". `/api/health` zeigt `haengend > 0`.

**Was dahintersteckt.** Der Worker ist mitten in der Arbeit gestorben. Sein Job
steht weiter auf `running` und wird von keinem anderen aufgegriffen.

**Was zu tun ist.** Nichts — `requeue_stale_jobs()` gibt ihn nach Ablauf der
Lease (15 Minuten) selbst wieder frei, und der Worker ruft das beim Start und
im Leerlauf auf. Wer nicht warten will:

```bash
docker compose exec db psql -U postgres -c \
  "select public.requeue_stale_jobs(900);"
```

**Wenn es sich wiederholt**, ist nicht die Warteschlange das Problem. Dann in
die Worker-Logs sehen: ein Dokument, das den Parser abstürzen lässt, oder ein
Speicherlimit, das der PDF-Verarbeitung nicht reicht.

```bash
docker compose logs worker | grep -i 'fehlgeschlagen'
```

---

## Eine Quelle schlägt dauerhaft fehl

**Woran man es merkt.** Status `Fehlgeschlagen` mit Meldung in der Oberfläche.

Die Meldung ist die für Nutzer gedachte Fassung. Die technische steht im Log:

```bash
docker compose logs worker | grep '<quellen-id>'
```

**Häufige Fälle:**

| Meldung                               | Ursache             | Abhilfe                                                 |
| ------------------------------------- | ------------------- | ------------------------------------------------------- |
| „PDF enthält keine Textebene"         | gescanntes Dokument | OCR vorschalten; die Anwendung kann es nicht            |
| „Die Textindexierung ist ausgelastet" | Voyage-Rate-Limit   | wartet selbst; bei Dauerzustand Zahlungsart hinterlegen |
| „Der Inhalt passt nicht zum Dateityp" | Magic-Byte-Prüfung  | Datei ist beschädigt oder falsch benannt                |
| „Adresse im lokalen Netz"             | SSRF-Schutz         | gewollt                                                 |

Ein erneuter Versuch geht über die Schaltfläche in der Oberfläche. Nur
fehlgeschlagene Quellen lassen sich wiederholen — bei einer laufenden würde
derselbe Text doppelt eingebettet.

---

## Kosten prüfen

Alles, was Geld kostet, steht in `llm_usage`.

```sql
-- Verbrauch der letzten 30 Tage nach Art
select kind, model,
       sum(input_tokens) as eingang,
       sum(output_tokens) as ausgang,
       sum(cache_read_tokens) as aus_cache,
       count(*) as aufrufe
from public.llm_usage
where created_at > now() - interval '30 days'
group by kind, model
order by sum(input_tokens) desc;
```

```sql
-- Wer verbraucht am meisten
select u.email, count(*) as aufrufe, sum(l.input_tokens + l.output_tokens) as tokens
from public.llm_usage l
join auth.users u on u.id = l.user_id
where l.created_at > now() - interval '7 days'
group by u.email
order by tokens desc
limit 20;
```

**`aus_cache` im Verhältnis zu `eingang` ist die wichtigste Zahl.** Liegt sie
bei null, greift das Prompt Caching nicht, und die Eingangskosten sind ein
Vielfaches des Nötigen. Bei Folgefragen im selben Notizbuch sollte sie deutlich
über null liegen — was den Prefix invalidiert, steht in
[docs/rag.md](rag.md#prompt-aufbau).

Die Kontingente je Nutzer und Stunde stehen in
`packages/shared/src/limits.ts`. Sie gelten pro Nutzer, nicht global — bei
vielen Nutzern begrenzt sie niemand in der Summe.

---

## Schlüssel wechseln

### Anthropic oder Voyage

Unkritisch, weil zustandslos:

```bash
# .env anpassen, dann
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d web worker
```

Ein laufender Job scheitert dabei und wird wiederholt. Der Worker beendet
laufende Arbeit vor dem Neustart (`stop_grace_period: 120s`).

### JWT_SECRET

**Das trennt alle Sitzungen und macht die Supabase-Schlüssel ungültig.** Anon-
und Service-Role-Key sind damit signiert.

```bash
node scripts/generate-secrets.mjs > .env.neu
# JWT_SECRET, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY übernehmen,
# alles andere aus der alten .env behalten — besonders POSTGRES_PASSWORD.
```

Danach **muss das Web-Image neu gebaut werden**: der Anon-Key steckt zur
Build-Zeit im Browser-Bundle.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### POSTGRES_PASSWORD

Am aufwendigsten. Das Passwort gilt für mehrere Rollen, und `migrate.sh`
synchronisiert sie beim Start — es reicht also **nicht**, nur die `.env` zu
ändern, ohne den migrate-Job laufen zu lassen.

```bash
# 1. Passwort in der .env ändern
# 2. Rollen von Hand nachziehen, solange die alte Verbindung noch steht:
docker compose exec db psql -U supabase_admin -c \
  "alter role postgres with password '<neu>';"
# 3. Stack neu starten — migrate.sh zieht die übrigen Rollen nach
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Zwischen Schritt 1 und 3 sind Auth, REST und Storage nicht erreichbar.

---

## Sichern und wiederherstellen

### Nächtliche Sicherung

```cron
0 3 * * *  cd /opt/notebooklm-klon && ./scripts/backup.sh >> /var/log/nlm-backup.log 2>&1
```

Erzeugt je Lauf einen Ordner mit drei Dateien:

| Datei            | Inhalt                                   | Zweck                            |
| ---------------- | ---------------------------------------- | -------------------------------- |
| `daten.sql.gz`   | `pg_dump --data-only --disable-triggers` | **damit wird wiederhergestellt** |
| `schema.sql.gz`  | `pg_dump --schema-only`                  | Nachsehen, Vergleichen           |
| `storage.tar.gz` | Inhalt des Storage-Volumes               | Quelldateien, Texte, Audio       |
| `kennzahlen.txt` | Zeilenzahlen                             | Gegenprobe beim Rückspielen      |

Vorhaltung 14 Tage, einstellbar über `BACKUP_RETENTION_DAYS`.

**Die Sicherung liegt auf demselben Rechner.** Das ist gegen ein
Versehen ausreichend und gegen einen Ausfall der Platte nutzlos — der Ordner
gehört per `rsync` oder Objektspeicher woandershin. Das ist bewusst nicht
Aufgabe dieses Skripts: wohin, hängt von der Umgebung ab.

### Wiederherstellen

Das Verfahren setzt einen **frischen Stack** voraus. Der Abzug enthält nur
Daten; das Schema baut sich aus den Migrationen und den Diensten selbst auf.

Auf eine Datenbank mit Daten darf er **nicht** eingespielt werden — die Zeilen
kämen doppelt.

```bash
# 1. Alles anhalten und die Volumes verwerfen
docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v

# 2. Frisch hochfahren. Migrationen und Dienste legen das Schema an.
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --wait

# 3. Daten einspielen. Als supabase_admin: --disable-triggers verlangt
#    Superuser-Rechte, und die auth-Tabellen gehören supabase_auth_admin.
gunzip -c backups/<datum>/daten.sql.gz \
  | docker compose exec -T db psql -U supabase_admin -d postgres

# 4. Dateien einspielen
gunzip -c backups/<datum>/storage.tar.gz \
  | docker compose exec -T storage tar -C /var/lib/storage -xf -

# 5. Gegenprobe
cat backups/<datum>/kennzahlen.txt
curl -s localhost/api/health | jq
```

In Schritt 3 sind Meldungen zu **erwarten**: Primärschlüssel-Konflikte auf
`schema_migrations`, `auth.schema_migrations`, `storage.migrations` und
`profiles`. Diese Tabellen füllt der frische Stack selbst, und die Zeilen sind
identisch. Alles andere ist ein echter Fehler.

### Die Sicherung prüfen

```bash
npm run restore:probe
```

Fährt ein **eigenes** Compose-Projekt mit eigenen Volumes hoch, spielt die
neueste Sicherung ein und vergleicht Zeilenzahlen, Erweiterungen, Indizes, RLS
und eine echte Suchabfrage. Dauert einige Minuten, rührt die Installation nicht
an.

**Diese Probe hat drei Backup-Verfahren durchfallen lassen**, und jedes wäre im
Ernstfall als „Sicherung vorhanden" durchgegangen:

1. Vollständiger Abzug mit `--clean`: die DROP-Anweisungen entfernten Schemas,
   die das Image selbst angelegt hatte — der Datenbankserver stürzte mitten im
   Einspielen ab.
2. Rein additiv in eine Datenbank ohne laufende Dienste: jedes `COPY` auf
   `auth`-Tabellen scheiterte, weil GoTrue sein Schema erst beim Start
   vervollständigt. Ergebnis: alle Anwendungsdaten da, **null Nutzer**.
3. Rein additiv in einen vollständigen Stack: Fremdschlüssel-Verletzungen, weil
   `pg_dump` alphabetisch schreibt und `chunks` vor `sources` kommt. Ergebnis:
   **null Abschnitte**.

Sie gehört einmal im Monat ausgeführt, nicht einmal beim Aufsetzen.

---

## Verwaiste Dateien

**Woran man es merkt.** Das Storage-Volume wächst, obwohl keine Quellen
hinzukommen.

**Was dahintersteckt.** Beim Löschen eines Notizbuchs räumt die Kaskade die
Datenbank ab; Storage kennt die Fremdschlüssel nicht. Dasselbe gilt für
abgebrochene Uploads.

**Was zu tun ist.** Der Worker räumt im Leerlauf auf, etwa alle 25 Minuten. Auf
Zuruf:

```bash
docker compose exec worker npm run cleanup --workspace=@nlm/worker
```

Gelöscht wird nur, was älter als eine Stunde ist und in keiner Zeile steht —
der Abstand verhindert, dass gerade eintreffende Uploads erwischt werden.

Geprüft mit `npm run cleanup:probe` gegen den laufenden Stack.

---

## Migration fehlgeschlagen

**Woran man es merkt.** `docker compose up` bricht ab, der `migrate`-Container
beendet sich mit Fehler, und Auth, REST und Storage starten nicht — sie warten
auf seinen Abschluss.

```bash
docker compose logs migrate
```

**Angewandte Migrationen sind unveränderlich.** `migrate.sh` speichert eine
MD5-Summe je Datei und bricht ab, wenn sich eine bereits angewandte Datei
geändert hat:

```
✗ Migration migrations/0008_… wurde nachträglich verändert.
```

Das ist kein Fehler des Skripts, sondern der Hinweis, dass Entwicklungs- und
Produktionsschema auseinanderlaufen würden. Korrekturen kommen als **neue**
Migration.

**Bricht eine neue Migration ab**, ist nichts halb angewandt: jede läuft in
einer Transaktion zusammen mit ihrem Protokolleintrag. Die Datei korrigieren
und erneut starten.

**Rollback.** Es gibt keinen automatischen. Eine Migration, die zurückgenommen
werden muss, bekommt eine neue Nummer, die das Gegenteil tut — so wie 0011 den
Trigger aus 0010 zurücknimmt. Der Grund: eine `down`-Migration, die nie
ausgeführt wird, ist ungetesteter Code an der empfindlichsten Stelle des
Systems.

---

## TTS-Dienste

Piper und Kokoro werden **nur für den Audio-Überblick** gebraucht. Kokoro lädt
beim ersten Start ein Modell und braucht rund drei Minuten, bis es gesund ist.

Wer den Audio-Überblick nicht nutzt:

```bash
docker compose up -d --scale piper=0 --scale kokoro=0
```

Der Rest der Anwendung hängt nicht an ihnen. Ein `render_audio`-Job schlägt dann
mit „Die Sprachausgabe ist nicht erreichbar" fehl und wird wiederholt.

---

## Was nicht überwacht wird

Ehrlichkeitshalber, damit niemand sich in falscher Sicherheit wiegt:

- **Kein Alarm.** `/api/health` muss von außen abgefragt werden; die Anwendung
  meldet sich nicht selbst. Ein Uptime-Dienst darauf ist die halbe Stunde
  Einrichtung wert.
- **Keine Fehlererfassung.** Ausnahmen stehen in den Container-Logs und
  verschwinden mit ihnen. Sentry oder Vergleichbares wäre der nächste Schritt.
- **Keine Kostenwarnung.** `llm_usage` sammelt die Zahlen, wertet sie aber
  niemand aus. Ein Kontingent bei Anthropic und Voyage ist der wirksamere
  Schutz.
- **Kein Backup-Monitoring.** Bleibt der cron-Job aus, fällt es niemandem auf.
  Die Ordnerliste gelegentlich ansehen.
