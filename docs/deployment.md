# Deployment

Wie die Anwendung auf einen eigenen Server kommt. Für den laufenden Betrieb
danach: [docs/operations.md](operations.md).

## Was der Server braucht

|        | Minimum | Empfohlen | Warum                                                   |
| ------ | ------- | --------- | ------------------------------------------------------- |
| CPU    | 2 Kerne | 4 Kerne   | Sprachsynthese läuft auf CPU, grob in Echtzeit          |
| RAM    | 6 GB    | 12 GB     | Postgres 2 GB, Worker 3 GB, Kokoro 4 GB                 |
| Platte | 40 GB   | 100 GB    | Images rund 3 GB, dazu Dokumente, Audio und Sicherungen |

Der Speicherbedarf kommt nicht von der Anwendung, sondern von zwei Stellen: die
PDF-Verarbeitung hält ein Dokument beim Parsen vollständig im Speicher, und
Kokoro hält sein Modell dauerhaft dort. **Ohne den Audio-Überblick reichen 6 GB
bequem** — Piper und Kokoro lassen sich weglassen (siehe unten).

Software: Docker mit Compose v2. Sonst nichts — Node, Postgres und ffmpeg
stecken in den Images.

## Vorbereitung

### DNS

Ein A-Record auf die Server-Adresse. Caddy holt das Zertifikat über Let's
Encrypt und braucht dafür die Ports 80 und 443 aus dem Internet erreichbar —
Port 80 auch dauerhaft, für die Erneuerung.

### Firewall

```bash
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # ACME und Weiterleitung
ufw allow 443/tcp    # HTTPS
ufw allow 443/udp    # HTTP/3
ufw enable
```

Postgres, Storage, Realtime und die Sprachausgabe brauchen **keinen** offenen
Port. Das Prod-Overlay hebt alle Portfreigaben der Entwicklungsdatei auf; zu
prüfen mit:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config \
  | grep -A 3 'ports:'
```

Erwartet: nur der `gateway`-Dienst.

## Aufsetzen

```bash
git clone git@github.com:devnau/notebooklm-klon.git /opt/notebooklm-klon
cd /opt/notebooklm-klon

# Secrets erzeugen. Erzeugt auch die signierten Supabase-Schlüssel — die sind
# keine Zufallsstrings, sondern JWTs, und selbst zusammengebaut eine
# zuverlässige Fehlerquelle.
node scripts/generate-secrets.mjs > .env
chmod 600 .env
```

Dann in der `.env` ergänzen und anpassen:

```bash
# Öffentliche Adresse — muss überall dieselbe sein
PUBLIC_HOST=notizbuch.example.de
ACME_EMAIL=admin@example.de
PUBLIC_GATEWAY_URL=https://notizbuch.example.de
PUBLIC_APP_URL=https://notizbuch.example.de
NEXT_PUBLIC_SUPABASE_URL=https://notizbuch.example.de

# Von Hand eintragen
ANTHROPIC_API_KEY=sk-ant-…
VOYAGE_API_KEY=pa-…

# Echter Mailversand statt Mailpit
SMTP_HOST=smtp.example.de
SMTP_PORT=587
SMTP_USER=notizbuch@example.de
SMTP_PASS=…
SMTP_ADMIN_EMAIL=notizbuch@example.de

# Bestätigungsmails verlangen; in der Entwicklung ist das aus
MAILER_AUTOCONFIRM=false

# Sperren, sobald die vorgesehenen Konten angelegt sind
DISABLE_SIGNUP=false
```

**`NEXT_PUBLIC_SUPABASE_URL` muss die öffentliche Adresse sein**, nicht
`http://gateway:8000`. Der Wert landet im Browser-Bundle, und der Browser
kennt das Docker-Netz nicht.

### Starten

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Der erste Start dauert: die Images werden gebaut, Kokoro lädt sein Modell, Caddy
holt das Zertifikat. Zehn bis zwanzig Minuten sind normal.

