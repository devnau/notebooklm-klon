#!/usr/bin/env bash
# Spielt eine Sicherung in einen frischen Stack zurück und vergleicht.
#
# Der Punkt dieses Skripts: **ein Backup, das nie zurückgespielt wurde, ist kein
# Backup.** Ein pg_dump, der durchläuft, sagt nichts darüber, ob der Abzug
# vollständig ist, ob die Fremdschlüssel wieder greifen und ob die Erweiterungen
# an der richtigen Stelle liegen. Das sagt nur ein Rückspielen.
#
# Der Probelauf verwendet ein **eigenes Compose-Projekt mit eigenen Volumes**,
# nicht die laufende Installation. Ein Restore-Test, der die Produktion
# überschreibt, wird aus gutem Grund nie ausgeführt — und ist deshalb wertlos.
#
# Warum der ganze Stack und nicht nur Postgres: GoTrue und Storage bringen ihre
# Schemas beim Start selbst auf den aktuellen Stand. Das Datenbank-Image legt nur
# eine Grundfassung von `auth.users` an, der eine Reihe Spalten fehlt. Wird der
# Abzug in eine Datenbank eingespielt, in der die Dienste noch nicht gelaufen
# sind, scheitert jedes COPY auf `auth`-Tabellen mit „column … does not exist" —
# und zwar leise, mitten in erwartbaren „already exists"-Meldungen. Genau so
# stand der erste Probelauf da: alle Anwendungsdaten wieder da, **null Nutzer**.
#
# Aufruf:  ./scripts/restore-probe.sh [Sicherungsordner]
#          ohne Argument: die neueste Sicherung
#
# Dauer: einige Minuten. Der Stack wird vollständig hochgefahren.

set -euo pipefail

ORDNER="${1:-$(find "${BACKUP_DIR:-./backups}" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)}"
if [[ -z "$ORDNER" || ! -f "$ORDNER/daten.sql.gz" ]]; then
	echo "✗ Keine brauchbare Sicherung gefunden. Gesucht in: ${BACKUP_DIR:-./backups}"
	exit 1
fi

ORDNER="$(cd "$ORDNER" && pwd)"

echo "→ Probe mit $ORDNER"
if [[ -f "$ORDNER/kennzahlen.txt" ]]; then
	echo "  Erwartet: $(cat "$ORDNER/kennzahlen.txt")"
fi

PROJEKT="nlm-restore-probe"
# Eigene Ports, damit die Probe neben der laufenden Installation existieren kann.
export POSTGRES_PORT=54399
export GATEWAY_PORT=8099
export MAILPIT_UI_PORT=8098
export PIPER_PORT=5099
export KOKORO_PORT=8879

# Das Overlay nimmt die festen Containernamen der Basisdatei zurück; sonst
# scheitert der Probe-Stack an „container name is already in use", obwohl er ein
# eigenes Projekt und eigene Volumes hat.
probe() {
	docker compose -p "$PROJEKT" \
		-f docker-compose.yml -f docker/compose.probe.yml "$@"
}

aufraeumen() {
	echo "→ Probe-Stack abbauen ..."
	probe down -v --remove-orphans >/dev/null 2>&1 || true
}
trap aufraeumen EXIT

aufraeumen

echo "→ Frischen Stack hochfahren (das dauert) ..."
# Nur die dauerhaft laufenden Dienste nennen. `migrate` und `storage-init` laufen
# einmal und beenden sich; werden sie hier aufgeführt, hält `--wait` ihr Ende für
# einen Absturz und bricht ab. Über `depends_on` kommen sie ohnehin mit, und ihr
# erfolgreicher Abschluss wird dort abgewartet.
#
# Ohne die Sprachausgabe: sie wird für einen Restore-Test nicht gebraucht, und
# Kokoro allein braucht Minuten, bis es gesund ist.
probe up -d --wait --wait-timeout 300 db auth rest storage >/dev/null

echo "→ Daten einspielen ..."
# Nur die Daten. Das Schema steht bereits: die Migrationen haben `public`
# angelegt, GoTrue und Storage ihre eigenen Schemas.
#
# ON_ERROR_STOP bewusst *nicht*: der Abzug enthält Zeilen für Tabellen, die der
# frische Stack selbst befüllt — `schema_migrations` und `profiles` etwa. Ein
# Konflikt auf dem Primärschlüssel ist dort die erwartete Meldung.
#
# Als supabase_admin: `--disable-triggers` verlangt Superuser-Rechte, und die
# auth-Tabellen gehören supabase_auth_admin.
gunzip -c "$ORDNER/daten.sql.gz" \
	| probe exec -T db psql -U supabase_admin -d postgres -q \
		>/dev/null 2>"/tmp/nlm-restore-fehler.log" || true

# Erwartbar sind Primärschlüssel-Konflikte auf den Tabellen, die der frische
# Stack beim Hochfahren selbst füllt: `public.schema_migrations` (unsere
# Migrationen), `auth.schema_migrations` und `storage.migrations` (die der
# Dienste) sowie `profiles` (vom Trigger beim Anlegen eines Nutzers).
#
# Diese Zeilen sind identisch mit denen im Abzug — es geht nichts verloren.
ERWARTBAR_MUSTER='duplicate key value violates unique constraint "(schema_)?migrations_pkey"|duplicate key value violates unique constraint "profiles_pkey"'
ERWARTBAR=$(grep -cE "$ERWARTBAR_MUSTER" /tmp/nlm-restore-fehler.log || true)
UNERWARTET=$(grep "^ERROR" /tmp/nlm-restore-fehler.log | grep -vcE "$ERWARTBAR_MUSTER" || true)
echo "  $ERWARTBAR erwartbare Meldung(en), $UNERWARTET unerwartete"

