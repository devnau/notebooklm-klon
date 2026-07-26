# 0004 · Eigener Worker statt Edge Functions

**Status:** akzeptiert · Phase 0, umgesetzt in Phase 2

## Kontext

Import einer Quelle (extrahieren, zerlegen, einbetten) und Audio-Rendering
dauern Minuten. Beides muss außerhalb des Request-Zyklus laufen. Supabase bietet
dafür Edge Functions plus `pg_cron`.

## Entscheidung

Ein langlaufender Node-Container, der eine `jobs`-Tabelle mit
`SELECT ... FOR UPDATE SKIP LOCKED` abarbeitet.

## Begründung

Gleiche Sprache und gleiche Typen wie die App — die Chunking-Logik und die
Zod-Schemas liegen in `@nlm/shared` und werden von beiden Seiten benutzt. Bei
Deno-Edge-Functions wäre das eine zweite Laufzeit mit eigenem Modulsystem.

Status, Versuchszähler und Fehlertext liegen als Spalten in der Datenbank. Damit
ist der Fortschritt ohne Zusatzarbeit in der UI sichtbar (über Realtime) und ein
hängender Job per `select` auffindbar. Fehlersuche ist ein normaler Node-Prozess
mit Logs.

`SKIP LOCKED` erlaubt mehrere Worker parallel, ohne Broker oder Lock-Service:
jeder greift sich eine Zeile, gesperrte werden übersprungen. Für diese Last ist
Redis oder eine Queue-Infrastruktur unnötige Komplexität.

## Preis dafür

Polling statt Push — bis zu zwei Sekunden Verzögerung bis ein Job anläuft. Für
Vorgänge, die anschließend Minuten dauern, ist das irrelevant.

Und wir schreiben Retry- und Backoff-Logik selbst. Das sind rund fünfzig Zeilen;
im Gegenzug ist das Verhalten vollständig durchschaubar.
