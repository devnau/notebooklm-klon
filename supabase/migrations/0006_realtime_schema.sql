-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 · Schema für den Realtime-Dienst
--
-- Realtime bringt seine eigenen Migrationen mit, legt aber das Schema, in dem
-- sie laufen sollen, nicht selbst an. Mit `DB_AFTER_CONNECT_QUERY: SET
-- search_path TO _realtime` und einem nicht existierenden Schema startet der
-- Dienst mit „no schema has been selected to create in" und geht in eine
-- Neustartschleife.
--
-- In der offiziellen Supabase-Compose-Datei erledigt das ein Init-Skript unter
-- /docker-entrypoint-initdb.d. Dieses Verzeichnis mounten wir bewusst nicht
-- (es würde die Rollen- und Schema-Einrichtung des Images überdecken, siehe
-- Kommentar in docker-compose.yml), deshalb steht es hier.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists _realtime;

-- Rechte statt Eigentum: `alter schema ... owner to` verlangt, dass die
-- ausführende Rolle supabase_admin *werden* kann. Der migrate-Job verbindet
-- sich als postgres, und das Image degradiert postgres bewusst zu einer
-- Nicht-Superuser-Rolle. Ein Grant reicht — Realtime muss in dem Schema
-- Tabellen anlegen können, nicht es besitzen.
grant usage, create on schema _realtime to supabase_admin;