```bash
# Fortschritt
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
# Bereitschaft
curl -s https://notizbuch.example.de/api/health | jq
```

### Ohne Audio-Überblick

Spart 4 GB Speicher und den langen ersten Start:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --build --scale piper=0 --scale kokoro=0
```

## Abnahme

Nicht optional. Jeder Punkt hier ist schon einmal schiefgegangen.

```bash
# 1. Nur 80, 443 offen
nmap -Pn notizbuch.example.de

# 2. TLS und Security-Header
curl -sI https://notizbuch.example.de | grep -iE 'strict-transport|x-content-type|x-frame|referrer'

# 3. Content-Security-Policy mit Nonce, ohne unsafe-inline bei Skripten
curl -sI https://notizbuch.example.de/anmelden | grep -i content-security-policy

# 4. Weiterleitung von HTTP
curl -sI http://notizbuch.example.de | head -1

# 5. Postgres nicht von außen erreichbar
nc -zv notizbuch.example.de 54322    # muss scheitern

# 6. Health
curl -s https://notizbuch.example.de/api/health | jq

# 7. Der ganze Weg: registrieren, Quelle hochladen, Frage stellen,
#    Beleg anklicken. Von Hand, im Browser.
```

Zu Punkt 3: In der CSP darf bei `script-src` **kein** `unsafe-inline` und kein
`unsafe-eval` stehen, dafür ein `nonce-…`, das sich bei jedem Aufruf ändert.
Steht dort `unsafe-inline`, ist die Richtlinie gegen genau die Angriffe
wirkungslos, wegen derer man sie aufstellt.

### Danach

```bash
# Erste Sicherung und Probe
./scripts/backup.sh
npm run restore:probe   # braucht Node auf dem Host

# cron einrichten
crontab -e
# 0 3 * * *  cd /opt/notebooklm-klon && ./scripts/backup.sh >> /var/log/nlm-backup.log 2>&1
```

Und `DISABLE_SIGNUP=true` setzen, sobald die vorgesehenen Konten stehen. Ohne
das kann sich jeder registrieren, der die Adresse kennt — und jeder
Registrierte verbraucht Modellaufrufe auf deine Rechnung.

## Aktualisieren

```bash
cd /opt/notebooklm-klon
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Was dabei passiert, in dieser Reihenfolge:

1. `migrate` wendet neue Migrationen an. Alle anderen Dienste warten darauf.
2. Auth und Storage ziehen ihre eigenen Schemas nach.
3. `web` und `worker` starten neu. Der Worker bringt seinen laufenden Job vorher
   zu Ende — dafür ist `stop_grace_period: 120s` gesetzt.

**Vorher sichern.** Migrationen sind nicht zurücknehmbar (siehe
[operations.md](operations.md#migration-fehlgeschlagen)).

**Kurze Unterbrechung.** Es gibt kein rollierendes Deployment: `web` läuft in
einer Instanz, und während des Neustarts antwortet Caddy mit 502. Für eine
Anwendung dieser Größe ist das der richtige Tausch; wer es anders braucht,
skaliert `web` auf zwei Instanzen und nimmt den `container_name` heraus.

## Was fehlt

Ehrlich, damit niemand mehr erwartet, als da ist:

- **Kein Monitoring und kein Alarm.** `/api/health` muss von außen abgefragt
  werden.
- **Kein Off-Site-Backup.** Die Sicherung liegt auf demselben Rechner. Gegen
  einen Plattenausfall nützt sie nichts.
- **Kein rollierendes Deployment.** Jede Aktualisierung ist eine kurze
  Unterbrechung.

Der E2E-Lauf in der CI startet die Anwendung über `node apps/web/server.js` —
dieselbe Zeile wie das Produktionsimage. Es wird also nicht ein anderer Server
geprüft als der ausgelieferte.
