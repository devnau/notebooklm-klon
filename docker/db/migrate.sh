#!/bin/sh
# Wendet alle Migrationen in numerischer Reihenfolge an und protokolliert sie in
# public.schema_migrations. Idempotent: bereits angewandte Dateien werden
# übersprungen, sodass der Container bei jedem Stack-Start mitlaufen kann.
#
# Zwei Durchläufe, gesteuert über MIGRATIONS_DIR:
#
#   /migrations          — Anwendungsschema, läuft vor allen Diensten
#   /storage-migrations  — Buckets und Policies auf storage.objects
#
# Der zweite braucht einen eigenen Durchlauf, weil storage.buckets erst
# existiert, nachdem der Storage-Dienst beim ersten Start seine eigenen
# Migrationen gefahren hat. Vorher schlägt jede Anweisung darauf fehl — auf
# einem frischen Volume zuverlässig, auf einem bestehenden nie. Genau diese
# Kombination sorgt dafür, dass es lokal läuft und in der CI scheitert.
#
# Absichtlich kein `supabase db push`: das würde die Supabase-CLI im Container
# voraussetzen. Ein Shell-Skript plus psql hat weniger bewegliche Teile.
set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
# Die Rollen-Passwörter setzt nur der erste Durchlauf; der zweite läuft, wenn
# die Dienste längst verbunden sind.
SYNC_ROLE_PASSWORDS="${SYNC_ROLE_PASSWORDS:-1}"

echo "→ Warte auf Datenbank ..."
until pg_isready -q; do
	sleep 1
done

# ── Passwörter der Service-Rollen setzen ──────────────────────────────────────
# Das supabase/postgres-Image legt authenticator, supabase_auth_admin und
# supabase_storage_admin an, setzt aber nur für `postgres` ein Passwort. GoTrue,
# PostgREST und Storage verbinden sich jedoch mit ihren eigenen Rollen und
# scheitern sonst mit SQLSTATE 28P01.
#
# Bewusst hier statt in einer Migration: das Passwort kommt aus der Umgebung und
# hat in einer versionierten SQL-Datei nichts zu suchen. `:'pw'` lässt psql das
# Quoting machen — String-Interpolation wäre hier eine Injection-Lücke.
#
# Zwei Details, die hier nicht offensichtlich sind:
#  * Verbindung als supabase_admin, nicht als postgres: die Rollen sind über
#    supautils als "reserved" markiert und nur ein Superuser darf sie ändern —
#    postgres wird vom Image bewusst degradiert.
#  * Die Anweisungen kommen über stdin, nicht über `-c`: bei `-c` führt psql
#    keine Variablen-Interpolation durch, `:'pw'` bliebe wörtlich stehen.
if [ "$SYNC_ROLE_PASSWORDS" = "1" ]; then
echo "→ Synchronisiere Passwörter der Service-Rollen ..."
psql -v ON_ERROR_STOP=1 -q -U supabase_admin --set=pw="$PGPASSWORD" <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    raise exception 'Rolle authenticator fehlt — läuft die DB auf dem supabase/postgres-Image?';
  end if;
end $$;

alter role authenticator          with password :'pw';
alter role supabase_auth_admin    with password :'pw';
alter role supabase_storage_admin with password :'pw';
SQL
fi

psql -v ON_ERROR_STOP=1 -q <<'SQL'
create table if not exists public.schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now(),
  checksum    text not null
);
SQL

applied_any=0
for file in $(find "$MIGRATIONS_DIR" -name '*.sql' | sort); do
	# Der Ordnername gehört zur Kennung: sonst könnten zwei Migrationen aus
	# verschiedenen Durchläufen dieselbe Nummer tragen und sich gegenseitig als
	# "schon angewandt" gelten.
	version="$(basename "$MIGRATIONS_DIR")/$(basename "$file" .sql)"
	checksum=$(md5sum "$file" | cut -d' ' -f1)

	existing=$(psql -tAX -c "select checksum from public.schema_migrations where version = '$version'")

	if [ -n "$existing" ]; then
		if [ "$existing" != "$checksum" ]; then
			echo "✗ Migration $version wurde nachträglich verändert."
			echo "  Angewandt: $existing"
			echo "  Auf Platte: $checksum"
			echo "  Angewandte Migrationen sind unveränderlich — neue Migration anlegen."
			exit 1
		fi
		continue
	fi

	echo "→ Wende $version an ..."
	# Migration und Protokolleintrag in einer Transaktion: entweder beides oder nichts.
	psql -v ON_ERROR_STOP=1 --single-transaction \
		-c "\i $file" \
		-c "insert into public.schema_migrations (version, checksum) values ('$version', '$checksum')"
	applied_any=1
done

if [ "$applied_any" -eq 0 ]; then
	echo "✓ Schema aktuell, keine neuen Migrationen."
else
	echo "✓ Migrationen angewandt."
fi

# PostgREST über das geänderte Schema informieren, damit es seinen Cache neu lädt.
psql -q -c "notify pgrst, 'reload schema'" || true
