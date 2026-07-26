# 0002 · Caddy als Gateway statt Kong

**Status:** akzeptiert · Phase 0

## Kontext

`@supabase/supabase-js` erwartet Auth, REST und Storage unter **einer** Origin
mit den Pfaden `/auth/v1`, `/rest/v1`, `/storage/v1`. Das offizielle
Supabase-Docker-Setup löst das mit Kong.

Unabhängig davon brauchen wir in Produktion einen Reverse Proxy für TLS,
HTTP-Weiterleitung und Security-Header.

## Entscheidung

Caddy übernimmt beides: Pfad-Routing zu den Supabase-Diensten und in Produktion
TLS-Terminierung.

## Begründung

Kong zusätzlich zu Caddy wären zwei Proxies hintereinander, zwei
Konfigurationssprachen und ein Container mehr. Kongs eigentliche Stärken —
Plugins, Consumer-Verwaltung, verteiltes Rate-Limiting — brauchen wir nicht: die
Dienste prüfen das JWT selbst, und Rate-Limits liegen ohnehin auf
Anwendungsebene, wo sie an Nutzer und Endpunkt gebunden werden können.

Die Konfiguration ist neun Zeilen `handle_path` mit `reverse_proxy`. `handle_path`
statt `handle` ist dabei wesentlich: die Dienste erwarten die Pfade **ohne**
Präfix, `handle_path` entfernt es.

## Preis dafür

Wir weichen vom dokumentierten Supabase-Referenzsetup ab. Wer dort einen
Konfigurationstipp nachliest, muss ihn übertragen. Deshalb prüft
`scripts/smoke-test.mjs` jeden Pfad des Gateways einzeln — die Kompensation für
den fehlenden Referenzpfad ist ein Test, der Abweichungen sofort zeigt.

Nicht vergessen: Realtime (Phase 2) läuft über WebSockets und braucht eine
eigene Route mit anderem Präfix-Verhalten als die drei bestehenden.
