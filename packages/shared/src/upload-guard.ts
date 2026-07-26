import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from './limits.js';
import type { SourceKind } from './domain.js';

/**
 * Prüfung hochgeladener Dateien.
 *
 * Der Kern: dem `Content-Type` aus dem Request wird **nicht** geglaubt. Er ist
 * eine Angabe des Clients und beliebig setzbar. Entschieden wird über die ersten
 * Bytes des Inhalts.
 *
 * Warum das mehr als Formalismus ist: eine als `text/plain` deklarierte
 * HTML-Datei mit Skript, ein als PDF deklariertes SVG — beides würde eine reine
 * MIME-Prüfung passieren und später als Nutzerinhalt ausgeliefert werden.
 */

export type UploadRejectionReason =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'content_mismatch'
  | 'executable_markup'
  | 'suspicious_archive';

export type UploadCheckResult =
  | { readonly ok: true; readonly kind: SourceKind; readonly detectedMime: string }
  | { readonly ok: false; readonly reason: UploadRejectionReason; readonly detail: string };

/** Signatur am Dateianfang, die den Typ tatsächlich belegt. */
type Signature = {
  readonly kind: SourceKind;
  readonly mime: string;
  readonly bytes: readonly number[];
  readonly offset?: number;
};

const SIGNATURES: readonly Signature[] = [
  // "%PDF-"
  { kind: 'pdf', mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // "PK\x03\x04" — ZIP, und damit auch DOCX. Welches von beiden, entscheidet
  // die Inhaltsprüfung weiter unten.
  {
    kind: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: [0x50, 0x4b, 0x03, 0x04],
  },
];

/** Markup, das im Browser ausgeführt würde. Als Nutzerinhalt inakzeptabel. */
const EXECUTABLE_MARKUP_PATTERNS: readonly RegExp[] = [
  /<\s*svg[\s>]/i,
  /<\s*script[\s>]/i,
  /<\s*iframe[\s>]/i,
  /<\s*embed[\s>]/i,
  /<\s*object[\s>]/i,
  /<!doctype\s+html/i,
  /<\s*html[\s>]/i,
  /on(?:error|load|click)\s*=/i,
];

function startsWith(data: Uint8Array, signature: Signature): boolean {
  const offset = signature.offset ?? 0;
  if (data.length < offset + signature.bytes.length) return false;
  return signature.bytes.every((byte, index) => data[offset + index] === byte);
}

/**
 * In Text erlaubte Steuerzeichen: Tab, Zeilenvorschub, Wagenrücklauf,
 * Seitenvorschub. Alles andere unter 0x20 deutet auf Binärinhalt.
 */
const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0c, 0x0d]);

/**
 * Erkennt Textdateien: gültiges UTF-8 ohne unerlaubte Steuerzeichen.
 *
 * Die Prüfung auf Steuerzeichen ist nicht optional — eine ELF-Binärdatei
 * beginnt mit 0x7f 'E' 'L' 'F' und ist als Bytefolge gültiges UTF-8. Ohne diese
 * Prüfung würde sie als Textdatei akzeptiert und der Extraktor bekäme Binärmüll.
 */
