/**
 * Schutz gegen Server-Side Request Forgery beim URL-Import.
 *
 * Warum das die wichtigste Prüfung dieser Anwendung ist: die App ruft für den
 * Nutzer beliebige URLs ab und läuft auf einem Server, der Zugriff auf das
 * interne Netz und je nach Hosting auf einen Metadaten-Endpunkt hat. Ohne diese
 * Prüfung genügt `http://169.254.169.254/latest/meta-data/iam/…` als „Quelle",
 * um an Cloud-Zugangsdaten zu kommen.
 *
 * Entscheidend ist, dass die **aufgelöste IP** geprüft wird, nicht der
 * Hostname. Ein Angreifer kontrolliert seinen DNS-Eintrag und kann ihn auf
 * 127.0.0.1 zeigen lassen; eine Namens-Blockliste wäre wirkungslos. Die
 * Namensprüfung hier ist nur die erste Stufe — die zweite (Auflösung) sitzt im
 * Worker, wo DNS verfügbar ist.
 */

export type UrlRejectionReason =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'credentials_in_url'
  | 'loopback'
  | 'private_network'
  | 'link_local'
  | 'unique_local'
  | 'blocked_host'
  | 'non_standard_port';

export type UrlCheckResult =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: UrlRejectionReason; readonly detail: string };

/** Nur diese beiden Schemata. `file:`, `gopher:`, `ftp:` und `data:` sind Angriffswege. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Ports jenseits von HTTP(S) deuten auf interne Dienste (Datenbanken,
 * Admin-Oberflächen, Metriken). Nur die üblichen Web-Ports zulassen.
 */
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

/** Namen, die auf die eigene Maschine zeigen, ohne dass DNS befragt wird. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // Cloud-Metadaten-Endpunkte, auch unter ihren Namen.
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  // Docker-interne Namen: der Stack ist über diese erreichbar.
  'db',
  'auth',
  'rest',
  'storage',
  'gateway',
  'mailpit',
  'worker',
  'web',
  'host.docker.internal',
]);

/** Suffixe, die per Konvention nicht im öffentlichen Netz liegen (RFC 6762, RFC 2606). */
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
];

function parseIpv4(host: string): readonly number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * Erkennt IPv4-Adressen, die nicht im öffentlichen Netz erreichbar sein sollen.
 * Grundlage: RFC 1918 (privat), RFC 3927 (link-local), RFC 5737 (Doku),
 * RFC 6598 (Carrier-NAT).
 */
export function isBlockedIpv4(host: string): UrlRejectionReason | null {
  const octets = parseIpv4(host);
  if (!octets) return null;

  const [a, b] = octets as [number, number, number, number];

  if (a === 127 || a === 0) return 'loopback';
  // 169.254.0.0/16 — enthält 169.254.169.254, den Metadaten-Endpunkt.
  if (a === 169 && b === 254) return 'link_local';
  if (a === 10) return 'private_network';
  if (a === 172 && b >= 16 && b <= 31) return 'private_network';
  if (a === 192 && b === 168) return 'private_network';
  // Carrier-Grade NAT.
  if (a === 100 && b >= 64 && b <= 127) return 'private_network';
  // Reserviert und Multicast.
  if (a >= 224) return 'private_network';

  return null;
}

/**
 * Expandiert eine IPv6-Adresse zu acht 16-Bit-Gruppen.
 *
 * Nötig, weil dieselbe Adresse viele Schreibweisen hat und der URL-Parser sie
 * zusätzlich umschreibt: `::ffff:127.0.0.1` wird zu `::ffff:7f00:1`. Wer nur
 * auf Zeichenketten prüft, übersieht die Hälfte der Fälle.
 */
export function expandIpv6(host: string): readonly number[] | null {
  let text = host.replace(/^\[|\]$/g, '').toLowerCase();
  // Zone-Index (fe80::1%eth0) abschneiden.
  text = text.split('%')[0] ?? text;
  if (!text.includes(':')) return null;

  // Eine eingebettete Punkt-Schreibweise am Ende in zwei Gruppen umwandeln.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const bytes = dotted.slice(1, 5).map(Number);
    if (bytes.some((byte) => byte > 255)) return null;
    const [a, b, c, d] = bytes as [number, number, number, number];
    text =
      text.slice(0, dotted.index) +
      ((a << 8) | b).toString(16) +
      ':' +
      ((c << 8) | d).toString(16);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const piece of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };

  const head = parse(halves[0] ?? '');
  if (!head) return null;

  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }

  const tail = parse(halves[1] ?? '');
  if (!tail) return null;

  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array.from({ length: fill }, () => 0), ...tail];
}

/**
 * Präfixe, bei denen die letzten 32 Bit eine IPv4-Adresse sind. Nur bei diesen
 * wird der eingebettete v4-Teil geprüft — bei einer beliebigen IPv6-Adresse
 * wären die letzten 32 Bit gewöhnliche Adressbits, und eine Prüfung darauf
 * würde legitime Adressen zufällig sperren.
 */
