#!/usr/bin/env bash
# Nächtliche Sicherung: Datenbank und Storage.
#
# Beides zusammen, weil beides allein wertlos ist. Ein Datenbankabzug ohne die
# Dateien liefert Notizbücher mit Quellen, die sich nicht öffnen lassen; die
# Dateien ohne die Datenbank sind ein Haufen UUID-Namen ohne Zuordnung.
#
# Aufruf auf dem Server, etwa über cron:
#   0 3 * * *  cd /opt/notebooklm-klon && ./scripts/backup.sh >> /var/log/nlm-backup.log 2>&1
#
# Wiederherstellung: siehe scripts/restore-probe.sh und docs/operations.md.

set -euo pipefail

ZIEL="${BACKUP_DIR:-./backups}"
BEHALTEN_TAGE="${BACKUP_RETENTION_DAYS:-14}"
STEMPEL="$(date +%Y-%m-%d_%H%M)"
ORDNER="$ZIEL/$STEMPEL"

# Alles oder nichts: ein halbes Backup ist gefährlicher als keines, weil man
# sich darauf verlässt. Bricht etwas ab, wird der unvollständige Ordner
# entfernt.
aufraeumen_bei_fehler() {
	echo "✗ Sicherung fehlgeschlagen, unvollständiger Ordner wird entfernt: $ORDNER"
	rm -rf "$ORDNER"
}
trap aufraeumen_bei_fehler ERR

mkdir -p "$ORDNER"

echo "→ Datenbank sichern ..."
#
# Zwei Dateien, und das ist die zentrale Entscheidung dieses Skripts.
#
# **daten.sql.gz** — `--data-only --disable-triggers`. Das ist die Datei, mit
# der wiederhergestellt wird. Sie setzt voraus, dass das Schema schon steht:
# ein frischer Stack legt es über die Migrationen und die Dienste selbst an.
#
# **schema.sql.gz** — nur zum Nachsehen und Vergleichen. Wiederhergestellt
# wird daraus nicht.
#
# Warum nicht ein einziger vollständiger Abzug: die Restore-Probe hat drei
# Varianten durchfallen lassen, und jede auf andere Weise.
#
#  1. Mit `--clean` als Superuser eingespielt entfernen die DROP-Anweisungen
#     Schemas und Erweiterungen, die das Image selbst angelegt hat — der
#     Datenbankserver **stürzte mitten im Einspielen ab**.
#  2. Rein additiv in einen Stack, in dem nur Postgres lief, scheiterte jedes
#     COPY auf `auth`-Tabellen mit „column … does not exist": GoTrue bringt sein
#     Schema erst beim Start auf den aktuellen Stand, das Image legt nur eine
#     Grundfassung an. Ergebnis: alle Anwendungsdaten da, **null Nutzer**.
#  3. Rein additiv in einen vollständigen Stack scheiterte an
#     Fremdschlüsseln — `pg_dump` schreibt die Tabellen alphabetisch, also
#     `chats` und `chunks` vor `notebooks` und `sources`. Bei einem Abzug, der
#     das Schema selbst anlegt, ist das kein Problem, weil die Constraints erst
#     danach kommen; hier stehen sie schon. Ergebnis: **null Abschnitte, null
#     Nachrichten**.
#
# `--disable-triggers` löst genau (3): es schaltet die Prüfungen für die Dauer
# des Einspielens ab. Das geht nur bei einem reinen Datenabzug und nur als
# Superuser — beides ist hier gegeben.
#
# Als supabase_admin, nicht als postgres: das Image degradiert postgres zu einer
# Nicht-Superuser-Rolle, und die auth-Tabellen gehören supabase_auth_admin.
#
# `_realtime` und `realtime` bleiben aussen vor. Was dort liegt, ist
# Betriebszustand des Realtime-Dienstes: verschlüsselte Tenant-Zugangsdaten,
# offene Abonnements, tagesweise Nachrichtentabellen. Der Dienst legt das beim
# Start selbst wieder an (SEED_SELF_HOST), und die verschlüsselten Daten wären
# nach einem Wechsel von REALTIME_ENC_KEY ohnehin wertlos. Im Abzug erzeugten
# sie nur Fehlermeldungen für Tabellen, die es beim Einspielen noch nicht gibt.
docker compose exec -T db pg_dump \
	--username=supabase_admin \
	--dbname=postgres \
	--data-only --disable-triggers \
	--exclude-schema=_realtime \
	--exclude-schema=realtime \
	--quote-all-identifiers \
	| gzip -9 >"$ORDNER/daten.sql.gz"

docker compose exec -T db pg_dump \
	--username=supabase_admin \
	--dbname=postgres \
	--schema-only \
	--exclude-schema=_realtime \
	--exclude-schema=realtime \
	--quote-all-identifiers \
	| gzip -9 >"$ORDNER/schema.sql.gz"

echo "→ Storage sichern ..."
# Direkt aus dem Volume statt über die Storage-API: die API kennt keinen
# Massenexport, und ein Skript, das jede Datei einzeln über signierte Adressen
# holt, wäre bei tausenden Objekten unbrauchbar langsam.
docker compose exec -T storage tar -C /var/lib/storage -cf - . \
	| gzip -9 >"$ORDNER/storage.tar.gz"

echo "→ Kennzahlen festhalten ..."
# Der Vergleich beim Zurückspielen: stimmen die Zahlen nicht, ist etwas
# verlorengegangen. Ohne diese Datei müsste man es erraten.
docker compose exec -T db psql -U postgres -qtAX -c "
  select 'notebooks=' || (select count(*) from public.notebooks)
      || ' sources='  || (select count(*) from public.sources)
      || ' chunks='   || (select count(*) from public.chunks)
      || ' messages=' || (select count(*) from public.messages)
      || ' notes='    || (select count(*) from public.notes)
      || ' users='    || (select count(*) from auth.users);
" >"$ORDNER/kennzahlen.txt"

trap - ERR

GROESSE=$(du -sh "$ORDNER" | cut -f1)
echo "✓ Sicherung fertig: $ORDNER ($GROESSE)"
cat "$ORDNER/kennzahlen.txt"

echo "→ Alte Sicherungen entfernen (älter als $BEHALTEN_TAGE Tage) ..."
# -mindepth 1 -maxdepth 1: nur die Tagesordner, nicht das Zielverzeichnis
# selbst und nichts darunter.
find "$ZIEL" -mindepth 1 -maxdepth 1 -type d -mtime "+$BEHALTEN_TAGE" -print -exec rm -rf {} +

echo "✓ Fertig."
