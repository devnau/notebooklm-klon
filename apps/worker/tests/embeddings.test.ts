import { EMBEDDING_DIMENSIONS } from '@nlm/shared';
import { describe, expect, it } from 'vitest';

import {
  EmbeddingClient,
  EmbeddingError,
  type FetchLike,
  type FetchResponseLike,
} from '../src/lib/embeddings.js';

/**
 * Geprüft wird gegen eine nachgebildete API, nicht gegen die echte: die Tests
 * sollen ohne Netz, ohne Schlüssel und ohne Kosten laufen und trotzdem das
 * Verhalten bei Rate-Limits und Ausfällen abdecken — Fälle, die sich gegen die
 * echte API gar nicht zuverlässig auslösen ließen.
 */

function vector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (seed + i) / 10_000);
}

function okResponse(count: number, tokens = 42): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: Array.from({ length: count }, (_, index) => ({
          index,
          embedding: vector(index),
        })),
        usage: { total_tokens: tokens },
      }),
    text: () => Promise.resolve(''),
  };
}

function errorResponse(
  status: number,
  body = 'Fehler',
  headers: Record<string, string> = {},
): FetchResponseLike {
  return {
    ok: false,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  };
}

/** Sammelt die Anfragen, damit der Testkörper sie prüfen kann. */
function recorder(responses: FetchResponseLike[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl: FetchLike = (_url, init) => {
    // init.body ist im Test immer ein JSON-String; typeof-Prüfung statt
    // String(), damit nicht versehentlich '[object Object]' geparst wird.
    const raw = typeof init.body === 'string' ? init.body : '{}';
    bodies.push(JSON.parse(raw) as Record<string, unknown>);
    const next = responses.shift();
    if (!next) throw new Error('mehr Anfragen als vorbereitete Antworten');
    return Promise.resolve(next);
  };
  return { bodies, fetchImpl };
}

const noSleep = () => Promise.resolve();

describe('Anfrageaufbau', () => {
  it('schickt input_type document beim Import', async () => {
    const { bodies, fetchImpl } = recorder([okResponse(2)]);
    const client = new EmbeddingClient({ apiKey: 'test', fetchImpl, sleepImpl: noSleep });

    await client.embed(['Erster Text', 'Zweiter Text'], 'document');

    expect(bodies[0]?.input_type).toBe('document');
  });

  it('schickt input_type query bei der Suche', async () => {
    /*
     * Nicht kosmetisch: Voyage bettet Dokumente und Anfragen unterschiedlich
     * ein. Der falsche Wert liefert schlechtere Treffer, ohne dass irgendetwas
     * fehlschlägt — genau die Art Fehler, die man ohne Test nie bemerkt.
     */
    const { bodies, fetchImpl } = recorder([okResponse(1)]);
    const client = new EmbeddingClient({ apiKey: 'test', fetchImpl, sleepImpl: noSleep });

    await client.embed(['Was regelt Artikel 6?'], 'query');

    expect(bodies[0]?.input_type).toBe('query');
  });

  it('fordert die Dimension an, die das Schema erwartet', async () => {
    // Ein Vektor anderer Länge würde beim Insert scheitern — die Spalte ist
    // auf vector(1024) festgelegt.
    const { bodies, fetchImpl } = recorder([okResponse(1)]);
    const client = new EmbeddingClient({ apiKey: 'test', fetchImpl, sleepImpl: noSleep });

    await client.embed(['Text'], 'document');

    expect(bodies[0]?.output_dimension).toBe(EMBEDDING_DIMENSIONS);
  });

  it('verlangt einen Schlüssel', () => {
    expect(() => new EmbeddingClient({ apiKey: '' })).toThrow(EmbeddingError);
  });
});

describe('Stapelverarbeitung', () => {
  it('teilt große Mengen in mehrere Anfragen auf', async () => {
    // 300 Texte passen nicht in eine Anfrage; der Aufrufer soll sich darum
    // nicht kümmern müssen.
    const { bodies, fetchImpl } = recorder([
      okResponse(128),
      okResponse(128),
      okResponse(44),
    ]);
    const client = new EmbeddingClient({ apiKey: 'test', fetchImpl, sleepImpl: noSleep });

    const result = await client.embed(
      Array.from({ length: 300 }, (_, i) => `Text ${i}`),
      'document',
    );

    expect(bodies).toHaveLength(3);
    expect(result.vectors).toHaveLength(300);
  });

  it('summiert den Tokenverbrauch über alle Stapel', async () => {
    const { fetchImpl } = recorder([okResponse(128, 100), okResponse(72, 50)]);
    const client = new EmbeddingClient({ apiKey: 'test', fetchImpl, sleepImpl: noSleep });

    const result = await client.embed(
      Array.from({ length: 200 }, (_, i) => `Text ${i}`),
      'document',
    );

    expect(result.totalTokens).toBe(150);
  });

  it('kommt mit einer leeren Liste zurecht, ohne die API zu rufen', async () => {
    const { bodies, fetchImpl } = recorder([]);
    const client = new EmbeddingClient({ apiKey: 'test', fetchImpl, sleepImpl: noSleep });

    const result = await client.embed([], 'document');

    expect(bodies).toHaveLength(0);
    expect(result.vectors).toHaveLength(0);
  });
});

describe('Reihenfolge der Vektoren', () => {
  it('sortiert nach index statt auf die Reihenfolge zu vertrauen', async () => {
    /*
     * Der unangenehmste denkbare Fehler dieser Schicht: vertauschte Vektoren.
     * Die Suche fände dann Abschnitte, deren Inhalt nicht zur Anfrage passt —
     * ohne dass irgendwo ein Fehler auftritt. Deshalb wird sortiert, auch wenn
     * die API die Reihenfolge einhält.
     */
    const shuffled: FetchResponseLike = {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [
            { index: 2, embedding: vector(200) },
            { index: 0, embedding: vector(0) },
            { index: 1, embedding: vector(100) },
          ],
          usage: { total_tokens: 9 },
        }),
      text: () => Promise.resolve(''),
    };

    const client = new EmbeddingClient({
      apiKey: 'test',
      fetchImpl: () => Promise.resolve(shuffled),
      sleepImpl: noSleep,
    });

    const result = await client.embed(['a', 'b', 'c'], 'document');

    expect(result.vectors[0]?.[0]).toBeCloseTo(0);
    expect(result.vectors[1]?.[0]).toBeCloseTo(100 / 10_000);
    expect(result.vectors[2]?.[0]).toBeCloseTo(200 / 10_000);
  });

  it('weist eine Antwort mit falscher Anzahl ab', async () => {
    // Weniger Vektoren als Texte hieße: irgendein Abschnitt bekäme den Vektor
    // eines anderen. Lieber abbrechen und wiederholen.
    const client = new EmbeddingClient({
      apiKey: 'test',
      fetchImpl: () => Promise.resolve(okResponse(2)),
      sleepImpl: noSleep,
    });

    await expect(client.embed(['a', 'b', 'c'], 'document')).rejects.toThrow(
      /2 Vektoren für 3 Texte/,
    );
  });

  it('weist einen Vektor falscher Länge ab', async () => {
    const wrongSize: FetchResponseLike = {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ data: [{ index: 0, embedding: [1, 2, 3] }], usage: {} }),
      text: () => Promise.resolve(''),
    };

    const client = new EmbeddingClient({
      apiKey: 'test',
      fetchImpl: () => Promise.resolve(wrongSize),
      sleepImpl: noSleep,
    });

    await expect(client.embed(['a'], 'document')).rejects.toThrow(/3 statt 1024/);
  });
});

