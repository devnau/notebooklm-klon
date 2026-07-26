import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { extractText, getDocumentProxy } from 'unpdf';

import { MAX_EXTRACTED_CHARS, MAX_PDF_PAGES, type SourceKind } from '@nlm/shared';

/**
 * Extraktion von Text aus den unterstützten Quellenformaten.
 *
 * Alle Extraktoren liefern **Markdown**, nicht rohen Text. Überschriften und
 * Absätze bleiben dadurch erhalten, und der Chunker kann daran trennen — ohne
 * Struktur wäre der Überschriftenpfad im Zitat nicht rekonstruierbar.
 *
 * `pageBreaks` gibt es nur bei PDF: dort sind Seitenzahlen bekannt und werden
 * für die Sprungmarke im Zitat gebraucht.
 */

export type ExtractionResult = {
  readonly markdown: string;
  readonly pageCount: number | null;
  readonly pageBreaks: readonly { readonly offset: number; readonly page: number }[];
  readonly title: string | null;
  /** Hinweise für den Nutzer, die kein Fehler sind (etwa: gescannte Seiten). */
  readonly warnings: readonly string[];
};

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Normalisiert Leerraum, ohne Absatzgrenzen zu verlieren. */
function normalize(text: string): string {
  return (
    text
      // Windows- und Mac-Zeilenenden vereinheitlichen. Wichtiger als es aussieht:
      // der Chunker berechnet Offsets gegen den gespeicherten Text. Bleiben \r\n
      // stehen, zählt er gegen eine andere Zeichenfolge als der Viewer anzeigt,
      // und jede Hervorhebung ist um die Zeilenzahl verschoben.
      .replace(/\r\n?/g, '\n')
      // Weiche Trennstriche (U+00AD) entfernen: sie stammen aus PDFs und
      // zerstören die Volltextsuche — "Ver\u00ADtrag" findet niemand, der
      // "Vertrag" sucht. Als Escape geschrieben, weil das Zeichen unsichtbar ist.
      .replace(/\u00AD/g, '')
      // Zero-Width-Zeichen (U+200B bis U+200D, U+FEFF).
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // Mehr als zwei Leerzeilen tragen keine Information.
      .replace(/\n{3,}/g, '\n\n')
      // Leerraum am Zeilenende.
      .replace(/[ \t]+$/gm, '')
      .trim()
  );
}

function guardLength(markdown: string, warnings: string[]): string {
  if (markdown.length <= MAX_EXTRACTED_CHARS) return markdown;
  warnings.push(
    `Die Quelle wurde nach ${Math.round(MAX_EXTRACTED_CHARS / 1000)}.000 Zeichen abgeschnitten.`,
  );
  return markdown.slice(0, MAX_EXTRACTED_CHARS);
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/**
 * PDF seitenweise lesen, damit Seitenzahlen erhalten bleiben.
 *
 * Ein häufiger Fall in der Praxis: ein gescanntes PDF ohne Textebene. Dann
 * liefert die Extraktion nichts, und die richtige Antwort ist eine klare
 * Meldung an den Nutzer — nicht eine leere Quelle, die im Chat stumm bleibt.
 */
export async function extractPdf(data: Uint8Array): Promise<ExtractionResult> {
  const warnings: string[] = [];

  const pdf = await getDocumentProxy(data);
  const pageCount = pdf.numPages;

  if (pageCount > MAX_PDF_PAGES) {
    throw new ExtractionError(
      `PDF hat ${pageCount} Seiten, Grenze ist ${MAX_PDF_PAGES}`,
      `Das Dokument hat ${pageCount} Seiten. Verarbeitet werden bis zu ${MAX_PDF_PAGES}.`,
    );
  }

  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];

  const parts: string[] = [];
  const pageBreaks: { offset: number; page: number }[] = [];
  let offset = 0;
  let emptyPages = 0;

  for (const [index, raw] of pages.entries()) {
    const pageText = normalize(raw ?? '');
    if (pageText.length === 0) {
      emptyPages += 1;
      continue;
    }

    pageBreaks.push({ offset, page: index + 1 });
    parts.push(pageText);
    // +2 für das \n\n, mit dem die Seiten verbunden werden.
    offset += pageText.length + 2;
  }

  const markdown = parts.join('\n\n');

  if (markdown.trim().length === 0) {
    throw new ExtractionError(
      'PDF enthält keine Textebene',
      'Aus diesem PDF ließ sich kein Text lesen. Es ist wahrscheinlich ein Scan ohne Texterkennung — bitte vorher durch eine OCR-Software geben.',
    );
  }

  if (emptyPages > 0) {
    warnings.push(
      emptyPages === 1
        ? 'Eine Seite enthielt keinen lesbaren Text.'
        : `${emptyPages} Seiten enthielten keinen lesbaren Text.`,
    );
  }

  return {
    markdown: guardLength(markdown, warnings),
    pageCount,
    pageBreaks,
    title: null,
    warnings,
  };
}

