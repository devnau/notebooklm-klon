import { describe, expect, it } from 'vitest';

import { mindmapSchema } from './artifacts.js';
import { escapeMermaidLabel, toMermaid } from './mindmap.js';

/**
 * Der Mermaid-Erzeuger bekommt Modellausgabe als Eingabe. Alles, was hier
 * durchrutscht, landet in einem Parser, dessen Fehlerverhalten wir nicht in der
 * Hand haben — im günstigen Fall wird nichts gezeichnet, im ungünstigen bricht
 * das Rendern der Seite ab.
 */

const basis = {
  root: 'Datenschutz',
  nodes: [
    { id: 'fristen', label: 'Löschfristen', parent: null },
    { id: 'bewerbung', label: 'Bewerbungsunterlagen', parent: 'fristen' },
    { id: 'meldung', label: 'Meldepflichten', parent: null },
  ],
};

describe('Beschriftungen entschärfen', () => {
  it('ersetzt Anführungszeichen', () => {
    // Mermaid kennt innerhalb eines Labels keine Escape-Sequenz für " — nur
    // die HTML-Entität. Ohne Ersetzung endet das Label mitten im Wort.
    expect(escapeMermaidLabel('Der Begriff "Frist"')).toBe('Der Begriff &quot;Frist&quot;');
  });

  it('macht aus Zeilenumbrüchen Leerzeichen', () => {
    expect(escapeMermaidLabel('Erste Zeile\nZweite Zeile')).toBe(
      'Erste Zeile Zweite Zeile',
    );
  });

  it('entschärft spitze Klammern', () => {
    expect(escapeMermaidLabel('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('lässt Klammern und Umlaute unverändert', () => {
    // Runde und eckige Klammern sind innerhalb von Anführungszeichen
    // unproblematisch; sie zu ersetzen würde nur Text verstümmeln.
    expect(escapeMermaidLabel('Anhang B (Muster) [alt]')).toBe('Anhang B (Muster) [alt]');
    expect(escapeMermaidLabel('Löschfrist für Bewerber')).toBe('Löschfrist für Bewerber');
  });
});

describe('Diagramm bauen', () => {
  it('hängt Knoten ohne Elternteil an die Wurzel', () => {
    const mermaid = toMermaid(mindmapSchema.parse(basis));

    expect(mermaid).toContain('nlm__root --> fristen');
    expect(mermaid).toContain('nlm__root --> meldung');
    expect(mermaid).toContain('fristen --> bewerbung');
  });

  it('rettet einen Knoten mit unbekanntem Elternteil an die Wurzel', () => {
    /*
     * Das Schema erzwingt nur die Form von `parent`, nicht die Gültigkeit des
     * Verweises. Ein verwaister Knoten soll an der falschen Stelle erscheinen
     * statt gar nicht — ein Begriff, den niemand mehr sieht, ist der
     * schlechtere Fehler.
     */
    const mermaid = toMermaid(
      mindmapSchema.parse({
        root: 'Thema',
        nodes: [
          { id: 'a', label: 'A', parent: null },
          { id: 'b', label: 'B', parent: 'gibtesnicht' },
          { id: 'c', label: 'C', parent: 'a' },
        ],
      }),
    );

    expect(mermaid).toContain('nlm__root --> b');
    expect(mermaid).not.toContain('gibtesnicht');
  });

  it('löst einen Selbstverweis auf', () => {
    const mermaid = toMermaid(
      mindmapSchema.parse({
        root: 'Thema',
        nodes: [
          { id: 'a', label: 'A', parent: 'a' },
          { id: 'b', label: 'B', parent: null },
          { id: 'c', label: 'C', parent: null },
        ],
      }),
    );

    expect(mermaid).toContain('nlm__root --> a');
    expect(mermaid).not.toContain('a --> a');
  });

  it('setzt jede Beschriftung in Anführungszeichen', () => {
    const mermaid = toMermaid(
      mindmapSchema.parse({
        root: 'Thema mit "Zitat"',
        nodes: [
          { id: 'a', label: 'Punkt (a)', parent: null },
          { id: 'b', label: 'B', parent: null },
          { id: 'c', label: 'C', parent: null },
        ],
      }),
    );

    expect(mermaid).toContain('nlm__root["Thema mit &quot;Zitat&quot;"]');
    expect(mermaid).toContain('a["Punkt (a)"]');
  });
});

describe('Schema', () => {
  it('weist eine Kennung mit Sonderzeichen ab', () => {
    // Die Kennung wird unmaskiert als Mermaid-Knotenname eingesetzt. Alles
    // ausser Buchstaben, Ziffern und Unterstrich könnte dort Syntax sein.
    const result = mindmapSchema.safeParse({
      root: 'Thema',
      nodes: [
        { id: 'a-->b', label: 'Böse', parent: null },
        { id: 'b', label: 'B', parent: null },
        { id: 'c', label: 'C', parent: null },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('verlangt mindestens drei Knoten', () => {
    // Zwei Knoten sind kein Diagramm, sondern eine Aufzählung.
    const result = mindmapSchema.safeParse({
      root: 'Thema',
      nodes: [
        { id: 'a', label: 'A', parent: null },
        { id: 'b', label: 'B', parent: null },
      ],
    });

    expect(result.success).toBe(false);
  });
});
