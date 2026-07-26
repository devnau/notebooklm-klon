import { lookup } from 'node:dns/promises';

import {
  checkUrl,
  isBlockedAddress,
  MAX_REDIRECTS,
  URL_REJECTION_MESSAGES,
  type UrlRejectionReason,
} from '@nlm/shared';

/**
 * HTTP-Abruf mit SSRF-Schutz.
 *
 * Hier sitzt die zweite und eigentlich wirksame Stufe: `checkUrl()` entscheidet
 * ohne DNS, diese Funktion löst auf und prüft **jede** IP-Adresse, auf die der
 * Name zeigt — und danach jede Weiterleitung einzeln.
 *
 * Warum das so gebaut ist:
 *
 *  * Eine Namens-Blockliste ist wirkungslos. Ein Angreifer besitzt seine Domain
 *    und kann einen A-Record auf 127.0.0.1 setzen; der Name sieht unauffällig aus.
 *  * `redirect: 'manual'` statt `'follow'` ist zwingend. Mit `'follow'` würde
 *    fetch einer 302-Antwort auf 127.0.0.1 folgen, bevor irgendetwas geprüft
 *    werden kann — der Standardtrick, um eine Eingangsprüfung zu umgehen.
 *  * Jeder Sprung wird vollständig neu geprüft, nicht nur der Hostname.
 *
 * Ein Restrisiko bleibt: zwischen Prüfung und Verbindungsaufbau kann sich der
 * DNS-Eintrag ändern (DNS Rebinding). Dagegen hilft nur, die Verbindung an die
 * geprüfte IP zu binden. Das ist mit `fetch` nicht möglich und wäre der nächste
 * Schritt, falls die Anwendung in eine Umgebung mit erreichbarem
 * Metadaten-Endpunkt geht — auf einem eigenen Server ohne solchen Endpunkt ist
 * das Verhältnis von Aufwand zu Gewinn ungünstig.
 */

export class FetchRejectedError extends Error {
  constructor(
    readonly reason:
      | UrlRejectionReason
      | 'too_many_redirects'
      | 'http_error'
      | 'too_large'
      | 'wrong_content_type',
    readonly userMessage: string,
    technical: string,
  ) {
    super(technical);
    this.name = 'FetchRejectedError';
  }
}

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB HTML sind mehr als genug.

const USER_AGENT =
  'NotebookStudioBot/0.1 (+selbst gehostet; ruft Seiten im Auftrag des Nutzers ab)';

/** Löst den Namen auf und prüft jede zurückgegebene Adresse. */
async function assertResolvesToPublicAddress(hostname: string): Promise<void> {
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new FetchRejectedError(
      'blocked_host',
      'Diese Adresse ließ sich nicht auflösen.',
      `DNS-Auflösung für ${hostname} fehlgeschlagen`,
    );
  }

  if (addresses.length === 0) {
    throw new FetchRejectedError(
      'blocked_host',
      'Diese Adresse ließ sich nicht auflösen.',
      `keine Adressen für ${hostname}`,
    );
  }

  for (const { address } of addresses) {
    const reason = isBlockedAddress(address);
    if (reason) {
      // Die Adresse steht bewusst nicht in der Meldung an den Nutzer: sie wäre
      // eine Auskunft über die interne Netzstruktur.
      throw new FetchRejectedError(
        reason,
        URL_REJECTION_MESSAGES[reason],
        `${hostname} löst auf ${address} auf (${reason})`,
      );
    }
  }
}

export type FetchedPage = {
  readonly html: string;
  readonly finalUrl: string;
  readonly contentType: string;
};

/**
 * Ruft eine Seite ab und gibt ihr HTML zurück.
 *
 * Folgt Weiterleitungen selbst, damit jeder Sprung geprüft werden kann.
 */
export async function fetchPageSafely(rawUrl: string): Promise<FetchedPage> {
  const initial = checkUrl(rawUrl);
  if (!initial.ok) {
    throw new FetchRejectedError(initial.reason, initial.detail, `abgelehnt: ${rawUrl}`);
  }

  let current = initial.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertResolvesToPublicAddress(current.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(current, {
        // Nicht 'follow': sonst würde fetch einer Weiterleitung auf eine
        // interne Adresse folgen, bevor wir sie sehen.
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'Accept-Language': 'de,en;q=0.8',
        },
      });
    } catch (error) {
      throw new FetchRejectedError(
        'http_error',
        'Die Seite war nicht erreichbar.',
        `fetch fehlgeschlagen für ${current.href}: ${String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    // Weiterleitung: Ziel auflösen und von vorn prüfen.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new FetchRejectedError(
          'http_error',
          'Die Seite antwortete mit einer unvollständigen Weiterleitung.',
          `${response.status} ohne Location für ${current.href}`,
        );
      }

      // Relative Ziele gegen die aktuelle URL auflösen.
      const next = new URL(location, current);
      const check = checkUrl(next.href);
      if (!check.ok) {
        throw new FetchRejectedError(
          check.reason,
          `Die Seite leitet auf eine Adresse weiter, die nicht abgerufen wird: ${check.detail}`,
          `Weiterleitung abgelehnt: ${current.href} → ${next.href} (${check.reason})`,
        );
      }
      current = check.url;
      continue;
    }

    if (!response.ok) {
      throw new FetchRejectedError(
        'http_error',
        `Die Seite antwortete mit dem Status ${response.status}.`,
        `HTTP ${response.status} für ${current.href}`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml|text\/plain|text\/markdown/i.test(contentType)) {
      throw new FetchRejectedError(
        'wrong_content_type',
        'Unter dieser Adresse liegt keine Webseite. Dateien bitte direkt hochladen.',
        `unerwarteter Content-Type ${contentType} für ${current.href}`,
      );
    }

    // Größe begrenzen. Content-Length kann fehlen oder lügen, deshalb zusätzlich
    // beim Lesen mitzählen.
    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new FetchRejectedError(
        'too_large',
        'Die Seite ist zu groß, um sie zu verarbeiten.',
        `Content-Length ${declaredLength} über der Grenze`,
      );
    }

    const html = await readWithLimit(response, MAX_RESPONSE_BYTES);

    return { html, finalUrl: current.href, contentType };
  }

  throw new FetchRejectedError(
    'too_many_redirects',
    'Die Seite leitet zu oft weiter.',
    `mehr als ${MAX_REDIRECTS} Weiterleitungen ab ${rawUrl}`,
  );
}

/**
 * Liest den Körper und bricht ab, sobald die Grenze überschritten wird.
 * Ein fehlendes oder falsches Content-Length darf nicht dazu führen, dass
 * beliebig viel in den Speicher läuft.
 */
async function readWithLimit(response: Response, limit: number): Promise<string> {
  // Explizit typisiert: response.body ist im Node-Typen-Satz nur lose belegt,
  // und ohne diese Angabe wandert `any` durch die ganze Schleife.
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined =
    response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new FetchRejectedError(
        'too_large',
        'Die Seite ist zu groß, um sie zu verarbeiten.',
        `Antwort über ${limit} Bytes`,
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}
