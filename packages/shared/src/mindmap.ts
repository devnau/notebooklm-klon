import type { MindmapPayload } from './artifacts.js';

/**
 * Wandelt eine Mindmap in Mermaid-Quelltext.
 *
 * Zwei Dinge, an denen das leicht schiefgeht:
 *
 *  1. **Beschriftungen sind Modellausgabe und damit beliebiger Text.** Ein
 *     Label mit `"`, `(`, `[` oder einem Zeilenumbruch bringt den
 *     Mermaid-Parser aus dem Tritt — im günstigen Fall wird nichts gezeichnet,
 *     im ungünstigen bricht das Rendern der ganzen Seite ab. Deshalb wird
 *     jedes Label in Anführungszeichen gesetzt und darin entschärft.
 *  2. **`parent` kann ins Leere zeigen.** Das Schema erzwingt nur die Form,
 *     nicht die Gültigkeit des Verweises. Ein Knoten mit unbekanntem Elternteil
 *     wird an die Wurzel gehängt, statt zu verschwinden: lieber ein Ast an der
 *     falschen Stelle als ein Begriff, den niemand mehr sieht.
 */

/** Wurzelkennung. Kollidiert nicht mit den Kennungen aus dem Schema (die beginnen mit einem Buchstaben und dürfen kein `__` enthalten … prüfen wir trotzdem). */
const ROOT_ID = 'nlm__root';

/**
 * Entschärft eine Beschriftung für Mermaid.
 *
 * Mermaid kennt keine Escape-Sequenz für `"` innerhalb eines
 * anführungszeichen-begrenzten Labels — es gibt nur die HTML-Entität. Deshalb
 * wird ersetzt statt maskiert.
 */
export function escapeMermaidLabel(label: string): string {
  return (
    label
      .replace(/[\r\n]+/g, ' ')
      .replace(/"/g, '&quot;')
      // Spitze Klammern: Mermaid gibt Labels als HTML aus, wenn `htmlLabels`
      // aktiv ist. Selbst wenn wir es abschalten — die Einstellung liegt beim
      // Renderer, die Entschärfung gehört hierher.
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .trim()
  );
}

export function toMermaid(payload: MindmapPayload): string {
  const known = new Set(payload.nodes.map((node) => node.id));

  const lines = [
    'graph LR',
    `  ${ROOT_ID}["${escapeMermaidLabel(payload.root)}"]`,
    `  classDef wurzel stroke-width:2px;`,
    `  class ${ROOT_ID} wurzel;`,
  ];

  for (const node of payload.nodes) {
    lines.push(`  ${node.id}["${escapeMermaidLabel(node.label)}"]`);
  }

  for (const node of payload.nodes) {
    const parent =
      node.parent !== null && node.parent !== '' && known.has(node.parent)
        ? node.parent
        : ROOT_ID;
    // Ein Knoten, der auf sich selbst verweist, ergäbe eine Schleife im
    // Diagramm; er wandert an die Wurzel.
    lines.push(`  ${parent === node.id ? ROOT_ID : parent} --> ${node.id}`);
  }

  return lines.join('\n');
}
