import { describe, expect, it } from 'vitest';

import {
  citationLabel,
  findCitationMarkers,
  hasCitations,
  resolveCitations,
  segmentAnswer,
  type ContextChunk,
} from './citations.js';

/**
 * Der Zitat-Parser entscheidet, ob ein Verweis funktioniert. Ein übersehener
 * Marker heisst: eine belegte Aussage sieht unbelegt aus. Ein falsch
 * aufgelöster Marker heisst: der Klick führt an die falsche Stelle — und das
 * ist schlimmer, weil es wie eine Bestätigung aussieht.
 */

function chunk(overrides: Partial<ContextChunk> = {}): ContextChunk {
  return {
    sourceNumber: 1,
    chunkNumber: 4,
    sourceId: '11111111-1111-1111-1111-111111111111',
    sourceTitle: 'Verordnung.pdf',
    chunkId: 42,
    content: 'Die Verordnung regelt den Umgang mit personenbezogenen Daten.',
    headingPath: 'Kapitel 2 › 2.1',
    page: 3,
    charStart: 1200,
    charEnd: 1980,
    ...overrides,
  };
}

describe('Marker finden', () => {
  it('findet einen einzelnen Marker', () => {
    const markers = findCitationMarkers('Die Frist beträgt 30 Tage [S1:4].');

    expect(markers).toHaveLength(1);
    expect(markers[0]?.label).toBe('S1:4');
    expect(markers[0]?.sourceNumber).toBe(1);
    expect(markers[0]?.chunkNumber).toBe(4);
  });

  it('findet mehrere Marker hintereinander', () => {
    // Das Modell soll mehrere Belege nebeneinander setzen dürfen, wenn eine
    // Aussage aus mehreren Stellen folgt.
    const markers = findCitationMarkers('Das ergibt sich aus [S1:4][S2:9].');

    expect(markers.map((marker) => marker.label)).toEqual(['S1:4', 'S2:9']);
  });

  it('liefert Positionen, die zum Text passen', () => {
    const text = 'Vorher [S1:4] nachher';
    const marker = findCitationMarkers(text)[0];

    expect(text.slice(marker?.start, marker?.end)).toBe('[S1:4]');
  });

  it('ignoriert normale Klammerausdrücke', () => {
    /*
     * Quellentexte enthalten Klammern: Fussnoten, Paragraphen, Aufzählungen.
     * Ein toleranteres Muster würde davon einiges erwischen und daraus
     * Schaltflächen bauen, die nirgendwohin führen.
     */
    expect(findCitationMarkers('Siehe [1], [Anhang B] und [S. 12].')).toHaveLength(0);
    expect(findCitationMarkers('[s1:4] ist kleingeschrieben')).toHaveLength(0);
    expect(findCitationMarkers('[S1: 4] hat ein Leerzeichen')).toHaveLength(0);
    expect(findCitationMarkers('[S1:4 ohne Klammer')).toHaveLength(0);
  });

  it('kommt mit wiederholten Aufrufen zurecht', () => {
    // Das globale Flag einer geteilten RegExp würde lastIndex mitführen und beim
    // zweiten Aufruf Treffer überspringen — ein Fehler, der nur sporadisch
    // auftritt und deshalb schwer zu finden wäre.
    const text = 'Erst [S1:1], dann [S1:2].';

    expect(findCitationMarkers(text)).toHaveLength(2);
    expect(findCitationMarkers(text)).toHaveLength(2);
  });
});

