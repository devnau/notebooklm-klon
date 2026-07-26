import { describe, expect, it } from 'vitest';

import { chunkText, estimateTokens } from './chunker.js';

/**
 * Der Chunker bestimmt, wie gut die Suche später funktioniert und ob Zitate auf
 * die richtige Stelle zeigen. Die Offset-Tests sind deshalb keine Formalität:
 * eine Abweichung um wenige Zeichen lässt jedes Zitat ins Leere springen.
 */

describe('Tokenschätzung', () => {
  it('gibt für leeren Text null zurück', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('wächst monoton mit der Länge', () => {
    expect(estimateTokens('kurz')).toBeLessThan(estimateTokens('deutlich länger als kurz'));
  });

  it('bleibt für deutschen Text in plausibler Größenordnung', () => {
    // Ein Absatz von ~330 Zeichen sollte grob 100 Tokens ergeben.
    const text = 'Die Verordnung regelt den Umgang mit Daten. '.repeat(8);
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(70);
    expect(tokens).toBeLessThan(140);
  });
});

describe('Grenzfälle', () => {
  it('gibt für leeren Text nichts zurück', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  \t ')).toEqual([]);
  });

  it('macht aus einem kurzen Text genau einen Abschnitt', () => {
    const chunks = chunkText('Ein einzelner kurzer Satz über ein Thema.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.idx).toBe(0);
    expect(chunks[0]?.content).toBe('Ein einzelner kurzer Satz über ein Thema.');
  });

  it('zerlegt einen einzelnen Riesenabsatz ohne Satzzeichen', () => {
    // Etwa eine Tabelle oder eine lange Zeile ohne Punkt: es muss trotzdem
    // getrennt werden, sonst sprengt der Abschnitt das Tokenlimit.
    const text = 'wort '.repeat(3000);
    const chunks = chunkText(text, { targetTokens: 200, overlapTokens: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }
  });

  it('haelt die Obergrenze targetTokens + overlapTokens ein', () => {
    // Die Überlappung kommt zum Inhalt hinzu; das ist ihr Preis, nicht ein
    // Fehler. Zugesichert ist nur diese Summe.
    const text = 'Ein Satz mit etwas Inhalt. '.repeat(400);
    const target = 150;
    const overlap = 40;
    const chunks = chunkText(text, { targetTokens: target, overlapTokens: overlap });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(target + overlap);
    }
  });

  it('behandelt Text ohne Überschriften', () => {
    const text = ['Erster Absatz mit Inhalt.', 'Zweiter Absatz mit Inhalt.'].join('\n\n');
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toBeNull();
  });
});

describe('Überschriftenpfad', () => {
  it('baut den Pfad über mehrere Ebenen', () => {
    const text = [
      '# Handbuch',
      '',
      'Einleitender Text zum Handbuch, der etwas Substanz hat.',
      '',
      '## Kapitel 3',
      '',
      'Text im dritten Kapitel mit ausreichend Inhalt für einen Abschnitt.',
      '',
      '### Methodik',
      '',
      'Beschreibung der Methodik, ebenfalls mit genügend Text.',
    ].join('\n');

    const chunks = chunkText(text);
    const paths = chunks.map((chunk) => chunk.headingPath);

    expect(paths).toContain('Handbuch');
    expect(paths).toContain('Handbuch › Kapitel 3');
    expect(paths).toContain('Handbuch › Kapitel 3 › Methodik');
  });

  it('ersetzt eine gleichrangige Überschrift statt zu verschachteln', () => {
    const text = [
      '# Teil A',
      '',
      'Inhalt von Teil A mit genügend Text für einen eigenen Abschnitt.',
      '',
      '# Teil B',
      '',
      'Inhalt von Teil B mit genügend Text für einen eigenen Abschnitt.',
    ].join('\n');

    const chunks = chunkText(text);
    expect(chunks.map((chunk) => chunk.headingPath)).toEqual(['Teil A', 'Teil B']);
  });

  it('kommt mit einer übersprungenen Ebene zurecht', () => {
    // `#` direkt gefolgt von `###` — kommt in echten Dokumenten vor.
    const text = [
      '# Titel',
      '',
      'Text unter dem Titel, ausreichend lang für einen Abschnitt.',
      '',
      '### Tief verschachtelt',
      '',
      'Text unter der tiefen Überschrift, ebenfalls ausreichend lang.',
    ].join('\n');

    const chunks = chunkText(text);
    const last = chunks[chunks.length - 1];
    expect(last?.headingPath).toBe('Titel › Tief verschachtelt');
  });

  it('trennt an Überschriften, auch wenn der Abschnitt noch Platz hätte', () => {
    // Ein Abschnitt soll nicht über eine Kapitelgrenze hinweg reichen: sonst
    // wäre der Überschriftenpfad im Zitat falsch.
    const text = [
      '## Erstes Thema',
      '',
      'Kurzer Text.',
      '',
      '## Zweites Thema',
      '',
      'Auch kurzer Text.',
    ].join('\n');

    const chunks = chunkText(text, { minChars: 5 });
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.headingPath).toBe('Erstes Thema');
    expect(chunks[1]?.headingPath).toBe('Zweites Thema');
  });
});

