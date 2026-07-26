import { CHUNK_MIN_CHARS, CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS } from './limits.js';

/**
 * Zerlegt extrahierten Text in Abschnitte für die Suche.
 *
 * Zwei Eigenschaften machen den Unterschied zu naivem Zerteilen alle N Zeichen:
 *
 *  1. **Struktur zuerst.** Es wird an Überschriften und Absatzgrenzen getrennt,
 *     nicht mitten im Satz. Ein Abschnitt, der auf halbem Satz endet, liefert
 *     ein schlechteres Embedding und ein unbrauchbares Zitat.
 *  2. **Überschriftenpfad.** Jeder Abschnitt weiß, unter welcher Überschrift er
 *     steht („Kapitel 3 › Methodik"). Das geht ins Modell und gibt dem Nutzer
 *     im Zitat Orientierung.
 *
 * Die Zeichenoffsets beziehen sich auf den übergebenen Text und werden für die
 * Hervorhebung im Quellen-Viewer gebraucht. Sie müssen exakt sein, sonst
 * springt ein Zitat auf die falsche Stelle.
 *
 * Zugesicherte Obergrenze: `tokenCount <= targetTokens + overlapTokens`. Die
 * Überlappung kommt zum eigentlichen Inhalt hinzu — das liegt in der Natur der
 * Sache und ist keine Verletzung des Ziels, sondern sein Preis.
 */

export type Chunk = {
  readonly idx: number;
  readonly content: string;
  readonly headingPath: string | null;
  readonly page: number | null;
  readonly charStart: number;
  readonly charEnd: number;
  readonly tokenCount: number;
};

export type ChunkOptions = {
  readonly targetTokens?: number;
  readonly overlapTokens?: number;
  readonly minChars?: number;
  /** Seitenumbrüche als Zeichenoffsets: Position → Seitenzahl. */
  readonly pageBreaks?: readonly { readonly offset: number; readonly page: number }[];
};

/**
 * Schätzt die Tokenzahl.
 *
 * Bewusst eine Schätzung: der echte Tokenizer des Embedding-Modells ist nur über
 * einen Netzwerkaufruf erreichbar, und für die Frage „passt dieser Absatz noch
 * in den Abschnitt" genügt eine Näherung. Der Faktor 3,3 Zeichen pro Token ist
 * für deutschen Text kalibriert — deutsche Komposita ergeben mehr Zeichen pro
 * Token als englischer Text, für den üblicherweise 4 angesetzt wird.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 3.3));
}

type Block = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly headingLevel: number | null;
};

/** Untergrenze für eine Überlappung: kürzer bringt keinen Kontext mehr. */
const MIN_OVERLAP_CHARS = 24;

/** Erkennt ATX-Überschriften (`## Titel`) am Zeilenanfang. */
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * Teilt den Text in Blöcke: Überschriften und Absätze, jeweils mit ihren
 * Offsets im Original.
 */
function splitIntoBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');

  let offset = 0;
  let paragraphStart = -1;
  let paragraphLines: string[] = [];

  const flushParagraph = (end: number) => {
    if (paragraphLines.length === 0) return;
    const content = paragraphLines.join('\n');
    if (content.trim().length > 0) {
      blocks.push({ text: content, start: paragraphStart, end, headingLevel: null });
    }
    paragraphLines = [];
    paragraphStart = -1;
  };

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1; // +1 für das \n

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      flushParagraph(lineStart > 0 ? lineStart - 1 : 0);
      blocks.push({
        text: line,
        start: lineStart,
        end: lineEnd,
        headingLevel: heading[1]?.length ?? 1,
      });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph(lineEnd);
      continue;
    }

    if (paragraphStart === -1) paragraphStart = lineStart;
    paragraphLines.push(line);
  }

  flushParagraph(text.length);
  return blocks;
}

