/**
 * Sprachausgabe hinter einem Adapter.
 *
 * Zwei Anbieter, weil keiner allein reicht: Kokoro-82M klingt natürlicher,
 * kann aber **kein Deutsch** — nur en, ja, zh, es, fr, hi, it und pt-BR. Für
 * eine primär deutschsprachige Anwendung wäre es damit unbrauchbar, unabhängig
 * von der Qualität. Piper hat brauchbare deutsche Stimmen und läuft schnell auf
 * CPU. Die Notebook-Sprache entscheidet. (docs/adr/0005)
 *
 * Der Adapter ist nicht Vorratshaltung: falls Stimmqualität später wichtiger
 * wird als Self-Hosting, kommt ein Cloud-Anbieter hinter dasselbe Interface,
 * ohne dass die Pipeline etwas merkt.
 *
 * Beide Anbieter sprechen HTTP und liefern WAV. Das ist kein Zufall — für
 * Piper gibt es dafür eine eigene kleine Hülle (`docker/piper`), weil die
 * verbreiteten Container Wyoming über TCP sprechen und der Worker sonst zwei
 * Protokolle können müsste.
 */

export type SpeakerRole = 'host' | 'guest';

export type Voice = {
  readonly provider: 'piper' | 'kokoro';
  readonly name: string;
  /** Für die Anzeige im Transkript. */
  readonly label: string;
};

/**
 * Die Stimmen je Sprache und Rolle.
 *
 * Zwei deutlich unterscheidbare Stimmen pro Sprache — das ist der Punkt eines
 * Zwei-Sprecher-Formats. Zwei ähnliche Stimmen wären schlechter als eine,
 * weil der Hörer dann rät, wer gerade spricht.
 *
 * Die Piper-Namen müssen in der Positivliste von `docker/piper/server.py`
 * stehen; sie ist der Vertrag zwischen beiden Seiten.
 */
export const VOICES: Record<string, Record<SpeakerRole, Voice>> = {
  de: {
    host: { provider: 'piper', name: 'de_DE-thorsten-high', label: 'Thorsten' },
    guest: { provider: 'piper', name: 'de_DE-kerstin-low', label: 'Kerstin' },
  },
  en: {
    host: { provider: 'kokoro', name: 'af_heart', label: 'Heather' },
    guest: { provider: 'kokoro', name: 'am_michael', label: 'Michael' },
  },
};

export function voiceFor(language: string, role: SpeakerRole): Voice {
  return (VOICES[language] ?? VOICES.de!)[role];
}

export class TtsError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TtsError';
  }
}

export type TtsConfig = {
  readonly piperUrl: string;
  readonly kokoroUrl: string;
  /** Für Tests austauschbar. */
  readonly fetchImpl?: typeof fetch;
};

/**
 * Wie lange ein einzelner Satz höchstens dauern darf.
 *
 * Piper braucht auf CPU grob Echtzeit; ein Absatz von 30 Sekunden dauert also
 * etwa so lange. 120 Sekunden lassen reichlich Luft und fangen trotzdem einen
 * hängenden Dienst ab, statt den Job über die Lease laufen zu lassen.
 */
const TIMEOUT_MS = 120_000;

export class TtsClient {
  readonly #config: TtsConfig;
  readonly #fetch: typeof fetch;

  constructor(config: TtsConfig) {
    this.#config = config;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  /** Synthetisiert einen Redebeitrag und gibt WAV-Daten zurück. */
  async synthesize(text: string, voice: Voice): Promise<Uint8Array> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new TtsError('Leerer Text', 'Ein Redebeitrag war leer.', false);
    }

    return voice.provider === 'piper'
      ? this.#piper(trimmed, voice)
      : this.#kokoro(trimmed, voice);
  }

  async #piper(text: string, voice: Voice): Promise<Uint8Array> {
    return this.#request(
      `${this.#config.piperUrl}/synthesize`,
      { text, voice: voice.name },
      voice,
    );
  }

  async #kokoro(text: string, voice: Voice): Promise<Uint8Array> {
    /*
     * Kokoro spricht die OpenAI-Schnittstelle nach. `response_format: wav`
     * ist wichtig: die Voreinstellung ist MP3, und ein zweites Mal zu
     * kodieren, bevor ffmpeg alles zusammenfügt, kostet hörbar Qualität.
     */
    return this.#request(
      `${this.#config.kokoroUrl}/v1/audio/speech`,
      {
        model: 'kokoro',
        input: text,
        voice: voice.name,
        response_format: 'wav',
      },
      voice,
    );
  }

  async #request(
    url: string,
    body: Record<string, unknown>,
    voice: Voice,
  ): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new TtsError(
        `${voice.provider} nicht erreichbar: ${String(error)}`,
        'Die Sprachausgabe ist nicht erreichbar.',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new TtsError(
        `${voice.provider} antwortete mit ${String(response.status)}: ${detail.slice(0, 300)}`,
        'Die Sprachausgabe hat den Text abgelehnt.',
        // 4xx wiederholen bringt nichts — der Text bleibt derselbe.
        response.status >= 500,
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    /*
     * Prüfen, dass wirklich WAV zurückkam. Ein Dienst, der bei einem internen
     * Fehler eine JSON-Meldung mit Status 200 liefert, würde sonst als
     * Audiospur durchgereicht — und der Fehler fiele erst auf, wenn jemand die
     * fertige Datei anhört.
     */
    if (bytes.byteLength < 44 || !startsWithRiff(bytes)) {
      throw new TtsError(
        `${voice.provider} lieferte kein WAV (${String(bytes.byteLength)} Bytes)`,
        'Die Sprachausgabe lieferte ein unerwartetes Ergebnis.',
        true,
      );
    }

    return bytes;
  }
}

/** „RIFF" … „WAVE" — die Signatur einer WAV-Datei. */
export function startsWithRiff(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const wave = String.fromCharCode(...bytes.subarray(8, 12));
  return riff === 'RIFF' && wave === 'WAVE';
}
