import { EMBEDDING_DIMENSIONS } from '@nlm/shared';

import { requireKey } from '@/lib/env';

/**
 * Einbettung der Suchanfrage.
 *
 * Bewusst eine eigene, kleine Implementierung statt der aus dem Worker: dort
 * geht es um Stapel von hunderten Texten mit Wiederholungslogik über Minuten.
 * Hier ist es ein einzelner Text in einer Anfrage, auf die jemand wartet — ein
 * Backoff über eine Minute wäre hier kein Trost, sondern ein Timeout.
 *
 * Das gemeinsame Stück, auf das es ankommt, steht in `@nlm/shared`: die
 * Dimension. Läuft sie auseinander, passt der Anfragevektor nicht zu den
 * gespeicherten und die Suche liefert Unsinn statt eines Fehlers.
 */

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-large';
const TIMEOUT_MS = 15_000;

export class QueryEmbeddingError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = 'QueryEmbeddingError';
  }
}

/**
 * @param retryOn429 Ein einziger kurzer zweiter Versuch bei Rate-Limit.
 *
 * Bewusst nur einer und bewusst kurz: hier wartet ein Mensch auf eine Antwort.
 * Der Backoff des Workers geht über Minuten — das ergibt beim Import Sinn und
 * wäre hier ein Timeout. Ein einzelner Versuch nach zwei Sekunden fängt den
 * häufigen Fall ab, dass zwei Anfragen zufällig zusammentreffen; alles darüber
 * ist ein zu kleines Kontingent, und dann ist eine klare Meldung ehrlicher als
 * ein Ladebalken.
 */
export async function embedQuery(text: string, retryOn429 = true): Promise<number[]> {
  const apiKey = requireKey('VOYAGE_API_KEY');

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: [text],
        model: MODEL,
        /*
         * `query`, nicht `document`. Voyage bettet beides unterschiedlich ein,
         * und der falsche Wert liefert messbar schlechtere Treffer, ohne dass
         * irgendetwas fehlschlägt — die Suche wird einfach unauffällig
         * schlechter. Der Worker schickt beim Import entsprechend `document`.
         */
        input_type: 'query',
        output_dimension: EMBEDDING_DIMENSIONS,
        output_dtype: 'float',
        truncation: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new QueryEmbeddingError(
      `Voyage nicht erreichbar: ${String(error)}`,
      'Die Suche ist gerade nicht erreichbar. Bitte in einem Moment erneut versuchen.',
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429 && retryOn429) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return embedQuery(text, false);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new QueryEmbeddingError(
      `Voyage antwortete mit ${String(response.status)}: ${detail.slice(0, 300)}`,
      response.status === 429
        ? 'Gerade sind zu viele Anfragen unterwegs. Bitte kurz warten.'
        : 'Die Suche ist gerade nicht erreichbar.',
    );
  }

  const body = (await response.json()) as {
    data?: { embedding?: number[] }[];
  };
  const vector = body.data?.[0]?.embedding;

  if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new QueryEmbeddingError(
      `Unerwartete Antwort: ${String(vector?.length ?? 0)} statt ${String(EMBEDDING_DIMENSIONS)} Dimensionen`,
      'Die Suche lieferte ein unerwartetes Ergebnis.',
    );
  }

  return vector;
}
