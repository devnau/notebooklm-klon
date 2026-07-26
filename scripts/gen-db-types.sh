#!/usr/bin/env bash
# Erzeugt die TypeScript-Typen aus dem laufenden Schema. Typen werden generiert
# und nicht handgeschrieben, damit Code und Datenbank nicht auseinanderlaufen.
#
# Voraussetzung: der Stack läuft (docker compose up -d --wait).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "✗ .env fehlt. Erzeugen mit: node scripts/generate-secrets.mjs > .env" >&2
  exit 1
fi

PASSWORD=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
PORT=$(grep '^POSTGRES_PORT=' .env | cut -d= -f2- || echo 54322)
TARGET=apps/web/src/lib/supabase/types.ts

{
  echo "// Generiert von scripts/gen-db-types.sh — nicht von Hand bearbeiten."
  echo "// Nach jeder Migration neu erzeugen: npm run db:types"
  echo
  npx -y supabase@latest gen types typescript \
    --db-url "postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres" \
    --schema public 2>/dev/null
} > "$TARGET"

npx prettier --write "$TARGET" >/dev/null
echo "✓ $TARGET aktualisiert ($(wc -l < "$TARGET" | tr -d ' ') Zeilen)"
