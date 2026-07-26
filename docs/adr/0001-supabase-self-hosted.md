# 0001 · Supabase self-hosted statt Cloud

**Status:** akzeptiert · Phase 0

## Kontext

Die Anwendung braucht Postgres mit pgvector, Authentifizierung, Datei-Storage und
eine Realtime-Verbindung für Job-Fortschritt. Supabase liefert das als Bündel,
entweder als Managed-Service oder als Docker-Stack.

## Entscheidung

Self-hosted im Docker-Compose auf einem eigenen Server.

## Begründung

Es gehen fremde Dokumente durch dieses System. Sie auf einem Server zu halten,
über den man selbst verfügt, ist bei einem deutschsprachigen Werkzeug für
Dokumentenarbeit die naheliegende Vorgabe — und war die Anforderung.

Praktisch kommt dazu: keine laufenden Kosten pro Nutzer, keine Größenlimits
außer der eigenen Platte, und die Ingestion darf Minuten dauern, ohne gegen ein
Plattform-Timeout zu laufen.

## Preis dafür

Betrieb liegt bei uns: Backups, Updates, TLS, Monitoring. Das ist der Grund,
warum `docs/deployment.md` und `docs/operations.md` Teil der Lieferung sind und
nicht optional. Der Restore aus einem Backup wird einmal echt geprobt — ein
Backup, das nie zurückgespielt wurde, ist keins.

Außerdem entfällt die Supabase-Weboberfläche. Für Datenbankeinblicke gibt es
`psql` und den Smoke-Test; das reicht und spart drei Container.
