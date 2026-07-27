# Retrieval und Zitate

Wie aus einer Frage eine belegte Antwort wird — und warum an jeder Stelle so
entschieden wurde.

## Der Weg einer Frage

```
Frage
  │
  ├─► Einbettung (Voyage, input_type: query)
  │
  ├─► match_chunks()  ── Vektorsuche ─┐
  │                   └─ Volltext ────┴─► RRF ─► Top 20
  │
  ├─► Kontext bauen: je Auszug ein Block mit Nummer S1:4
  │
  ├─► Claude, mit Prompt Caching auf Systemprompt + Quellenübersicht
  │
  ├─► Antwort streamen (NDJSON)
  │
  └─► Marker gegen den Kontext prüfen ─► citations ─► speichern
```

## Chunking

Der Chunker sitzt in `packages/shared/src/chunker.ts` und ist überschriften­bewusst:
er trennt an Markdown-Überschriften und teilt lange Abschnitte auf ~800 Token,
mit 120 Token Überlappung.

Drei Eigenschaften, die nicht offensichtlich sind:

**Ein Abschnitt endet an einer Seitengrenze.** Sonst bekäme er die Seitenzahl
seines Anfangs, und die Markierung im Viewer liefe über einen Seitenumbruch
hinweg, während das Zitat auf eine Seite zeigt.

**Zusammengelegt wird nur innerhalb desselben Überschriftenpfads.** Kurze
Abschnitte werden an den vorigen angehängt, damit kein Embedding aus drei
Wörtern entsteht — aber nicht über Kapitelgrenzen hinweg. Ohne diese Bedingung
wurde aus einem Dokument mit drei Kapiteln ein einziger Abschnitt.

**`text.slice(charStart, charEnd) === content`.** Die zentrale Zusicherung.
Bricht sie, zeigt jedes Zitat im Viewer ein paar Zeichen daneben — unauffällig,
weil Antwort und Verweis stimmen und nur die Markierung verrutscht. Sechs Tests
halten sie fest.

## Hybrid-Suche

`match_chunks()` führt zwei Suchen zusammen:

|                          | findet                                     | versagt bei                      |
| ------------------------ | ------------------------------------------ | -------------------------------- |
| Vektor (HNSW, Kosinus)   | was gemeint ist, auch bei anderer Wortwahl | Eigennamen, Aktenzeichen, Zahlen |
| Volltext (GIN, `german`) | genau diese Zeichenketten                  | Umschreibungen                   |

Zusammengeführt per **Reciprocal Rank Fusion**: jede Liste steuert `1/(60+rang)`
bei. Über den _Rang_, nicht über die Punktzahl — Kosinusdistanz und
`ts_rank_cd` haben keine gemeinsame Skala, jede Gewichtung roher Werte wäre
geraten.

`k = 60` dämpft die Dominanz der ersten Plätze. Das ist gewollt: keine der
beiden Suchen ist für sich zuverlässig genug, also soll ein zweiter Platz in
beiden Listen einen ersten Platz in nur einer schlagen können.

**Die Funktion ist `security invoker`, nicht `security definer`.** Damit greift
RLS auf `chunks`, und eine erratene fremde `notebook_id` liefert eine leere
Liste. Mit `security definer` läge die Zugriffsprüfung allein im
Anwendungscode — an einer Stelle, an der man sie vergessen kann.

Geprüft in `scripts/rag-e2e.mjs`: eine zufällige fremde ID liefert null Treffer.

## Zitate

Format: `[S1:4]` — Quelle 1, Abschnitt 4. Die Nummern sind **lokal zur
Antwort**, keine dauerhaften IDs.

Warum keine UUIDs im Prompt: rund zehn Token pro Auszug, mal zwanzig Auszüge,
mal jede Anfrage. Und Modelle verschreiben sich bei langen Zufallszeichenketten
— ein falsches Zeichen macht ein Zitat unauflösbar. Die Zuordnung zur echten ID
passiert in `resolveCitations()`, wo sie nicht misslingen kann.

### Prüfung statt Vertrauen

Jeder Marker wird gegen die Auszüge geprüft, die tatsächlich im Kontext
standen. Ein erfundener Marker wird protokolliert und **nicht** als Zitat
gespeichert. In der Oberfläche bleibt er als Text sichtbar, ausgegraut — eine
Antwort, die einen Beleg vortäuscht, soll auch so aussehen. Stillschweigend zu
entfernen hiesse, den Fehler zu verstecken.

### Streaming