function looksLikeText(data: Uint8Array): boolean {
  const sample = data.subarray(0, 4096);

  for (const byte of sample) {
    if (byte === 0x7f) return false; // DEL
    if (byte < 0x20 && !ALLOWED_CONTROL_BYTES.has(byte)) return false;
  }

  try {
    // `fatal` lässt ungültiges UTF-8 einen Fehler werfen statt es durch
    // Ersatzzeichen zu verdecken.
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function decodeSample(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data.subarray(0, 8192));
}

/**
 * Prüft eine hochgeladene Datei.
 *
 * @param data       die ersten Bytes genügen — 8 KB reichen für alle Signaturen
 * @param declaredName Dateiname, nur für die Unterscheidung txt/md verwendet
 * @param declaredMime Angabe des Clients; wird geprüft, nicht geglaubt
 * @param totalBytes Gesamtgröße der Datei
 */
export function checkUpload({
  data,
  declaredName,
  declaredMime,
  totalBytes,
}: {
  readonly data: Uint8Array;
  readonly declaredName: string;
  readonly declaredMime?: string | undefined;
  readonly totalBytes: number;
}): UploadCheckResult {
  if (totalBytes === 0 || data.length === 0) {
    return { ok: false, reason: 'empty', detail: 'Die Datei ist leer.' };
  }

  if (totalBytes > MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(MAX_UPLOAD_BYTES / 1_000_000);
    return {
      ok: false,
      reason: 'too_large',
      detail: `Die Datei ist größer als ${limitMb} MB.`,
    };
  }

  const matched = SIGNATURES.find((signature) => startsWith(data, signature));

  if (matched) {
    // Deklarierter Typ und Inhalt müssen zusammenpassen. Weichen sie ab, ist
    // mindestens eine Angabe falsch — Grund genug abzulehnen.
    if (
      declaredMime &&
      declaredMime !== matched.mime &&
      declaredMime !== 'application/zip'
    ) {
      return {
        ok: false,
        reason: 'content_mismatch',
        detail: `Der Inhalt ist ${matched.mime}, angegeben war ${declaredMime}.`,
      };
    }
    return { ok: true, kind: matched.kind, detectedMime: matched.mime };
  }

  if (looksLikeText(data)) {
    const sample = decodeSample(data);

    // Als Text deklariertes, aber ausführbares Markup: der klassische
    // XSS-Vektor über einen Dokumentenupload.
    const pattern = EXECUTABLE_MARKUP_PATTERNS.find((regex) => regex.test(sample));
    if (pattern) {
      return {
        ok: false,
        reason: 'executable_markup',
        detail:
          'Die Datei enthält HTML oder SVG. Solche Inhalte werden nicht als Quelle angenommen — bitte als reinen Text oder als PDF hochladen.',
      };
    }

    /*
     * Auch hier muss die Angabe zum Inhalt passen — aber nur auf der Ebene der
     * Hauptkategorie. Browser melden für `.md` je nach Plattform `text/markdown`,
     * `text/plain` oder gar nichts; auf den Untertyp zu bestehen würde legitime
     * Uploads abweisen. Ein als `application/pdf` deklarierter Text ist dagegen
     * eine echte Abweichung: der Nutzer erwartet dann Seitenzahlen in den
     * Zitaten und bekäme sie nicht.
     */
    if (declaredMime && !declaredMime.startsWith('text/') && declaredMime !== '') {
      return {
        ok: false,
        reason: 'content_mismatch',
        detail: `Der Inhalt ist reiner Text, angegeben war ${declaredMime}.`,
      };
    }

    const isMarkdown = /\.(md|markdown|mdown)$/i.test(declaredName);
    return {
      ok: true,
      kind: isMarkdown ? 'md' : 'txt',
      detectedMime: isMarkdown ? 'text/markdown' : 'text/plain',
    };
  }

  return {
    ok: false,
    reason: 'unsupported_type',
    detail:
      'Dieser Dateityp wird nicht unterstützt. Möglich sind PDF, DOCX, Markdown und Textdateien.',
  };
}

/**
 * Erkennt Zip-Bomben in DOCX-Dateien.
 *
 * Ein DOCX ist ein ZIP-Archiv. Ein Archiv von 50 KB kann mehrere Gigabyte
 * entpacken und damit den Worker zum Absturz bringen — der klassische
 * Dekompressionsangriff. Geprüft wird das Verhältnis, nicht die absolute Größe:
 * legitime Office-Dokumente liegen deutlich unter Faktor 100.
 */
export const MAX_COMPRESSION_RATIO = 100;

export function checkCompressionRatio(
  compressedBytes: number,
  uncompressedBytes: number,
): UploadCheckResult | null {
  if (compressedBytes <= 0) return null;

  const ratio = uncompressedBytes / compressedBytes;
  if (ratio > MAX_COMPRESSION_RATIO) {
    return {
      ok: false,
      reason: 'suspicious_archive',
      detail: `Das Archiv entpackt sich um den Faktor ${Math.round(ratio)} — das wird nicht verarbeitet.`,
    };
  }
  return null;
}

/** Für die UI: welche Typen die Dateiauswahl anbieten soll. */
export const UPLOAD_ACCEPT_ATTRIBUTE = [
  ...ALLOWED_UPLOAD_MIME_TYPES,
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
].join(',');