/** Zerlegt einen überlangen Absatz an Satzgrenzen. */
function splitLongBlock(block: Block, targetTokens: number): Block[] {
  // Satzenden: Punkt, Frage- oder Ausrufezeichen, gefolgt von Leerraum. Die
  // Zeichenpositionen bleiben erhalten, damit die Offsets stimmen.
  const sentences: { text: string; start: number }[] = [];
  const pattern = /[^.!?]+[.!?]+[\s]*|[^.!?]+$/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block.text)) !== null) {
    sentences.push({ text: match[0], start: block.start + match.index });
  }

  if (sentences.length <= 1) {
    // Ein einzelner Satz ohne Satzzeichen (etwa eine Tabelle oder eine sehr
    // lange Zeile): hart nach Zeichen trennen. Besser ein grober Schnitt als
    // ein Abschnitt, der das Tokenlimit sprengt.
    const maxChars = Math.floor(targetTokens * 3.3);
    const parts: Block[] = [];
    for (let position = 0; position < block.text.length; position += maxChars) {
      const slice = block.text.slice(position, position + maxChars);
      parts.push({
        text: slice,
        start: block.start + position,
        end: block.start + position + slice.length,
        headingLevel: null,
      });
    }
    return parts;
  }

  const parts: Block[] = [];
  let current: { text: string; start: number } | null = null;

  for (const sentence of sentences) {
    if (current === null) {
      current = { text: sentence.text, start: sentence.start };
      continue;
    }
    if (estimateTokens(current.text + sentence.text) > targetTokens) {
      parts.push({
        text: current.text,
        start: current.start,
        end: current.start + current.text.length,
        headingLevel: null,
      });
      current = { text: sentence.text, start: sentence.start };
    } else {
      current = { text: current.text + sentence.text, start: current.start };
    }
  }

  if (current) {
    parts.push({
      text: current.text,
      start: current.start,
      end: current.start + current.text.length,
      headingLevel: null,
    });
  }

  return parts;
}

function pageForOffset(
  offset: number,
  pageBreaks: readonly { readonly offset: number; readonly page: number }[],
): number | null {
  if (pageBreaks.length === 0) return null;
  let page: number | null = null;
  for (const mark of pageBreaks) {
    if (mark.offset <= offset) page = mark.page;
    else break;
  }
  return page ?? pageBreaks[0]?.page ?? null;
}

/**
 * Baut den Überschriftenpfad. `#` setzt die oberste Ebene, `###` verschachtelt
 * darunter; eine gleichrangige Überschrift ersetzt die vorige.
 */