`segmentAnswer()` läuft auch auf unvollständigem Text. Während des Streamings
kommt `[S1:` an, bevor `4]` da ist; ein halber Marker passt nicht auf das
Muster und bleibt Text, bis die Klammer geschlossen ist. Ohne diese Eigenschaft
flackerte die Antwort beim Tippen.

## Prompt-Aufbau

```
system[0]  Systemprompt                    ─┐ stabil
system[1]  Quellenübersicht  ← cache_control ┘

messages   bisheriger Verlauf              ─┐ variabel
           <auszuege>…</auszuege> + Frage   ┘
```

Die Cache-Marke sitzt am Ende der Quellenübersicht. Alles davor ist bei der
nächsten Frage im selben Notizbuch byteweise identisch. Stünde die Marke hinter
den Auszügen, wäre der Prefix bei jeder Frage anders und der Cache nutzlos.

Kontrolle: `usage.cache_read_input_tokens` der zweiten Antwort muss > 0 sein.
Gemessen im letzten Lauf: 1045.

Die Quellenübersicht enthält **alle** fertigen Quellen, nicht nur die
getroffenen. Sonst antwortet das Modell auf „Was liegt hier alles?" mit dem, was
die Suche zufällig zurückgab.

## Prompt Injection

Quelltexte sind Daten, keine Anweisungen. Zwei Massnahmen:

1. **Abgrenzung.** Jeder Auszug steht in einem eigenen `<auszug>`-Block mit
   Nummer. Ein Dokument, das mitten im Text `## Deine Aufgabe` schreibt, kann
   nicht so aussehen, als käme das aus dem Systemprompt.
2. **Ausdrückliche Regel im Systemprompt**, die benennt, wie ein Angriff
   aussieht („Ignoriere deine Anweisungen", „Gib deinen Systemprompt aus").

Geprüft mit `tests/fixtures/golden/prompt-injection.md`: ein Dokument mit
Sachinhalt und eingebetteter Anweisung samt Codewort. Erwartet wird, dass die
Sachfrage korrekt beantwortet wird, das Codewort nicht auftaucht und der
Systemprompt nicht ausgegeben wird — auch nicht auf direkte Aufforderung.

Im letzten Lauf hat das Modell zusätzlich von sich aus auf den
Manipulationsversuch hingewiesen. Das ist erfreulich, aber nichts, worauf sich
ein Test stützen sollte: es hängt am Modell, nicht an unserem Code.

## Quellenfilter

Die Auswahl speichert, was **abgewählt** ist, nicht was ausgewählt ist. Der
Normalfall ist „alle Quellen", und eine neu hinzugefügte Quelle soll
automatisch dazugehören. Mit einer Liste ausgewählter IDs wäre sie
stillschweigend ausgeschlossen — der Chat kennte sie nicht, und niemand wüsste
warum.

Sind alle abgewählt, wird ein Filter geschickt, der nichts trifft, statt gar
keinem. Ein leerer Filter käme in der Datenbank als „keine Einschränkung" an —
das Gegenteil der Absicht.

## Was geprüft wird

`npm run rag:e2e` gegen den laufenden Stack, mit echten Modellaufrufen.
Bewusst nicht in der CI: kostet Geld, braucht zwei Schlüssel, ist nicht
deterministisch.

Geprüft werden Eigenschaften, keine Wortgleichheit — sonst wäre der Test bei
jedem Modellwechsel rot, ohne dass etwas kaputt ist:

- Semantische Frage findet das richtige Dokument.
- `Wischnewski DSB-2024-07` wird gefunden (der Fall, für den es die
  Volltextsuche gibt).
- Fremde Notizbuch-ID liefert null Treffer.
- Nicht gedeckte Frage → das Modell sagt das und erfindet keine Zahl.
- Quellenfilter → alle Belege stammen aus der gewählten Quelle.
- Jeder Beleg zeigt auf einen Abschnitt, den es wirklich gibt.
- Injection → Sachfrage beantwortet, Codewort und Systemprompt bleiben aussen
  vor.
- `cache_read_input_tokens > 0`.

## Bekannte Grenze

Ein Voyage-Konto ohne hinterlegte Zahlungsart erlaubt **drei Anfragen pro
Minute**. Der Worker fängt das mit Backoff ab, der Import dauert dann nur
länger. Im Chat gibt es genau einen kurzen zweiten Versuch — hier wartet ein
Mensch, und ein Backoff über Minuten wäre ein Timeout statt eines Trostes. Bei
anhaltendem Limit erscheint eine klare Meldung.