describe('Wiederholungen', () => {
  it('wiederholt nach einem Rate-Limit und liefert dann das Ergebnis', async () => {
    /*
     * Beim Import eines langen PDFs laufen Dutzende Anfragen. Ohne Wiederholung
     * bräche der Job auf halber Strecke ab und hinterließe eine Quelle mit
     * unvollständigem Index — schlimmer als ein klarer Fehlschlag, weil die
     * Suche dann stillschweigend Lücken hätte.
     */
    const retries: number[] = [];
    const { fetchImpl } = recorder([errorResponse(429), errorResponse(429), okResponse(1)]);

    const client = new EmbeddingClient({
      apiKey: 'test',
      fetchImpl,
      sleepImpl: noSleep,
      onRetry: ({ attempt }) => retries.push(attempt),
    });

    const result = await client.embed(['Text'], 'document');

    expect(result.vectors).toHaveLength(1);
    expect(retries).toEqual([1, 2]);
  });

  it('richtet sich nach dem Retry-After-Header', async () => {
    // Die API weiß besser als unsere Schätzung, wann sie wieder bereit ist.
    const delays: number[] = [];
    const { fetchImpl } = recorder([
      errorResponse(429, 'zu viele Anfragen', { 'retry-after': '7' }),
      okResponse(1),
    ]);

    const client = new EmbeddingClient({
      apiKey: 'test',
      fetchImpl,
      sleepImpl: noSleep,
      onRetry: ({ delayMs }) => delays.push(delayMs),
    });

    await client.embed(['Text'], 'document');

    expect(delays[0]).toBe(7000);
  });

  it('wiederholt bei Serverfehlern', async () => {
    const { fetchImpl } = recorder([errorResponse(503), okResponse(1)]);
    const client = new EmbeddingClient({ apiKey: 'test', fetchImpl, sleepImpl: noSleep });

    const result = await client.embed(['Text'], 'document');
    expect(result.vectors).toHaveLength(1);
  });

  it('wiederholt nach einem Netzwerkfehler', async () => {
    let calls = 0;
    const client = new EmbeddingClient({
      apiKey: 'test',
      sleepImpl: noSleep,
      fetchImpl: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('ECONNRESET'));
        return Promise.resolve(okResponse(1));
      },
    });

    const result = await client.embed(['Text'], 'document');
    expect(result.vectors).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('wiederholt einen falschen Schlüssel nicht', async () => {
    /*
     * Der fünfte Versuch bringt dasselbe Ergebnis wie der erste, nur eine
     * Minute später — und blockiert währenddessen den Worker.
     */
    let calls = 0;
    const client = new EmbeddingClient({
      apiKey: 'falsch',
      sleepImpl: noSleep,
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(errorResponse(401, 'invalid api key'));
      },
    });

    await expect(client.embed(['Text'], 'document')).rejects.toThrow(EmbeddingError);
    expect(calls).toBe(1);
  });

  it('wiederholt eine ungültige Anfrage nicht', async () => {
    let calls = 0;
    const client = new EmbeddingClient({
      apiKey: 'test',
      sleepImpl: noSleep,
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(errorResponse(400, 'input too long'));
      },
    });

    await expect(client.embed(['Text'], 'document')).rejects.toThrow(EmbeddingError);
    expect(calls).toBe(1);
  });

  it('gibt nach fünf Versuchen auf', async () => {
    let calls = 0;
    const client = new EmbeddingClient({
      apiKey: 'test',
      sleepImpl: noSleep,
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(errorResponse(429));
      },
    });

    await expect(client.embed(['Text'], 'document')).rejects.toThrow(EmbeddingError);
    expect(calls).toBe(5);
  });
});

describe('Fehlermeldungen', () => {
  it('nennt dem Nutzer keine technischen Einzelheiten', async () => {
    const client = new EmbeddingClient({
      apiKey: 'test',
      sleepImpl: noSleep,
      fetchImpl: () =>
        Promise.resolve(errorResponse(401, 'invalid api key sk-secret-12345')),
    });

    try {
      await client.embed(['Text'], 'document');
      expect.unreachable('hätte werfen müssen');
    } catch (error) {
      const embeddingError = error as EmbeddingError;
      // Die technische Meldung darf Details enthalten, die Nutzermeldung nicht.
      expect(embeddingError.userMessage).not.toContain('sk-secret');
      expect(embeddingError.userMessage).toContain('Konfiguration');
      expect(embeddingError.retryable).toBe(false);
    }
  });

  it('markiert vorübergehende Fehler als wiederholbar', async () => {
    const client = new EmbeddingClient({
      apiKey: 'test',
      sleepImpl: noSleep,
      fetchImpl: () => Promise.resolve(errorResponse(429)),
    });

    try {
      await client.embed(['Text'], 'document');
      expect.unreachable('hätte werfen müssen');
    } catch (error) {
      expect((error as EmbeddingError).retryable).toBe(true);
    }
  });
});