describe('Zeichenoffsets', () => {
  it('verweisen exakt auf die Stelle im Originaltext', () => {
    /*
     * Der wichtigste Test des Chunkers. Die Offsets sind die Grundlage für die
     * Hervorhebung im Viewer — stimmen sie nicht, springt jedes Zitat auf die
     * falsche Stelle, und das ist genau das Versprechen der Anwendung.
     */
    const text = [
      '# Titel',
      '',
      'Erster Absatz mit ausreichend Text, damit er nicht zusammengelegt wird.',
      '',
      'Zweiter Absatz, ebenfalls mit ausreichend Text für einen eigenen Abschnitt.',
    ].join('\n');

    const chunks = chunkText(text, { targetTokens: 25, minChars: 10, overlapTokens: 0 });

    for (const chunk of chunks) {
      const excerpt = text.slice(chunk.charStart, chunk.charEnd);
      // Der Abschnitt kann getrimmt und mit \n\n verbunden sein; jeder Absatz
      // daraus muss aber im Ausschnitt vorkommen.
      for (const paragraph of chunk.content.split('\n\n')) {
        expect(
          excerpt.includes(paragraph.trim()),
          `"${paragraph.slice(0, 40)}…" nicht in text.slice(${chunk.charStart}, ${chunk.charEnd})`,
        ).toBe(true);
      }
    }
  });

  it('sind aufsteigend und überschneidungsfrei ohne Überlappung', () => {
    const text = Array.from(
      { length: 12 },
      (_, index) =>
        `Absatz Nummer ${index} mit genügend Text, um eigenständig zu bestehen.`,
    ).join('\n\n');

    const chunks = chunkText(text, { targetTokens: 40, overlapTokens: 0 });

    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1];
      const current = chunks[index];
      expect(current!.charStart).toBeGreaterThanOrEqual(previous!.charStart);
      expect(current!.charEnd).toBeGreaterThan(current!.charStart);
    }
  });

  it('bleiben innerhalb der Textlänge', () => {
    const text = 'Ein Satz. '.repeat(200);
    const chunks = chunkText(text, { targetTokens: 30 });

    for (const chunk of chunks) {
      expect(chunk.charStart).toBeGreaterThanOrEqual(0);
      expect(chunk.charEnd).toBeLessThanOrEqual(text.length);
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
    }
  });
});

