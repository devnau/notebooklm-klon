# 0006 · RLS als einzige Sicherheitsgrenze

**Status:** akzeptiert · Phase 0

## Kontext

Berechtigungen können in der Anwendungsschicht durchgesetzt werden (Prüfungen in
Route Handlers), in der Datenbank (Row Level Security) oder in beiden.

## Entscheidung

Ausschließlich in der Datenbank. Alle Policies delegieren an eine Funktion,
`public.is_notebook_member(nb, min_role)`. Prüfungen in der Anwendung sind reine
UX und nie die Grenze.

## Begründung

Der Browser spricht über PostgREST direkt mit der Datenbank. Eine Prüfung im
Route Handler wäre wirkungslos, weil der Client den Handler gar nicht braucht —
ein `fetch` auf `/rest/v1/sources?notebook_id=eq.<fremd>` geht daran vorbei.
Die Grenze muss dort liegen, wo die Daten liegen.

Eine einzige Funktion statt wiederholter Bedingungen: Sharing (Phase 6)
erweitert das Modell um Token-Zugriff. Mit dieser Struktur ändert sich eine
Funktion, nicht zwanzig Policies — und es gibt keine Policy, die man dabei
vergessen kann.

`FORCE ROW LEVEL SECURITY`, nicht nur `ENABLE`: Migrationen laufen als
`postgres`, `postgres` ist damit Tabelleneigentümer, und Eigentümer umgehen
`ENABLE`-RLS stillschweigend. Ohne `FORCE` wäre jede Verbindung als `postgres`
blind für alle Policies.

## Preis dafür

Berechtigungslogik steht in SQL, nicht in TypeScript — schwerer zu lesen und
nicht typgeprüft. Die Kompensation ist die Testsuite: jede Tabelle × jede Rolle ×
jede Aktion wird gegen eine echte Datenbank geprüft, und der Smoke-Test
verifiziert für alle Tabellen im Schema `public` automatisch, dass RLS aktiv
**und** erzwungen ist. Eine neu hinzugefügte Tabelle ohne RLS lässt die CI
scheitern.

Zweiter Preis: `is_notebook_member` ist `security definer`. Solche Funktionen
sind ein klassischer Weg zur Rechteausweitung, wenn der `search_path` nicht
festgenagelt ist. Deshalb hat jede von ihnen `set search_path = ''` und voll
qualifizierte Objektnamen.
