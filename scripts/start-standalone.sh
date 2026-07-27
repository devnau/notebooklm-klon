#!/usr/bin/env bash
# Startet die Anwendung so, wie sie im Produktionsimage läuft.
#
# `next start` funktioniert mit `output: standalone` nur zufällig und warnt
# ausdrücklich davor. Das Image ruft `node apps/web/server.js` auf — und genau
# das soll der E2E-Lauf prüfen, damit nicht ein anderer Server getestet wird als
# der ausgelieferte.
#
# Die beiden Kopierschritte sind der Grund, warum es dieses Skript gibt: der
# standalone-Build enthält den Server und seine Module, aber **weder die
# statischen Dateien noch public/**. Ohne sie lädt die Seite ohne Stile und ohne
# Bilder — und zwar ohne Fehlermeldung, was das Unangenehmste daran ist.
set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE="$WURZEL/apps/web/.next/standalone"

if [[ ! -f "$STANDALONE/apps/web/server.js" ]]; then
	echo "✗ Kein standalone-Build gefunden. Zuerst: npm run build --workspace=@nlm/web"
	exit 1
fi

mkdir -p "$STANDALONE/apps/web/.next"
cp -R "$WURZEL/apps/web/.next/static" "$STANDALONE/apps/web/.next/static"
cp -R "$WURZEL/apps/web/public" "$STANDALONE/apps/web/public"

cd "$STANDALONE"
exec node apps/web/server.js
