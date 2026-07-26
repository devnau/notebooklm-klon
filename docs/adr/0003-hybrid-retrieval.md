# 0003 · Hybride Suche statt Long-Context

**Status:** akzeptiert · Phase 0, umgesetzt in Phase 3

## Kontext

Für belegte Antworten muss der relevante Teil der Quellen in den Prompt. Drei
Wege: alles hineinlegen (Long-Context), reine Vektorsuche, oder Vektor plus
Volltext.

## Entscheidung

Vektorsuche (pgvector, HNSW) und Volltextsuche (`tsvector`, deutsche
Konfiguration) getrennt bis Top-60, dann Reciprocal Rank Fusion mit k=60, daraus
die besten 20 Auszüge. Alles in einer Postgres-Funktion, ein Roundtrip.

## Begründung

**Gegen Long-Context:** Ein Notebook mit 20 PDFs sprengt jedes Kontextfenster,
und selbst wenn nicht, zahlt man bei jeder Frage für alles. Zudem lässt sich
ohne Auszüge nicht sagen, _welche_ Stelle eine Aussage belegt — genau das ist
aber das Kernversprechen.

**Gegen reine Vektorsuche:** Embeddings sind bei exakten Zeichenketten schwach.
Ein Aktenzeichen, ein Eigenname, eine Paragraphennummer — semantisch nah ist
dort nicht gut genug. Volltext findet sie zuverlässig.

**Für RRF statt Score-Normalisierung:** Cosinus-Distanz und `ts_rank_cd` liegen
auf unvergleichbaren Skalen; sie zu gewichten hieße, zwei Zahlen zu kalibrieren,
die sich mit jedem Datensatz verschieben. RRF nutzt nur die Rangfolge, hat einen
einzigen Parameter und ist damit robust ohne Tuning.

## Preis dafür

Zwei Indizes statt einem (HNSW und GIN), also mehr Schreiblast beim Import. Und
die deutsche `to_tsvector`-Konfiguration ist fest verdrahtet — bei mehrsprachigen
Notebooks muss die Sprache pro Quelle in die Indexdefinition einfließen. Das ist
bewusst aufgeschoben, nicht vergessen.
