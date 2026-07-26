import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chunkText } from '@nlm/shared';
import { describe, expect, it } from 'vitest';

import {
  ExtractionError,
  extractDocx,
  extractHtml,
  extractPdf,
  extractPlainText,
} from '../src/lib/extract.js';

/**
 * Die Extraktoren werden gegen echte Dateien geprüft, nicht gegen Attrappen.
 * Ein PDF-Parser, der an einem konstruierten String funktioniert, sagt nichts
 * darüber, ob er ein echtes PDF liest.
 *
 * Die Fixtures liegen in tests/fixtures und werden von scripts/ erzeugt.
 */

function fixture(name: string): Uint8Array {
  const path = fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url));
  return new Uint8Array(readFileSync(path));
}

function fixtureText(name: string): string {
  const path = fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

describe('PDF', () => {
  it('liest Text aus einem echten PDF', async () => {
    const result = await extractPdf(fixture('zwei-seiten.pdf'));

    expect(result.markdown).toContain('Verordnung');
    expect(result.markdown).toContain('zweiten Blattes');
    expect(result.pageCount).toBe(2);
  });

  it('liefert Seitenumbrüche, die auf die richtige Seite zeigen', async () => {
    /*
     * Die Grundlage der PDF-Sprungmarke im Zitat. Zeigt ein Umbruch auf den
     * falschen Offset, landet der Nutzer auf der falschen Seite — und das ist
     * genau das, was die Anwendung verspricht.
     */
    const result = await extractPdf(fixture('zwei-seiten.pdf'));

    expect(result.pageBreaks.length).toBe(2);
    expect(result.pageBreaks[0]?.page).toBe(1);
    expect(result.pageBreaks[1]?.page).toBe(2);
    expect(result.pageBreaks[0]?.offset).toBe(0);
    expect(result.pageBreaks[1]?.offset).toBeGreaterThan(0);

    // Gegenprobe über die tatsächlichen Offsets: an der Position des zweiten
    // Umbruchs muss der Text der zweiten Seite beginnen.
    const secondOffset = result.pageBreaks[1]?.offset ?? 0;
    expect(result.markdown.slice(secondOffset)).toContain('Zweite Seite');
    expect(result.markdown.slice(0, secondOffset)).toContain('Erste Seite');
  });

  it('arbeitet mit dem Chunker zusammen, sodass Seitenzahlen stimmen', async () => {
    // Der Integrationstest, der zählt: Extraktion und Chunking müssen dieselben
    // Offsets verwenden.
    const result = await extractPdf(fixture('zwei-seiten.pdf'));
    const chunks = chunkText(result.markdown, {
      pageBreaks: result.pageBreaks,
      targetTokens: 40,
      overlapTokens: 0,
      minChars: 20,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      const expectedPage = chunk.content.includes('Zweite Seite') ? 2 : 1;
      if (chunk.content.includes('Erste Seite') || chunk.content.includes('Zweite Seite')) {
        expect(chunk.page).toBe(expectedPage);
      }
    }
  });

  it('meldet ein PDF ohne Textebene verständlich', async () => {
    /*
     * Der häufigste Fehlerfall in der Praxis: ein Scan ohne OCR. Eine leere
     * Quelle anzulegen wäre schlimmer als abzulehnen — der Nutzer würde erst im
     * Chat merken, dass nichts da ist, und nicht wissen warum.
     */
    await expect(extractPdf(fixture('ohne-textebene.pdf'))).rejects.toThrow(
      ExtractionError,
    );

    try {
      await extractPdf(fixture('ohne-textebene.pdf'));
      expect.unreachable('hätte werfen müssen');
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      const message = (error as ExtractionError).userMessage;
      expect(message).toContain('Scan');
      expect(message).toContain('OCR');
    }
  });
});

describe('DOCX', () => {
  it('übernimmt Überschriften als Markdown', async () => {
    // Ohne Überschriften könnte der Chunker keinen Pfad bauen, und das Zitat
    // wüsste nicht, aus welchem Kapitel es stammt.
    const result = await extractDocx(fixture('mit-ueberschriften.docx'));

    expect(result.markdown).toMatch(/^#\s+Erste Überschrift/m);
    expect(result.markdown).toMatch(/^##\s+Unterabschnitt/m);
    expect(result.markdown).toContain('Ein Absatz unter der ersten Überschrift');
  });

  it('erhält Umlaute', async () => {
    const result = await extractDocx(fixture('mit-ueberschriften.docx'));
    expect(result.markdown).toContain('Größe und Maß');
  });

  it('liefert Markdown, aus dem der Chunker Pfade baut', async () => {
    const result = await extractDocx(fixture('mit-ueberschriften.docx'));
    const chunks = chunkText(result.markdown, { minChars: 20 });

    const paths = chunks.map((chunk) => chunk.headingPath);
    expect(paths).toContain('Erste Überschrift');
    expect(paths.some((path) => path?.includes('Unterabschnitt'))).toBe(true);
  });
});

describe('HTML', () => {
  const html = fixtureText('artikel.html');

  it('extrahiert den Artikel und verwirft die Navigation', () => {
    /*
     * Der Grund für Readability: ohne diesen Schritt bestünde die halbe Quelle
     * aus Menüpunkten und Fußzeile — und die könnten als Zitat auftauchen.
     */
    const result = extractHtml(html, 'https://example.com/artikel');

    expect(result.markdown).toContain('Rechtsgrundlage');
    expect(result.markdown).toContain('Zweckbindung');

    expect(result.markdown).not.toContain('Impressum');
    expect(result.markdown).not.toContain('Alle Rechte vorbehalten');
  });

  it('entfernt Skripte und Stile vollständig', () => {
    const result = extractHtml(html, 'https://example.com/artikel');
    expect(result.markdown).not.toContain('window.tracking');
    expect(result.markdown).not.toContain('color: red');
  });

  it('übernimmt den Titel', () => {
    const result = extractHtml(html, 'https://example.com/artikel');
    expect(result.title).toBe('Datenschutz in der Praxis');
  });

  it('behält den Alternativtext von Bildern', () => {
    // Der Alternativtext trägt Information, die URL nicht.
    const result = extractHtml(html, 'https://example.com/artikel');
    expect(result.markdown).toContain('Schaubild der sechs Rechtsgrundlagen');
    expect(result.markdown).not.toContain('/bild.png');
  });

  it('wandelt Überschriften in ATX-Form um', () => {
    // Nur diese Form erkennt der Chunker.
    const result = extractHtml(html, 'https://example.com/artikel');
    expect(result.markdown).toMatch(/^##?\s+/m);
  });

  it('weist eine Seite ohne Inhalt verständlich ab', () => {
    expect(() => extractHtml('<html><body></body></html>', 'https://x.example')).toThrow(
      ExtractionError,
    );
  });

  it('liefert auch bei Übersichtsseiten Inhalt', () => {
    /*
     * Der Fallback-Zweig (Readability findet keinen Artikel → ganzer Body plus
     * Hinweis) ist hier absichtlich nicht abgedeckt: Readability liefert für
     * jede geprüfte Konstruktion Inhalt zurück — Linklisten, Tabellenlayouts,
     * sehr kurze Seiten. Der Zweig bleibt als Absicherung im Code, weil `parse()`
     * laut Dokumentation null zurückgeben kann, ließe sich aber nur durch einen
     * Mock erzwingen. Ein Test, der Readability wegmockt, würde nur die eigene
     * Verzweigung prüfen und nichts über das Verhalten aussagen.
     *
     * Was hier stattdessen sichergestellt wird: eine Seite ohne Artikelstruktur
     * führt nicht zum Abbruch.
     */
    const listing = `<html><body>${'<div><a href="/x">Ein Eintrag der Liste</a> mit etwas erläuterndem Text dahinter.</div>'.repeat(8)}</body></html>`;
    const result = extractHtml(listing, 'https://example.com/liste');
    expect(result.markdown.length).toBeGreaterThan(0);
  });
});

describe('Text und Markdown', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it('übernimmt Text unverändert bis auf Leerraum', () => {
    const result = extractPlainText(encode('Erste Zeile.\n\nZweiter Absatz.'));
    expect(result.markdown).toBe('Erste Zeile.\n\nZweiter Absatz.');
  });

  it('vereinheitlicht Windows-Zeilenenden', () => {
    /*
     * Wichtiger als es aussieht: der Chunker berechnet Offsets gegen den
     * gespeicherten Text. Bleiben \r\n stehen, zählt er gegen eine andere
     * Zeichenfolge als die, die der Viewer anzeigt, und jede Hervorhebung ist
     * um die Anzahl der Zeilen verschoben.
     */
    const result = extractPlainText(encode('Zeile eins.\r\nZeile zwei.\r\n\r\nAbsatz.'));
    expect(result.markdown).not.toContain('\r');
    expect(result.markdown).toBe('Zeile eins.\nZeile zwei.\n\nAbsatz.');
  });

  it('entfernt weiche Trennstriche', () => {
    // Kommen aus PDFs und zerstören die Volltextsuche: "Ver­trag" findet
    // niemand, der "Vertrag" sucht.
    const result = extractPlainText(encode('Ver­trag und Ver­ordnung'));
    expect(result.markdown).toBe('Vertrag und Verordnung');
  });

  it('entfernt Zero-Width-Zeichen', () => {
    const result = extractPlainText(encode('Da​ten‌schutz﻿'));
    expect(result.markdown).toBe('Datenschutz');
  });

  it('reduziert übermäßige Leerzeilen', () => {
    const result = extractPlainText(encode('Eins.\n\n\n\n\nZwei.'));
    expect(result.markdown).toBe('Eins.\n\nZwei.');
  });

  it('weist leeren Text ab', () => {
    expect(() => extractPlainText(encode('   \n\n  '))).toThrow(ExtractionError);
  });
});