// ── DOCX ────────────────────────────────────────────────────────────────────

/**
 * DOCX über Mammoth nach HTML und von dort nach Markdown.
 *
 * Der Umweg über HTML ist Absicht: Mammoth kennt die Word-Stile und bildet
 * Überschriften korrekt ab. Ein direkter Textexport würde die Struktur
 * verlieren, die der Chunker braucht.
 */
export async function extractDocx(data: Uint8Array): Promise<ExtractionResult> {
  const warnings: string[] = [];

  const { value: html, messages } = await mammoth.convertToHtml({
    buffer: Buffer.from(data),
  });

  for (const message of messages) {
    if (message.type === 'warning') warnings.push(message.message);
  }

  const markdown = normalize(htmlToMarkdown(html));

  if (markdown.length === 0) {
    throw new ExtractionError(
      'DOCX ohne Textinhalt',
      'Das Dokument enthält keinen lesbaren Text.',
    );
  }

  return {
    markdown: guardLength(markdown, warnings),
    pageCount: null,
    pageBreaks: [],
    title: null,
    warnings,
  };
}

// ── HTML ────────────────────────────────────────────────────────────────────

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx', // `## Titel` — der Chunker erkennt nur diese Form.
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });

  // Elemente, die keinen Inhalt tragen, vollständig verwerfen.
  service.remove(['script', 'style', 'noscript', 'iframe', 'form', 'nav', 'footer']);

  // Bilder durch ihren Alternativtext ersetzen: der kann Information tragen,
  // die URL nicht.
  service.addRule('imageAlt', {
    filter: 'img',
    replacement: (_content, node) => {
      const alt = (node as unknown as { getAttribute(name: string): string | null })
        .getAttribute('alt')
        ?.trim();
      return alt ? `\n\n${alt}\n\n` : '';
    },
  });

  return service;
}

/**
 * Die Typen von linkedom und Readability greifen in diesem Projekt nicht
 * zusammen: der Worker läuft in Node und hat bewusst keine DOM-Typen, während
 * beide Bibliotheken auf `Document` aus dem Browser verweisen.
 *
 * Statt überall `any` durchzureichen wird die Grenze hier einmal beschrieben —
 * mit genau den Eigenschaften, die tatsächlich verwendet werden. Alles darüber
 * hinaus ist für diesen Code nicht relevant.
 */
type ParsedDocument = {
  readonly title?: string;
  readonly body?: { readonly innerHTML?: string } | null;
};

type ParsedArticle = {
  readonly title?: string | null;
  readonly content?: string | null;
};

/**
 * Readabilitys eigene Typdeklaration verweist auf `Document` aus dem DOM. Die
 * DOM-Typen nur dafür einzuschleppen wäre falsch: dann würde `window.x` im
 * Worker durch die Typprüfung gehen und zur Laufzeit scheitern.
 *
 * Deshalb wird hier der Teil des Vertrags beschrieben, der tatsächlich benutzt
 * wird — ein Konstruktor und `parse()`. Das ist explizit statt `any` und
 * dokumentiert gleichzeitig, worauf sich dieser Code verlässt.
 */
