import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { SANITIZE_SCHEMA } from './markdown-schema.js';

/**
 * Die Sanitisierung ist eine Sicherheitsgrenze, kein Formatierungsdetail.
 *
 * In einem geteilten Notizbuch schreibt ein Nutzer, und andere lesen. Ein
 * eingeschleustes Skript träfe also nicht den Verfasser, sondern seine
 * Kollegen. Deshalb wird hier die *tatsächliche* Pipeline gefahren — dieselben
 * Plugins in derselben Reihenfolge wie in der Komponente — und nicht nur das
 * Schemaobjekt begutachtet.
 */

/*
 * `processSync`, nicht `process`. Der erste Entwurf verwendete die
 * asynchrone Variante ohne await — `String(promise)` ergibt
 * '[object Promise]', und jede Negativprüfung war damit grün, ohne irgendetwas
 * zu prüfen. Aufgefallen ist es nur an den Positivprüfungen weiter unten.
 * Genau dafür sind sie da.
 */
function render(markdown: string): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      /*
       * `allowDangerousHtml`, damit rohes HTML überhaupt bis zum Sanitizer
       * durchkommt. Ohne das würde remark es vorher verwerfen und der Test
       * prüfte nichts — er wäre grün, egal wie das Schema aussieht.
       *
       * Der Test ist damit strenger als der Betrieb: react-markdown lässt rohes
       * HTML ohnehin nicht durch. Der Sanitizer ist die zweite Linie, und
       * geprüft wird sie hier für sich.
       */
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeSanitize, SANITIZE_SCHEMA)
      .use(rehypeStringify)
      .processSync(markdown),
  );
}

describe('Skripte und Ereignisbehandler', () => {
  it('entfernt ein script-Element', () => {
    /*
     * Der Sanitizer entfernt das Element und lässt seinen Inhalt als Text
     * stehen — `alert(1)` erscheint also weiterhin im Dokument, nur eben als
     * Zeichenkette in einem Absatz. Das ist richtig so: entschärfen heisst,
     * dass nichts ausgeführt wird, nicht dass Text verschwindet.
     *
     * Die erste Fassung dieses Tests verlangte, dass die Zeichenkette gar nicht
     * vorkommt. Das hätte eine Anforderung festgeschrieben, die es nicht gibt
     * — und wäre bei jedem Dokument rot geworden, in dem jemand über
     * JavaScript schreibt.
     */
    const html = render('Text <script>alert(1)</script> mehr Text');

    expect(html).not.toContain('<script');
    expect(html).toContain('Text');
    expect(html).toContain('mehr Text');
  });

  it('entfernt onerror an einem Bild', () => {
    const html = render('<img src=x onerror="alert(1)">');

    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert');
  });

  it('entfernt onclick an einem beliebigen Element', () => {
    const html = render('<span onclick="alert(1)">Klick mich</span>');

    expect(html).not.toContain('onclick');
    // Der Text bleibt: entschärfen heisst nicht löschen.
    expect(html).toContain('Klick mich');
  });

  it('entfernt einen iframe', () => {
    const html = render('<iframe src="https://beispiel.test"></iframe>');

    expect(html).not.toContain('<iframe');
  });
});

describe('Adressen', () => {
  it('entfernt einen javascript:-Link', () => {
    const html = render('[Harmlos](javascript:alert(1))');

    expect(html).not.toContain('javascript:');
    // Der Linktext bleibt sichtbar, nur das Ziel ist weg.
    expect(html).toContain('Harmlos');
  });

  it('entfernt einen data:-Link', () => {
    const html = render(
      '[Datei](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    );

    expect(html).not.toContain('data:text/html');
  });

  it('lässt http, https und mailto durch', () => {
    const html = render(
      '[Web](https://beispiel.test) [Unsicher](http://beispiel.test) [Mail](mailto:a@b.test)',
    );

    expect(html).toContain('https://beispiel.test');
    expect(html).toContain('http://beispiel.test');
    expect(html).toContain('mailto:a@b.test');
  });

  it('lässt vbscript nicht durch', () => {
    const html = render('[Alt](vbscript:msgbox(1))');

    expect(html).not.toContain('vbscript:');
  });
});

describe('Externe Inhalte', () => {
  it('rendert kein Bild, auch nicht aus Markdown-Syntax', () => {
    /*
     * Ein Bild würde eine fremde Adresse laden, sobald jemand die Notiz öffnet
     * — und damit dessen IP-Adresse an einen Server melden, den der Verfasser
     * kontrolliert. In einer Anwendung für vertrauliche Dokumente ist das kein
     * guter Tausch.
     */
    const html = render('![Diagramm](https://tracker.test/pixel.png)');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('tracker.test');
  });

  it('rendert kein video- und kein audio-Element', () => {
    const html = render('<video src="https://tracker.test/v.mp4"></video>');

    expect(html).not.toContain('<video');
    expect(html).not.toContain('tracker.test');
  });
});

describe('Was erhalten bleiben muss', () => {
  it('rendert Überschriften, Listen und Betonung', () => {
    // Gegenprobe: ein Sanitizer, der alles entfernt, wäre trivial sicher und
    // unbrauchbar. Diese Prüfungen halten fest, dass Markdown noch funktioniert.
    const html = render('# Titel\n\n- eins\n- zwei\n\n**fett** und *kursiv*');

    expect(html).toContain('<h1>Titel</h1>');
    expect(html).toContain('<li>eins</li>');
    expect(html).toContain('<strong>fett</strong>');
    expect(html).toContain('<em>kursiv</em>');
  });

  it('rendert Tabellen aus GitHub-Markdown', () => {
    const html = render('| A | B |\n| --- | --- |\n| 1 | 2 |');

    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('rendert Code ohne ihn auszuführen', () => {
    const html = render('```\n<script>alert(1)</script>\n```');

    expect(html).toContain('<pre>');
    // Der Code ist als Text sichtbar, aber maskiert.
    expect(html).toContain('&#x3C;script>');
    expect(html).not.toContain('<script>alert');
  });

  it('behält Umlaute und Sonderzeichen', () => {
    const html = render('Löschfristen für Bewerber & Beschäftigte');

    expect(html).toContain('Löschfristen für Bewerber');
    expect(html).toContain('&#x26;');
  });
});
