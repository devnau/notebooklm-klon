/**
 * Zitatmarker: Erzeugen, Finden, Prüfen.
 *
 * Das Format ist `[S1:4]` — Quelle 1, Abschnitt 4. Die Nummern sind **lokal
 * für eine Antwort**: `S1` ist die erste Quelle, die im Kontext dieser Anfrage
 * steht, nicht eine dauerhafte ID.
 *
 * Warum keine echten IDs im Prompt: eine UUID kostet rund zehn Token, mal
 * zwanzig Auszüge, mal jede Anfrage. Und Modelle verschreiben sich bei langen
 * Zufallszeichenketten — ein einziges falsches Zeichen macht ein Zitat
 * unauflösbar. Kurze Nummern sind billiger und robuster; die Zuordnung zur
 * echten ID passiert hier im Code, wo sie nicht misslingen kann.
 *
 * **Diese Datei liegt in `shared`, weil sie an zwei Stellen gebraucht wird:**
 * serverseitig zum Auflösen und Speichern, clientseitig zum Rendern während
 * des Streamings. Zwei Implementierungen desselben Musters würden garantiert
 * auseinanderlaufen — und der Fehler wäre still.
 */

/**
 * Ein Marker im Text.
 *
 * `[S12:345]` — ein- bis zweistellige Quellennummer, beliebige Abschnittszahl.
 * Absichtlich streng: kein Leerraum, keine Kleinschreibung, keine Varianten.
 * Ein toleranterer Ausdruck würde auch normale Klammerausdrücke im Quellentext
 * erwischen.
 */
const CITATION_PATTERN = /\[S(\d{1,3}):(\d{1,5})\]/g;

export type CitationMarker = {
  /** Wie im Text, ohne Klammern: `S1:4`. */
  readonly label: string;
  readonly sourceNumber: number;
  readonly chunkNumber: number;
  /** Position im Antworttext, für das Ersetzen durch anklickbare Elemente. */
  readonly start: number;
  readonly end: number;
};

/** Ein Auszug, wie er dem Modell vorgelegt wurde. */
export type ContextChunk = {
  readonly sourceNumber: number;
  readonly chunkNumber: number;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly chunkId: number;
  readonly content: string;
  readonly headingPath: string | null;
  readonly page: number | null;
  readonly charStart: number;
  readonly charEnd: number;
};

/** Ein aufgelöstes Zitat, so wie es gespeichert und angezeigt wird. */
export type Citation = {
  readonly label: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly chunkId: number;
  readonly headingPath: string | null;
  readonly page: number | null;
  readonly charStart: number;
  readonly charEnd: number;
};

export function citationLabel(sourceNumber: number, chunkNumber: number): string {
  return `S${String(sourceNumber)}:${String(chunkNumber)}`;
}

/** Alle Marker im Text, in Reihenfolge ihres Auftretens. */
export function findCitationMarkers(text: string): CitationMarker[] {
  const markers: CitationMarker[] = [];
  // Eigene RegExp-Instanz: das globale Flag führt `lastIndex` mit, ein geteiltes
  // Objekt würde bei nebenläufigen Aufrufen Treffer überspringen.
  const pattern = new RegExp(CITATION_PATTERN.source, 'g');

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const sourceNumber = Number(match[1]);
    const chunkNumber = Number(match[2]);
    markers.push({
      label: citationLabel(sourceNumber, chunkNumber),
      sourceNumber,
      chunkNumber,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return markers;
}

export type ResolvedCitations = {
  /** Eindeutig, in Reihenfolge des ersten Auftretens. */
  readonly citations: Citation[];
  /**
   * Marker, zu denen es keinen Auszug gibt. Sie werden **nicht** stillschweigend
   * entfernt: ein erfundener Verweis ist genau die Art Fehler, die auffallen
   * muss. Der Aufrufer entscheidet, ob er ihn protokolliert oder anzeigt.
   */
  readonly unresolved: CitationMarker[];
};

/**
 * Ordnet Marker den Auszügen zu, die tatsächlich im Kontext standen.
 *
 * Das ist die Prüfung, die aus einer Behauptung einen Beleg macht. Ohne sie
 * würde ein Modell, das `[S9:2]` erfindet, obwohl es nur drei Quellen gab, in
 * der Oberfläche eine Schaltfläche erzeugen, die nirgendwohin führt — oder,
 * schlimmer, auf die falsche Stelle.
 */
export function resolveCitations(
  text: string,
  context: readonly ContextChunk[],
): ResolvedCitations {
  const byLabel = new Map<string, ContextChunk>();
  for (const chunk of context) {
    byLabel.set(citationLabel(chunk.sourceNumber, chunk.chunkNumber), chunk);
  }

  const citations: Citation[] = [];
  const unresolved: CitationMarker[] = [];
  const seen = new Set<string>();

  for (const marker of findCitationMarkers(text)) {
    const chunk = byLabel.get(marker.label);
    if (!chunk) {
      unresolved.push(marker);
      continue;
    }
    if (seen.has(marker.label)) continue;
    seen.add(marker.label);

    citations.push({
      label: marker.label,
      sourceId: chunk.sourceId,
      sourceTitle: chunk.sourceTitle,
      chunkId: chunk.chunkId,
      headingPath: chunk.headingPath,
      page: chunk.page,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
    });
  }

  return { citations, unresolved };
}

export type TextSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'citation'; readonly citation: Citation }
  /** Ein Marker ohne passenden Auszug — wird als Text gezeigt, nicht verlinkt. */
  | { readonly kind: 'broken'; readonly text: string };

/**
 * Zerlegt eine Antwort in Text und Zitate, damit die Oberfläche daraus
 * anklickbare Elemente bauen kann.
 *
 * Läuft auch auf unvollständigem Text: während des Streamings kommt `[S1:` an,
 * bevor `4]` da ist. Ein halber Marker passt nicht auf das Muster und bleibt
 * schlicht Text — beim nächsten Aufruf, wenn die Klammer geschlossen ist, wird
 * er zum Zitat. Ohne diese Eigenschaft würde die Antwort beim Tippen flackern.
 */
export function segmentAnswer(text: string, citations: readonly Citation[]): TextSegment[] {
  const byLabel = new Map(citations.map((citation) => [citation.label, citation]));
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const marker of findCitationMarkers(text)) {
    if (marker.start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, marker.start) });
    }
    const citation = byLabel.get(marker.label);
    segments.push(
      citation
        ? { kind: 'citation', citation }
        : { kind: 'broken', text: text.slice(marker.start, marker.end) },
    );
    cursor = marker.end;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }

  return segments;
}

/**
 * Enthält die Antwort überhaupt einen Beleg?
 *
 * Gebraucht für die Abstinenz-Prüfung: sagt das Modell „dazu steht nichts in
 * den Quellen", darf keine Behauptung mit Zitat danebenstehen.
 */
export function hasCitations(text: string): boolean {
  return findCitationMarkers(text).length > 0;
}