FEHLSCHLAEGE=0

if [[ "$UNERWARTET" -gt 0 ]]; then
	echo "  ✗ unerwartete Meldungen beim Einspielen:"
	grep "^ERROR" /tmp/nlm-restore-fehler.log | grep -v "already exists" | sort -u | head -5 | sed 's/^/      /'
	FEHLSCHLAEGE=$((FEHLSCHLAEGE + 1))
fi

echo "→ Ergebnis vergleichen ..."
# `-d postgres` ist nicht optional: ohne die Angabe nimmt psql den Rollennamen
# als Datenbanknamen, und eine Datenbank „supabase_admin" gibt es nicht.
IST=$(probe exec -T db psql -U supabase_admin -d postgres -qtAX -c "
  select 'notebooks=' || (select count(*) from public.notebooks)
      || ' sources='  || (select count(*) from public.sources)
      || ' chunks='   || (select count(*) from public.chunks)
      || ' messages=' || (select count(*) from public.messages)
      || ' notes='    || (select count(*) from public.notes)
      || ' users='    || (select count(*) from auth.users);
" 2>/tmp/nlm-restore-vergleich.log | tr -d '\r' || true)

if [[ -z "$IST" ]]; then
	echo "  ✗ Vergleichsabfrage schlug fehl:"
	sed 's/^/      /' /tmp/nlm-restore-vergleich.log | head -5
	exit 1
fi

echo "  Gefunden: $IST"

if [[ -f "$ORDNER/kennzahlen.txt" ]]; then
	SOLL=$(tr -d '\r' <"$ORDNER/kennzahlen.txt")
	if [[ "$IST" == "$SOLL" ]]; then
		echo "  ✓ Kennzahlen stimmen überein"
	else
		echo "  ✗ Kennzahlen weichen ab"
		echo "      erwartet: $SOLL"
		echo "      gefunden: $IST"
		FEHLSCHLAEGE=$((FEHLSCHLAEGE + 1))
	fi
fi

# Über die Zeilenzahlen hinaus: was beim Rückspielen typischerweise
# verlorengeht, sind nicht Zeilen, sondern Struktur.
pruefe() {
	local name="$1" sql="$2" erwartet="$3" wert
	wert=$(probe exec -T db psql -U supabase_admin -d postgres -qtAX -c "$sql" 2>/dev/null | tr -d '\r' || true)
	if [[ "$wert" == "$erwartet" ]]; then
		echo "  ✓ $name"
	else
		echo "  ✗ $name — erwartet $erwartet, gefunden ${wert:-<leer>}"
		FEHLSCHLAEGE=$((FEHLSCHLAEGE + 1))
	fi
}

pruefe "pgvector installiert" \
	"select count(*) from pg_extension where extname = 'vector'" "1"

pruefe "HNSW-Index auf chunks vorhanden" \
	"select count(*) from pg_indexes where tablename = 'chunks' and indexdef ilike '%hnsw%'" "1"

pruefe "Volltextspalte weiter generiert" \
	"select count(*) from information_schema.columns where table_name = 'chunks' and column_name = 'tsv' and is_generated = 'ALWAYS'" "1"

pruefe "kein Abschnitt ohne Vektor" \
	"select count(*) from public.chunks where embedding is null" "0"

pruefe "RLS auf allen Anwendungstabellen aktiv" \
	"select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations' and not c.relrowsecurity" "0"

pruefe "match_chunks vorhanden und security invoker" \
	"select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'match_chunks' and not p.prosecdef" "1"

pruefe "jedes Notizbuch hat einen existierenden Eigentümer" \
	"select count(*) from public.notebooks n where not exists (select 1 from auth.users u where u.id = n.owner_id)" "0"

# Der Härtetest: eine echte Suche über die wiederhergestellten Daten. Fehlt eine
# Erweiterung oder ein Index, fällt es hier auf und nicht erst im Betrieb.
pruefe "Suche läuft über die wiederhergestellten Daten" \
	"select count(*) >= 0 from public.match_chunks(
       (select notebook_id from public.chunks limit 1),
       'probe',
       (select embedding from public.chunks where embedding is not null limit 1),
       null, 5, 20
     )" "t"

if [[ -f "$ORDNER/storage.tar.gz" ]]; then
	DATEIEN=$(gunzip -c "$ORDNER/storage.tar.gz" | tar -tf - 2>/dev/null | grep -c -v '/$' || true)
	echo "  ✓ Storage-Archiv lesbar, $DATEIEN Datei(en)"

	# Gegenprobe zwischen Datenbank und Archiv: eine Quelle, deren Datei fehlt,
	# ist nach der Wiederherstellung nicht mehr lesbar — und das merkt niemand,
	# bis jemand sie öffnet.
	ERWARTETE_DATEIEN=$(probe exec -T db psql -U supabase_admin -d postgres -qtAX -c \
		"select count(*) from public.sources where storage_path is not null" 2>/dev/null | tr -d '\r' || echo 0)
	if [[ "$DATEIEN" -ge "$ERWARTETE_DATEIEN" ]]; then
		echo "  ✓ Archiv enthält mindestens so viele Dateien wie Quellen ($ERWARTETE_DATEIEN)"
	else
		echo "  ✗ Archiv hat $DATEIEN Dateien, die Datenbank kennt $ERWARTETE_DATEIEN Quellen"
		FEHLSCHLAEGE=$((FEHLSCHLAEGE + 1))
	fi
fi

echo
if [[ "$FEHLSCHLAEGE" -eq 0 ]]; then
	echo "✓ Restore-Probe bestanden. Die Sicherung ist brauchbar."
else
	echo "✗ Restore-Probe: $FEHLSCHLAEGE Prüfung(en) fehlgeschlagen."
	exit 1
fi