describe('Zitate auflösen', () => {
  it('ordnet einen Marker seinem Auszug zu', () => {
    const { citations, unresolved } = resolveCitations('Beleg [S1:4].', [chunk()]);

    expect(unresolved).toHaveLength(0);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.chunkId).toBe(42);
    expect(citations[0]?.page).toBe(3);
    expect(citations[0]?.charStart).toBe(1200);
  });

  it('meldet einen erfundenen Marker, statt ihn zu verschlucken', () => {
    /*
     * Der wichtigste Test der Datei. Ein Modell, das [S9:2] erfindet, obwohl es
     * nur eine Quelle gab, darf keine Schaltfläche erzeugen — und der Fehler
     * darf nicht still verschwinden, sonst merkt niemand, dass die Antwort
     * einen Beleg vortäuscht.
     */
    const { citations, unresolved } = resolveCitations('Angeblich [S9:2].', [chunk()]);

    expect(citations).toHaveLength(0);
    expect(unresolved.map((marker) => marker.label)).toEqual(['S9:2']);
  });

  it('führt denselben Marker nur einmal auf', () => {
    const text = 'Erst [S1:4], später erneut [S1:4].';

    expect(resolveCitations(text, [chunk()]).citations).toHaveLength(1);
  });

  it('behält die Reihenfolge des ersten Auftretens', () => {
    // Die Reihenfolge ist sichtbar: die Quellenliste unter der Antwort folgt
    // ihr. Sortiert nach ID wäre sie beliebig.
    const context = [
      chunk({ sourceNumber: 2, chunkNumber: 1, chunkId: 7 }),
      chunk({ sourceNumber: 1, chunkNumber: 4, chunkId: 42 }),
    ];
    const { citations } = resolveCitations('Zuerst [S2:1], dann [S1:4].', context);

    expect(citations.map((citation) => citation.chunkId)).toEqual([7, 42]);
  });

  it('kommt mit einer Antwort ganz ohne Marker zurecht', () => {
    const { citations, unresolved } = resolveCitations(
      'Dazu steht in den Quellen nichts.',
      [chunk()],
    );

    expect(citations).toHaveLength(0);
    expect(unresolved).toHaveLength(0);
  });
});

describe('Antwort zerlegen', () => {
  it('trennt Text und Zitat', () => {
    const { citations } = resolveCitations('Die Frist beträgt 30 Tage [S1:4].', [chunk()]);
    const segments = segmentAnswer('Die Frist beträgt 30 Tage [S1:4].', citations);

    expect(segments.map((segment) => segment.kind)).toEqual(['text', 'citation', 'text']);
    expect(segments[0]).toEqual({ kind: 'text', text: 'Die Frist beträgt 30 Tage ' });
    expect(segments[2]).toEqual({ kind: 'text', text: '.' });
  });

  it('zeigt einen unauflösbaren Marker als Text statt als Verweis', () => {
    const segments = segmentAnswer('Angeblich [S9:2].', []);

    expect(segments[1]).toEqual({ kind: 'broken', text: '[S9:2]' });
  });

  it('lässt einen halben Marker während des Streamings in Ruhe', () => {
    /*
     * Beim Streaming kommt '[S1:' an, bevor '4]' da ist. Ein Muster, das das
     * schon als Zitat läse, würde beim nächsten Token wieder umspringen — die
     * Antwort flackerte beim Tippen.
     */
    const segments = segmentAnswer('Die Frist beträgt 30 Tage [S1:', []);

    expect(segments).toEqual([{ kind: 'text', text: 'Die Frist beträgt 30 Tage [S1:' }]);
  });

  it('behandelt zwei Zitate direkt hintereinander', () => {
    const context = [chunk(), chunk({ sourceNumber: 2, chunkNumber: 9, chunkId: 8 })];
    const text = 'Das folgt aus [S1:4][S2:9] zusammen.';
    const { citations } = resolveCitations(text, context);
    const segments = segmentAnswer(text, citations);

    expect(segments.map((segment) => segment.kind)).toEqual([
      'text',
      'citation',
      'citation',
      'text',
    ]);
  });

  it('gibt bei leerem Text nichts zurück', () => {
    expect(segmentAnswer('', [])).toEqual([]);
  });
});

describe('Hilfsfunktionen', () => {
  it('baut ein Label', () => {
    expect(citationLabel(3, 12)).toBe('S3:12');
  });

  it('erkennt, ob überhaupt belegt wurde', () => {
    // Grundlage der Abstinenz-Prüfung: sagt das Modell, die Quellen geben nichts
    // her, darf daneben keine belegte Behauptung stehen.
    expect(hasCitations('Dazu steht in den Quellen nichts.')).toBe(false);
    expect(hasCitations('Die Frist beträgt 30 Tage [S1:4].')).toBe(true);
  });
});