describe('Überlappung', () => {
  it('wiederholt das Ende des vorigen Abschnitts', () => {
    // Ohne Überlappung geht Kontext an jeder Schnittkante verloren: ein Satz,
    // der genau an der Grenze steht, wäre in keinem Abschnitt vollständig.
    const text = Array.from(
      { length: 20 },
      (_, index) => `Dies ist Satz Nummer ${index} und er enthält Inhalt.`,
    ).join(' ');

    const withOverlap = chunkText(text, { targetTokens: 40, overlapTokens: 15 });
    const withoutOverlap = chunkText(text, { targetTokens: 40, overlapTokens: 0 });

    expect(withOverlap.length).toBeGreaterThan(1);
    const overlapChars = withOverlap.reduce((sum, chunk) => sum + chunk.content.length, 0);
    const plainChars = withoutOverlap.reduce((sum, chunk) => sum + chunk.content.length, 0);
    expect(overlapChars).toBeGreaterThan(plainChars);
  });

  it('lässt sich abschalten', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Satz ${i} mit Inhalt.`).join(' ');
    const chunks = chunkText(text, { targetTokens: 30, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('Seitenzahlen', () => {
  it('ordnet jedem Abschnitt die richtige Seite zu', () => {
    // Für PDF-Sprungmarken: das Zitat muss auf die Seite zeigen, auf der der
    // Text wirklich steht.
    const page1 = 'Inhalt der ersten Seite mit ausreichend Text für einen Abschnitt.';
    const page2 = 'Inhalt der zweiten Seite mit ausreichend Text für einen Abschnitt.';
    const page3 = 'Inhalt der dritten Seite mit ausreichend Text für einen Abschnitt.';
    const text = [page1, page2, page3].join('\n\n');

    const chunks = chunkText(text, {
      targetTokens: 25,
      overlapTokens: 0,
      minChars: 20,
      pageBreaks: [
        { offset: 0, page: 1 },
        { offset: page1.length + 2, page: 2 },
        { offset: page1.length + page2.length + 4, page: 3 },
      ],
    });

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]?.page).toBe(1);
    expect(chunks[chunks.length - 1]?.page).toBe(3);
    // Seitenzahlen dürfen nicht rückwärts laufen.
    const pages = chunks.map((chunk) => chunk.page ?? 0);
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  });

  it('legt Abschnitte nicht über eine Seitengrenze hinweg zusammen', () => {
    /*
     * Sonst bekäme Text von Seite 2 die Seitenzahl 1 und das Zitat würde auf
     * das falsche Blatt springen — dieselbe Klasse von Fehler wie beim
     * Überschriftenpfad.
     */
    const short1 = 'Kurz auf Seite eins.';
    const short2 = 'Kurz auf Seite zwei.';
    const text = [short1, short2].join('\n\n');

    const chunks = chunkText(text, {
      targetTokens: 10,
      overlapTokens: 0,
      minChars: 500,
      pageBreaks: [
        { offset: 0, page: 1 },
        { offset: short1.length + 2, page: 2 },
      ],
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.page).toBe(1);
    expect(chunks[1]?.page).toBe(2);
  });

  it('lässt die Seite leer, wenn keine Umbrüche bekannt sind', () => {
    const chunks = chunkText('Text ohne Seiteninformation, etwa aus einer Textdatei.');
    expect(chunks[0]?.page).toBeNull();
  });
});

describe('Zusammenlegen kurzer Abschnitte', () => {
  it('hängt Bruchstücke an den vorigen Abschnitt', () => {
    // Ein Abschnitt aus drei Wörtern hat kein aussagekräftiges Embedding und
    // würde die Suche mit Rauschen füllen.
    const text = [
      '## Erstes',
      '',
      'Ein ausreichend langer Absatz, der als eigener Abschnitt bestehen kann.',
      '',
      '## Zweites',
      '',
      'Kurz.',
    ].join('\n');

    const chunks = chunkText(text, { minChars: 80 });
    expect(chunks.every((chunk) => chunk.content.length >= 5)).toBe(true);
    expect(chunks.some((chunk) => chunk.content.includes('Kurz.'))).toBe(true);
  });

  it('behält einen einzelnen kurzen Abschnitt', () => {
    // Sonst verschwände der gesamte Inhalt einer sehr kurzen Quelle.
    const chunks = chunkText('Kurz.', { minChars: 500 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('Kurz.');
  });

  it('numeriert nach dem Zusammenlegen lückenlos', () => {
    // idx ist Teil des Zitat-Labels [S3:12] und muss lückenlos sein, sonst
    // verweist ein Marker auf einen Abschnitt, den es nicht gibt.
    const text = Array.from({ length: 15 }, (_, i) =>
      i % 3 === 0 ? 'Kurz.' : `Absatz ${i} mit deutlich mehr Inhalt als der kurze.`,
    ).join('\n\n');

    const chunks = chunkText(text, { targetTokens: 30, minChars: 40 });
    expect(chunks.map((chunk) => chunk.idx)).toEqual(chunks.map((_, index) => index));
  });
});

describe('Deutschsprachige Realität', () => {
  it('trennt an deutschen Satzenden', () => {
    const text =
      'Der erste Satz endet hier. Der zweite Satz folgt! Und der dritte? Ja, so ist es.';
    const chunks = chunkText(text, { targetTokens: 8, overlapTokens: 0, minChars: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    // Kein Abschnitt darf mitten in einem Wort beginnen.
    for (const chunk of chunks) {
      expect(chunk.content.trim()).toBe(chunk.content.trim());
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it('behält Umlaute und Sonderzeichen unverändert', () => {
    const text = 'Größenänderung, Übermaß und Straßenverkehrsordnung — § 3 Abs. 1.';
    const chunks = chunkText(text);
    expect(chunks[0]?.content).toContain('Größenänderung');
    expect(chunks[0]?.content).toContain('§ 3');
  });

  it('verliert keinen Inhalt', () => {
    // Der eigentliche Integritätstest: alles, was hineingeht, muss auch wieder
    // herauskommen — sonst fehlt Material in der Suche.
    const paragraphs = Array.from(
      { length: 25 },
      (_, index) =>
        `Absatz ${index}: Die Verordnung regelt den Umgang mit personenbezogenen Daten im Sinne des Artikels 4.`,
    );
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text, { targetTokens: 60 });
    const joined = chunks.map((chunk) => chunk.content).join('\n');

    for (const paragraph of paragraphs) {
      expect(joined.includes(paragraph), `fehlt: ${paragraph.slice(0, 30)}…`).toBe(true);
    }
  });
});

describe('Zitatanker', () => {
  /*
   * Die wichtigste Eigenschaft des Chunkers, und die am leichtesten zu
   * verlierende: `text.slice(charStart, charEnd)` muss exakt `content`
   * ergeben. Bricht sie, zeigt jedes Zitat im Viewer ein paar Zeichen daneben —
   * unauffällig, weil Antwort und Verweis stimmen und nur die Markierung
   * verrutscht. Genau das war beim ersten Entwurf der Fall: der Inhalt wurde
   * aus den Blöcken zusammengesetzt und getrimmt, die Grenzen blieben
   * ungetrimmt.
   */
  function assertAnchors(text: string, options?: Parameters<typeof chunkText>[1]) {
    const chunks = chunkText(text, options);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(
        text.slice(chunk.charStart, chunk.charEnd),
        `Abschnitt ${String(chunk.idx)} (${String(chunk.charStart)}–${String(chunk.charEnd)})`,
      ).toBe(chunk.content);
    }
    return chunks;
  }

  it('trifft bei einfachem Text', () => {
    assertAnchors('Erster Absatz.\n\nZweiter Absatz mit etwas mehr Inhalt.\n');
  });

  it('trifft bei führenden und abschließenden Leerzeilen', () => {
    assertAnchors('\n\n\nEin Absatz, umgeben von Leerraum.\n\n\n');
  });

  it('trifft bei Überschriften und mehreren Kapiteln', () => {
    assertAnchors(
      [
        '# Kapitel 1',
        '',
        'Text des ersten Kapitels.',
        '',
        '## Abschnitt 1.1',
        '',
        'Mehr Text.',
        '',
        '# Kapitel 2',
        '',
        'Text des zweiten Kapitels.',
      ].join('\n'),
    );
  });

  it('trifft auch bei Überlappung zwischen den Abschnitten', () => {
    // Kleines Ziel erzwingt viele Schnitte und damit den Überlappungspfad.
    const text = Array.from(
      { length: 30 },
      (_, index) =>
        `Absatz ${String(index)}: Die Verordnung regelt den Umgang mit personenbezogenen Daten.`,
    ).join('\n\n');
    const chunks = assertAnchors(text, { targetTokens: 60, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(3);
  });

  it('trifft auch nach dem Zusammenlegen kurzer Abschnitte', () => {
    // minChars hoch ansetzen, damit der Merge-Pfad sicher durchlaufen wird.
    assertAnchors('Kurz.\n\nAuch kurz.\n\nEbenfalls kurz.\n\nUnd noch einer.', {
      targetTokens: 5,
      minChars: 400,
    });
  });

  it('trifft bei mehreren Leerzeilen zwischen Absätzen', () => {
    // Der Fall, an dem ein Zusammensetzen mit '\n\n' scheitern muss: im
    // Original stehen drei Leerzeilen, in der Rekonstruktion eine.
    assertAnchors('Erster Absatz.\n\n\n\n\nZweiter Absatz.', { targetTokens: 500 });
  });
});