type ReadabilityConstructor = new (
  document: unknown,
  options?: { charThreshold?: number },
) => { parse(): ParsedArticle | null };

const ReadabilityTyped = Readability as unknown as ReadabilityConstructor;

function htmlToMarkdown(html: string): string {
  return createTurndown().turndown(html);
}

/**
 * Extrahiert den Hauptinhalt einer Webseite.
 *
 * Readability entfernt Navigation, Werbung und Fußzeilen — ohne diesen Schritt
 * bestünde die halbe „Quelle" aus Menüpunkten, die dann als Zitat auftauchen
 * könnten.
 */
export function extractHtml(html: string, url: string): ExtractionResult {
  const warnings: string[] = [];

  const parsed = parseHTML(html) as { document: unknown };
  // Einmal an der Grenze festlegen, was verwendet wird.
  const document = parsed.document as ParsedDocument;

  const article = new ReadabilityTyped(document, { charThreshold: 200 }).parse();

  let markdown: string;
  let title: string | null;

  if (article?.content) {
    markdown = normalize(htmlToMarkdown(article.content));
    title = article.title?.trim() ?? null;
  } else {
    // Readability scheitert an Seiten ohne erkennbaren Artikel (Übersichten,
    // Anwendungen). Dann der ganze Body — mit Hinweis, weil die Qualität
    // schlechter ist.
    warnings.push(
      'Auf dieser Seite war kein zusammenhängender Artikel erkennbar. Der Inhalt wurde vollständig übernommen und enthält möglicherweise Navigation.',
    );
    markdown = normalize(htmlToMarkdown(document.body?.innerHTML ?? ''));
    title = document.title?.trim() ?? null;
  }

  if (markdown.length === 0) {
    throw new ExtractionError(
      `keine Inhalte in ${url}`,
      'Von dieser Seite ließ sich kein Text lesen. Lädt sie ihren Inhalt per JavaScript nach, hilft es, den Text direkt einzufügen.',
    );
  }

  return {
    markdown: guardLength(markdown, warnings),
    pageCount: null,
    pageBreaks: [],
    title,
    warnings,
  };
}

// ── Text und Markdown ───────────────────────────────────────────────────────

export function extractPlainText(data: Uint8Array): ExtractionResult {
  const warnings: string[] = [];
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(data);
  const markdown = normalize(raw);

  if (markdown.length === 0) {
    throw new ExtractionError('leere Textdatei', 'Die Datei enthält keinen Text.');
  }

  // Reiner Text bekommt keine künstliche Struktur: was keine Überschriften hat,
  // soll auch keine erfundenen bekommen. Der Chunker trennt dann an Absätzen.
  return {
    markdown: guardLength(markdown, warnings),
    pageCount: null,
    pageBreaks: [],
    title: null,
    warnings,
  };
}

// ── Verteiler ───────────────────────────────────────────────────────────────

export async function extract(
  kind: SourceKind,
  input: { readonly data?: Uint8Array; readonly html?: string; readonly url?: string },
): Promise<ExtractionResult> {
  switch (kind) {
    case 'pdf':
      if (!input.data) throw new ExtractionError('keine Daten', 'Die Datei fehlt.');
      return extractPdf(input.data);
    case 'docx':
      if (!input.data) throw new ExtractionError('keine Daten', 'Die Datei fehlt.');
      return extractDocx(input.data);
    case 'url':
      if (input.html === undefined) {
        throw new ExtractionError('kein HTML', 'Die Seite konnte nicht geladen werden.');
      }
      return extractHtml(input.html, input.url ?? '');
    case 'txt':
    case 'md':
    case 'paste':
      if (!input.data) throw new ExtractionError('keine Daten', 'Der Text fehlt.');
      return extractPlainText(input.data);
  }
}
