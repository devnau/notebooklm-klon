import { describe, expect, it } from 'vitest';

import { MAX_UPLOAD_BYTES } from './limits.js';
import { checkCompressionRatio, checkUpload } from './upload-guard.js';

/** Baut Testdaten aus einer Signatur und beliebigem Rest. */
function bytes(...values: (number | string)[]): Uint8Array {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === 'number') out.push(value);
    else for (const code of new TextEncoder().encode(value)) out.push(code);
  }
  return new Uint8Array(out);
}

function check(
  data: Uint8Array,
  name = 'datei.bin',
  mime?: string,
  totalBytes = data.length,
) {
  return checkUpload({
    data,
    declaredName: name,
    ...(mime === undefined ? {} : { declaredMime: mime }),
    totalBytes,
  });
}

const PDF = bytes('%PDF-1.7\n%âãÏÓ\nirgendein Inhalt');
const DOCX = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 'word/document.xml');

describe('Erkennung über den Inhalt', () => {
  it('erkennt PDF an der Signatur', () => {
    const result = check(PDF, 'bericht.pdf', 'application/pdf');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe('pdf');
  });

  it('erkennt DOCX an der ZIP-Signatur', () => {
    const result = check(
      DOCX,
      'brief.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe('docx');
  });

  it('erkennt Textdateien', () => {
    const result = check(bytes('Nur ganz normaler Text.\nZweite Zeile.'), 'notiz.txt');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe('txt');
  });

  it('unterscheidet Markdown über die Endung', () => {
    const result = check(bytes('# Überschrift\n\nText.'), 'notiz.md');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe('md');
  });

  it('akzeptiert Umlaute und Emoji als gültiges UTF-8', () => {
    const result = check(bytes('Größenänderung für Übungszwecke 📓'), 'text.txt');
    expect(result.ok).toBe(true);
  });
});

describe('Der Content-Type des Clients wird nicht geglaubt', () => {
  it('weist eine als PDF deklarierte Textdatei ab', () => {
    // Der Kern der Prüfung: die Angabe des Clients ist frei wählbar.
    const result = check(bytes('Das ist kein PDF.'), 'tarnung.pdf', 'application/pdf');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('content_mismatch');
  });

  it('lässt Textinhalt mit abweichendem text/-Untertyp durch', () => {
    /*
     * Auf dem Untertyp zu bestehen würde echte Uploads abweisen: Browser melden
     * für .md je nach Plattform text/markdown, text/plain oder nichts. Geprüft
     * wird deshalb nur die Hauptkategorie.
     */
    expect(check(bytes('# Titel'), 'doku.md', 'text/plain').ok).toBe(true);
    expect(check(bytes('# Titel'), 'doku.md', 'text/markdown').ok).toBe(true);
    expect(check(bytes('Text'), 'notiz.txt', undefined).ok).toBe(true);
  });

  it('weist ein als Text deklariertes PDF ab', () => {
    const result = check(PDF, 'tarnung.txt', 'text/plain');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('content_mismatch');
  });

  it('weist eine als DOCX deklarierte PDF-Datei ab', () => {
    const result = check(
      PDF,
      'tarnung.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('content_mismatch');
  });
});

describe('Ausführbares Markup', () => {
  it('weist SVG ab, egal wie es deklariert ist', () => {
    // Ein SVG ist ausführbares Markup. Als Nutzerinhalt ausgeliefert ist es ein
    // XSS-Vektor — deshalb kein SVG, auch nicht als „Bildquelle".
    for (const name of ['bild.svg', 'bild.txt', 'bild.pdf']) {
      const result = check(
        bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        name,
      );
      expect(result.ok, `${name} hätte abgelehnt werden müssen`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('executable_markup');
    }
  });

  it('weist HTML ab', () => {
    const cases = [
      '<!DOCTYPE html><html><body>Hallo</body></html>',
      '<html><head></head></html>',
      '<script>fetch("/api/x")</script>',
      '<iframe src="https://fremde-seite.example"></iframe>',
      '<img src=x onerror="alert(1)">',
      '<object data="x.swf"></object>',
    ];
    for (const content of cases) {
      const result = check(bytes(content), 'inhalt.txt');
      expect(result.ok, `abgelehnt werden müsste: ${content.slice(0, 30)}`).toBe(false);
    }
  });

  it('lässt Text durch, der spitze Klammern nur erwähnt', () => {
    // Gegenprobe: die Prüfung darf normalen Text nicht verhindern, nur weil
    // darin über HTML geschrieben wird.
    const result = check(
      bytes('In HTML schreibt man Absätze mit dem p-Element. Winkel: a < b > c.'),
      'notiz.md',
    );
    expect(result.ok).toBe(true);
  });

  it('lässt Markdown mit Code-Beispielen durch', () => {
    const result = check(
      bytes('# Beispiel\n\n```\nfunction f() { return 1 < 2; }\n```\n'),
      'doku.md',
    );
    expect(result.ok).toBe(true);
  });
});

describe('Größe und Leere', () => {
  it('weist leere Dateien ab', () => {
    const result = check(new Uint8Array(0), 'leer.txt', 'text/plain', 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('weist zu große Dateien ab, bevor sie gelesen werden', () => {
    // Entscheidend ist totalBytes, nicht die Länge der Stichprobe: die Grenze
    // muss greifen, ohne die Datei vollständig einzulesen.
    const result = check(PDF, 'gross.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_large');
  });

  it('lässt eine Datei genau an der Grenze durch', () => {
    const result = check(PDF, 'grenze.pdf', 'application/pdf', MAX_UPLOAD_BYTES);
    expect(result.ok).toBe(true);
  });
});

describe('Unbekannte Binärformate', () => {
  it('weist Ausführbares und Bilder ab', () => {
    const cases: readonly [string, Uint8Array][] = [
      ['ELF-Binary', bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01)],
      ['Windows-EXE', bytes(0x4d, 0x5a, 0x90, 0x00)],
      ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
      ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0)],
      ['GZIP', bytes(0x1f, 0x8b, 0x08)],
      ['Mach-O', bytes(0xcf, 0xfa, 0xed, 0xfe)],
    ];
    for (const [label, data] of cases) {
      const result = check(data, 'datei.bin');
      expect(result.ok, `${label} hätte abgelehnt werden müssen`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unsupported_type');
    }
  });

  it('weist Dateien mit Nullbytes ab, auch wenn der Anfang Text ist', () => {
    // Ein Nullbyte bedeutet Binärinhalt; als Text behandelt wäre er
    // unvorhersehbar.
    const result = check(bytes('Sieht aus wie Text', 0x00, 0x01, 0x02), 'tarnung.txt');
    expect(result.ok).toBe(false);
  });

  it('weist ungültiges UTF-8 ab', () => {
    const result = check(bytes(0xc3, 0x28, 0xa0, 0xa1), 'kaputt.txt');
    expect(result.ok).toBe(false);
  });
});

describe('Zip-Bombe', () => {
  it('weist ein extremes Entpackungsverhältnis ab', () => {
    // 50 KB, die zu 5 GB entpacken: 100.000-fach. Der Worker würde daran
    // ersticken.
    const result = checkCompressionRatio(50_000, 5_000_000_000);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.reason).toBe('suspicious_archive');
  });

  it('lässt normale Office-Dokumente durch', () => {
    // Ein DOCX komprimiert typischerweise um Faktor 3 bis 10.
    expect(checkCompressionRatio(40_000, 180_000)).toBeNull();
    expect(checkCompressionRatio(1_000_000, 8_000_000)).toBeNull();
  });

  it('geht mit unbekannter Größe um, ohne zu scheitern', () => {
    expect(checkCompressionRatio(0, 1_000_000)).toBeNull();
  });
});
