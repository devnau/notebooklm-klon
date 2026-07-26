import { EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS } from '@nlm/shared';

/**
 * Embeddings über Voyage AI.
 *
 * Warum Voyage und nicht Anthropic: Anthropic bietet keine Embeddings an und
 * empfiehlt Voyage. `voyage-3-large` ist mehrsprachig und liefert für deutsche
 * Fachtexte deutlich bessere Treffer als die kleineren Modelle.
 *
 * Zwei Eigenheiten, die den Code prägen:
 *
 *  1. **`input_type` ist nicht kosmetisch.** Voyage bettet Dokumente und
 *     Suchanfragen unterschiedlich ein. Wer beim Import `query` schickt oder
 *     bei der Suche `document`, bekommt messbar schlechtere Treffer — ohne dass
 *     irgendetwas fehlschlägt. Deshalb ist der Parameter hier verpflichtend.
 *  2. **Rate-Limits sind der Normalfall, nicht die Ausnahme.** Beim Import
 *     eines 300-Seiten-PDFs laufen Dutzende Anfragen hintereinander. Ohne
 *     Backoff bricht der Job auf halber Strecke ab und hinterlässt eine Quelle
 *     mit unvollständigem Index — schlimmer als ein Fehlschlag, weil die Suche
 *     dann stillschweigend Lücken hat.
 */

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-large';

/** Voyage nimmt maximal 1000 Texte und 120.000 Tokens pro Anfrage. */
const MAX_TEXTS_PER_REQUEST = EMBEDDING_BATCH_SIZE;

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

export type InputType = 'document' | 'query';

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly retryable: boolean,
    /** Aus dem Retry-After-Header, falls die API einen geschickt hat. */
    readonly retryAfterSeconds?: number | undefined,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

type VoyageResponse = {
  readonly data?: readonly {
    readonly embedding?: readonly number[];
    readonly index?: number;
  }[];
  readonly usage?: { readonly total_tokens?: number };
  readonly detail?: string;
};

export type EmbeddingResult = {
  readonly vectors: readonly (readonly number[])[];
  readonly totalTokens: number;
};

/** Für Tests austauschbar, damit kein echter API-Aufruf nötig ist. */
export type FetchResponseLike = {
  readonly ok: boolean;
  readonly status: number;
  /** Nur `retry-after` wird gelesen; der Rest der Header ist irrelevant. */
  readonly headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<FetchResponseLike>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wartezeit mit Jitter.
 *
 * Der Zufallsanteil ist wichtig, sobald mehrere Worker laufen: ohne ihn geraten
 * alle nach einem 429 in denselben Takt und treffen die API gleichzeitig wieder.
 */
function backoffDelay(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)) {
    return Math.min(retryAfterSeconds * 1000, MAX_DELAY_MS);
  }
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return exponential * (0.5 + Math.random() * 0.5);
}

export type EmbeddingClientOptions = {
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
  readonly onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  /** In Tests auf 0 setzen, damit nicht wirklich gewartet wird. */
  readonly sleepImpl?: (ms: number) => Promise<void>;
};