function embeddedIpv4(groups: readonly number[]): string | null {
  const isZeroPrefix = groups.slice(0, 5).every((group) => group === 0);
  const g5 = groups[5] ?? 0;

  const isMapped = isZeroPrefix && g5 === 0xffff; // ::ffff:0:0/96
  const isCompatible = isZeroPrefix && g5 === 0; // ::/96, historisch
  const isNat64 = groups[0] === 0x64 && groups[1] === 0xff9b; // 64:ff9b::/96

  if (!isMapped && !isCompatible && !isNat64) return null;

  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** Dasselbe für IPv6, inklusive der IPv4-Einbettungen. */
export function isBlockedIpv6(host: string): UrlRejectionReason | null {
  const groups = expandIpv6(host);
  if (!groups) return null;

  const isAllZero = groups.every((group) => group === 0);
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  if (isAllZero || isLoopback) return 'loopback';

  const first = groups[0] ?? 0;
  // fc00::/7 — unique local.
  if ((first & 0xfe00) === 0xfc00) return 'unique_local';
  // fe80::/10 — link local.
  if ((first & 0xffc0) === 0xfe80) return 'link_local';

  const embedded = embeddedIpv4(groups);
  if (embedded) {
    const reason = isBlockedIpv4(embedded);
    if (reason) return reason;
  }

  // 6to4: 2002:<v4>::/16 — die eingebettete Adresse steckt in den Gruppen 1 und 2.
  if (first === 0x2002) {
    const high = groups[1] ?? 0;
    const low = groups[2] ?? 0;
    const reason = isBlockedIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
    if (reason) return reason;
  }

  return null;
}

/**
 * Erste Stufe: prüft alles, was ohne DNS entscheidbar ist.
 *
 * Bestandene Prüfung heißt **nicht**, dass die URL sicher ist — die
 * IP-Auflösung fehlt noch. Der Worker ruft danach `isBlockedAddress()` für
 * jede aufgelöste Adresse und für jede Weiterleitung auf.
 */
export function checkUrl(input: string): UrlCheckResult {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'invalid_url', detail: 'Das ist keine gültige Adresse.' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: 'unsupported_scheme',
      detail: `Nur http und https sind erlaubt, nicht ${url.protocol.replace(':', '')}.`,
    };
  }

  // Zugangsdaten in der URL sind ein Umgehungsversuch (http://x@interner-host/)
  // und werden von manchen Parsern anders gelesen als von anderen.
  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'credentials_in_url',
      detail: 'Adressen mit Benutzername oder Passwort sind nicht erlaubt.',
    };
  }

  // Der Host wird vor dem Port geprüft. Bei `http://db:5432/` treffen beide
  // Regeln; „diese Adresse ist nicht erreichbar" ist für den Nutzer aber
  // brauchbarer als „Port 5432 ist nicht erlaubt".
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return {
      ok: false,
      reason: 'blocked_host',
      detail: `${hostname} ist nicht erreichbar.`,
    };
  }

  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return {
      ok: false,
      reason: 'blocked_host',
      detail: 'Adressen aus dem lokalen Netz sind nicht erlaubt.',
    };
  }

  const ipReason = isBlockedIpv4(hostname) ?? isBlockedIpv6(url.hostname);
  if (ipReason) {
    return {
      ok: false,
      reason: ipReason,
      detail: 'Diese Adresse liegt im lokalen oder privaten Netz.',
    };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return {
      ok: false,
      reason: 'non_standard_port',
      detail: `Port ${url.port} ist nicht erlaubt.`,
    };
  }

  return { ok: true, url };
}

/**
 * Zweite Stufe: prüft eine konkrete, bereits aufgelöste IP-Adresse.
 *
 * Wird im Worker für jede von DNS zurückgegebene Adresse aufgerufen — und
 * erneut für jedes Ziel einer Weiterleitung. Nur die erste URL zu prüfen wäre
 * wirkungslos: ein 302 auf 127.0.0.1 ist der Standardtrick.
 */
export function isBlockedAddress(address: string): UrlRejectionReason | null {
  return isBlockedIpv4(address) ?? isBlockedIpv6(address);
}

/** Verständliche Meldung je Ablehnungsgrund, für die Anzeige an der Quelle. */
export const URL_REJECTION_MESSAGES: Record<UrlRejectionReason, string> = {
  invalid_url: 'Das ist keine gültige Web-Adresse.',
  unsupported_scheme: 'Es werden nur http- und https-Adressen unterstützt.',
  credentials_in_url: 'Adressen mit Benutzername oder Passwort werden nicht abgerufen.',
  loopback: 'Diese Adresse zeigt auf den Server selbst.',
  private_network: 'Diese Adresse liegt in einem privaten Netz.',
  link_local: 'Diese Adresse liegt im Link-Local-Bereich.',
  unique_local: 'Diese Adresse liegt in einem lokalen IPv6-Netz.',
  blocked_host: 'Diese Adresse ist nicht erreichbar.',
  non_standard_port: 'Dieser Port wird nicht abgerufen.',
};

export const MAX_REDIRECTS = 5;