function updateHeadingStack(stack: string[], level: number, title: string): string[] {
  const next = stack.slice(0, level - 1);
  while (next.length < level - 1) next.push('');
  next[level - 1] = title;
  return next;
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const targetTokens = options.targetTokens ?? CHUNK_TARGET_TOKENS;
  const overlapTokens = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS;
  const minChars = options.minChars ?? CHUNK_MIN_CHARS;
  const pageBreaks = options.pageBreaks ?? [];

  if (text.trim().length === 0) return [];

  const blocks = splitIntoBlocks(text);
  const chunks: Chunk[] = [];

  let headingStack: string[] = [];
  let pending: Block[] = [];
  let pendingHeadingPath: string | null = null;

  const currentHeadingPath = () => {
    const parts = headingStack.filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join(' › ') : null;
  };

  const flush = () => {
    if (pending.length === 0) return;

    const first = pending[0];
    const last = pending[pending.length - 1];
    if (!first || !last) return;

    const content = pending
      .map((block) => block.text)
      .join('\n\n')
      .trim();
    if (content.length === 0) {
      pending = [];
      return;
    }

    chunks.push({
      idx: chunks.length,
      content,
      headingPath: pendingHeadingPath,
      page: pageForOffset(first.start, pageBreaks),
      charStart: first.start,
      charEnd: last.end,
      tokenCount: estimateTokens(content),
    });
    pending = [];
  };

  for (const block of blocks) {
    if (block.headingLevel !== null) {
      // Vor einer Überschrift abschließen: ein Abschnitt soll nicht über eine
      // Kapitelgrenze hinweg reichen.
      flush();
      const title = HEADING_PATTERN.exec(block.text)?.[2] ?? block.text;
      headingStack = updateHeadingStack(headingStack, block.headingLevel, title);
      pendingHeadingPath = currentHeadingPath();
      continue;
    }

    /*
     * An Seitengrenzen ebenfalls trennen. Ohne das kann ein Abschnitt über zwei
     * Seiten reichen und bekommt die Seitenzahl seines Anfangs — die
     * Hervorhebung im Viewer würde dann über einen Seitenumbruch hinweg
     * markieren, während das Zitat nur auf eine Seite zeigt. Aufgefallen im
     * Zusammenspiel mit dem PDF-Extraktor.
     */
    if (pending.length > 0 && pageBreaks.length > 0) {
      const first = pending[0];
      if (
        first &&
        pageForOffset(first.start, pageBreaks) !== pageForOffset(block.start, pageBreaks)
      ) {
        flush();
      }
    }

    if (pending.length === 0) {
      pendingHeadingPath = currentHeadingPath();
    }

    const parts =
      estimateTokens(block.text) > targetTokens
        ? splitLongBlock(block, targetTokens)
        : [block];

    for (const part of parts) {
      const combined = [...pending, part].map((entry) => entry.text).join('\n\n');
      if (pending.length > 0 && estimateTokens(combined) > targetTokens) {
        flush();
        pendingHeadingPath = currentHeadingPath();

        /*
         * Überlappung: das Ende des vorigen Abschnitts wiederholen, damit ein
         * Satz, der genau an der Grenze steht, in beiden Abschnitten
         * auffindbar ist. Ohne Überlappung fällt Kontext an jeder Schnittkante
         * weg und Treffer gehen verloren.
         */
        const previous = chunks[chunks.length - 1];
        if (previous && overlapTokens > 0) {
          const overlapChars = Math.floor(overlapTokens * 3.3);
          const tail = previous.content.slice(-overlapChars);
          // Erst ab der nächsten Satzgrenze übernehmen, damit die Überlappung
          // nicht mit einem Halbsatz beginnt.
          const sentenceStart = tail.search(/(?<=[.!?]\s)\S/);
          const overlap = sentenceStart > 0 ? tail.slice(sentenceStart) : tail;
          // Eigene Untergrenze, nicht minChars: minChars entscheidet, ob ein
          // Abschnitt zu kurz ist, um für sich zu stehen. Eine Überlappung darf
          // deutlich kürzer sein und nützt trotzdem — an minChars gemessen
          // wurde sie bei kleinem overlapTokens nie erzeugt.
          if (overlap.trim().length >= MIN_OVERLAP_CHARS) {
            pending.push({
              text: overlap.trim(),
              start: previous.charEnd - overlap.length,
              end: previous.charEnd,
              headingLevel: null,
            });
          }
        }
      }
      pending.push(part);
    }
  }

  flush();

  /*
   * Sehr kurze Abschnitte an den vorigen anhängen. Ein Abschnitt aus drei
   * Wörtern hat kein aussagekräftiges Embedding und würde die Suche mit
   * Rauschen füllen. Ausnahme: ist er der einzige, bleibt er.
   *
   * Entscheidend sind die beiden Zusatzbedingungen: zusammengelegt wird nur
   * **innerhalb desselben Überschriftenpfads und derselben Seite**. Ohne sie
   * hebt dieser Schritt die Trennung an Überschriften wieder auf und der
   * Abschnitt bekäme den Pfad des vorigen Kapitels beziehungsweise die
   * Seitenzahl des vorigen Blattes — das Zitat würde dann auf die falsche
   * Stelle verweisen. Genau das ist beim ersten Entwurf passiert: aus einem
   * Dokument mit drei Kapiteln wurde ein einziger Abschnitt.
   */
  const merged: Chunk[] = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      chunk.content.length < minChars &&
      previous.headingPath === chunk.headingPath &&
      previous.page === chunk.page
    ) {
      merged[merged.length - 1] = {
        ...previous,
        content: `${previous.content}\n\n${chunk.content}`,
        charEnd: chunk.charEnd,
        tokenCount: estimateTokens(`${previous.content}\n\n${chunk.content}`),
      };
      continue;
    }
    merged.push(chunk);
  }

  // Nach dem Zusammenführen neu numerieren: idx ist Teil des Zitat-Labels und
  // muss lückenlos sein.
  return merged.map((chunk, index) => ({ ...chunk, idx: index }));
}