export class EmbeddingClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #onRetry:
    ((info: { attempt: number; delayMs: number; reason: string }) => void) | undefined;

  constructor(options: EmbeddingClientOptions) {
    if (!options.apiKey) {
      throw new EmbeddingError(
        'VOYAGE_API_KEY fehlt',
        'Der Dienst für die Textindexierung ist nicht konfiguriert.',
        false,
      );
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#sleep = options.sleepImpl ?? sleep;
    this.#onRetry = options.onRetry;
  }

  /**
   * Bettet Texte ein. Stapelt selbst, sodass der Aufrufer beliebig viele
   * übergeben kann.
   */
  async embed(texts: readonly string[], inputType: InputType): Promise<EmbeddingResult> {
    if (texts.length === 0) return { vectors: [], totalTokens: 0 };

    const vectors: (readonly number[])[] = [];
    let totalTokens = 0;

    for (let start = 0; start < texts.length; start += MAX_TEXTS_PER_REQUEST) {
      const batch = texts.slice(start, start + MAX_TEXTS_PER_REQUEST);
      const result = await this.#embedBatch(batch, inputType);
      vectors.push(...result.vectors);
      totalTokens += result.totalTokens;
    }

    return { vectors, totalTokens };
  }

  async #embedBatch(
    texts: readonly string[],
    inputType: InputType,
  ): Promise<EmbeddingResult> {
    let lastError: EmbeddingError | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        // Die Angabe der API hat Vorrang vor der eigenen Schätzung: sie weiß
        // besser, wann sie wieder bereit ist.
        const delayMs = backoffDelay(attempt - 1, lastError?.retryAfterSeconds);
        this.#onRetry?.({
          attempt,
          delayMs,
          reason: lastError?.message ?? 'unbekannt',
        });
        await this.#sleep(delayMs);
      }

      try {
        return await this.#request(texts, inputType);
      } catch (error) {
        if (!(error instanceof EmbeddingError)) throw error;
        // Nicht wiederholbare Fehler sofort durchreichen: bei einem falschen
        // Schlüssel bringt der fünfte Versuch dasselbe Ergebnis wie der erste,
        // nur eine Minute später.
        if (!error.retryable) throw error;
        lastError = error;
      }
    }

    throw (
      lastError ??
      new EmbeddingError(
        'Embedding nach allen Versuchen fehlgeschlagen',
        'Die Textindexierung war vorübergehend nicht erreichbar.',
        true,
      )
    );
  }

  async #request(texts: readonly string[], inputType: InputType): Promise<EmbeddingResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: FetchResponseLike;
    try {
      response = await this.#fetch(VOYAGE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: texts,
          model: MODEL,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
          // float statt base64: der Mehraufwand beim Übertragen ist geringer
          // als eine zusätzliche Dekodierstufe im Worker.
          output_dtype: 'float',
          // Zu lange Texte kürzen, statt die ganze Anfrage scheitern zu lassen.
          // Der Chunker hält die Grenze ohnehin ein; das ist die Rückfalllinie.
          truncation: true,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new EmbeddingError(
        `Netzwerkfehler: ${String(error)}`,
        'Die Textindexierung war nicht erreichbar.',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw await describeHttpError(response);
    }

    const body = (await response.json()) as VoyageResponse;
    const data = body.data ?? [];

    if (data.length !== texts.length) {
      throw new EmbeddingError(
        `Voyage lieferte ${data.length} Vektoren für ${texts.length} Texte`,
        'Die Textindexierung lieferte ein unerwartetes Ergebnis.',
        true,
      );
    }

    /*
     * Nach `index` sortieren statt auf die Reihenfolge zu vertrauen. Die API
     * liefert sie zwar sortiert, aber ein vertauschter Vektor wäre der
     * denkbar unangenehmste Fehler: die Suche fände dann Chunks, deren Inhalt
     * nicht zur Anfrage passt, ohne dass irgendetwas fehlschlägt.
     */
    const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    const vectors = sorted.map((entry, position) => {
      const vector = entry.embedding;
      if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
        throw new EmbeddingError(
          `Vektor ${position} hat ${vector?.length ?? 0} statt ${EMBEDDING_DIMENSIONS} Dimensionen`,
          'Die Textindexierung lieferte ein unerwartetes Ergebnis.',
          false,
        );
      }
      return vector;
    });

    return { vectors, totalTokens: body.usage?.total_tokens ?? 0 };
  }
}

async function describeHttpError(response: FetchResponseLike): Promise<EmbeddingError> {
  const text = await response.text().catch(() => '');
  const snippet = text.slice(0, 300);

  const retryAfterRaw = response.headers?.get('retry-after');
  const retryAfterSeconds =
    retryAfterRaw !== null && retryAfterRaw !== undefined && retryAfterRaw !== ''
      ? Number(retryAfterRaw)
      : undefined;

  switch (response.status) {
    case 401:
    case 403:
      return new EmbeddingError(
        `Voyage lehnte den Schlüssel ab (${response.status}): ${snippet}`,
        'Der Schlüssel für die Textindexierung wird abgelehnt. Bitte die Konfiguration prüfen.',
        false,
      );
    case 400:
      return new EmbeddingError(
        `Voyage meldet eine ungültige Anfrage: ${snippet}`,
        'Die Quelle konnte nicht indexiert werden.',
        false,
      );
    case 429:
      return new EmbeddingError(
        `Rate-Limit erreicht: ${snippet}`,
        'Die Textindexierung ist ausgelastet. Der Import wird automatisch fortgesetzt.',
        true,
        retryAfterSeconds,
      );
    default:
      return new EmbeddingError(
        `Voyage antwortete mit ${response.status}: ${snippet}`,
        'Die Textindexierung war vorübergehend nicht erreichbar.',
        response.status >= 500,
        retryAfterSeconds,
      );
  }
}
