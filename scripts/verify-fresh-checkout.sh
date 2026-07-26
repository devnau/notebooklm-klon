#!/usr/bin/env bash
# Prüft, ob das Projekt aus einem frischen Checkout heraus baut.
#
# Hintergrund: @nlm/shared wird über das exports-Feld aus dist/ geladen. Fehlt
# dieses Verzeichnis, scheitert jeder Import daraus. Lokal fällt das nie auf,
# weil dist/ dort schon liegt — in der CI dagegen sofort. Genau daran ist der
# E2E-Job einmal gescheitert.
#
# Dieses Skript stellt den frischen Zustand her und prüft beide Einstiegspunkte.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Entferne gebaute Artefakte ..."
rm -rf packages/shared/dist packages/shared/*.tsbuildinfo apps/web/.next

echo "→ Build über die Wurzel ..."
npm run build >/dev/null
test -f packages/shared/dist/index.js || {
  echo "✗ packages/shared/dist fehlt nach dem Wurzel-Build" >&2
  exit 1
}

echo "→ Entferne Artefakte erneut ..."
rm -rf packages/shared/dist apps/web/.next

echo "→ Build direkt im Workspace ..."
npm run build --workspace=@nlm/web >/dev/null
test -f packages/shared/dist/index.js || {
  echo "✗ packages/shared/dist fehlt nach dem Workspace-Build" >&2
  exit 1
}

echo "✓ Beide Einstiegspunkte bauen aus dem frischen Zustand."
