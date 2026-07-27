import { describe, expect, it } from 'vitest';

import { distribute, sample } from '../src/handlers/generate-artifact.js';

/**
 * Die Abtastung entscheidet, was das Modell überhaupt zu sehen bekommt.
 *
 * Das ist die unauffälligste Stelle mit der grössten Wirkung: geht sie schief,
 * fehlt in der Zusammenfassung ein ganzes Dokument — und weder Job noch
 * Schema-Prüfung schlagen an, weil das Ergebnis formal einwandfrei ist. Der
 * Nutzer merkt es nur, wenn er die Quelle gut genug kennt.
 */

describe('Kontingente verteilen', () => {
  it('gibt jeder Quelle etwas, auch der kleinsten', () => {
    /*
     * Der Fall, um den es geht: „die ersten 120 Abschnitte" hätte hier nur die
     * grosse Quelle geliefert und zwei Dokumente stillschweigend ausgelassen.
     */
    const quotas = distribute(
      new Map([
        ['klein', 5],
        ['mittel', 10],
        ['gross', 200],
      ]),
      120,
    );

    expect(quotas.get('klein')).toBe(5);
    expect(quotas.get('mittel')).toBe(10);
    expect(quotas.get('gross')).toBe(105);
  });

  it('verteilt das Gesamtkontingent vollständig', () => {
    const quotas = distribute(
      new Map([
        ['a', 500],
        ['b', 500],
      ]),
      120,
    );

    const total = [...quotas.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(120);
  });

  it('nimmt nicht mehr, als vorhanden ist', () => {
    // Ein Notizbuch mit wenig Material soll kein Kontingent „aufbrauchen".
    const quotas = distribute(
      new Map([
        ['a', 3],
        ['b', 4],
      ]),
      120,
    );

    expect(quotas.get('a')).toBe(3);
    expect(quotas.get('b')).toBe(4);
  });

  it('kommt mit einer leeren Quelle zurecht', () => {
    const quotas = distribute(
      new Map([
        ['leer', 0],
        ['voll', 10],
      ]),
      120,
    );

    expect(quotas.get('leer')).toBe(0);
    expect(quotas.get('voll')).toBe(10);
  });

  it('bleibt stehen, wenn es nichts zu verteilen gibt', () => {
    // Ohne Abbruchbedingung liefe die Schleife hier endlos — ein Worker, der
    // sich an einem leeren Notizbuch aufhängt, wäre schwer zu finden.
    const quotas = distribute(new Map([['a', 0]]), 120);

    expect(quotas.get('a')).toBe(0);
  });

  it('verteilt auch bei sehr kleinem Gesamtkontingent', () => {
    const quotas = distribute(
      new Map([
        ['a', 100],
        ['b', 100],
        ['c', 100],
      ]),
      2,
    );

    const total = [...quotas.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(2);
  });
});

describe('Abschnitte abtasten', () => {
  it('nimmt alles, wenn das Kontingent reicht', () => {
    expect(sample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it('verteilt die Auswahl über die ganze Länge', () => {
    /*
     * Nicht die ersten n: bei einem Vertrag stehen die interessanten Klauseln
     * regelmässig hinten. Eine Zusammenfassung, die nur den Anfang kennt, wirkt
     * vollständig und ist es nicht.
     */
    const items = Array.from({ length: 100 }, (_, index) => index);
    const picked = sample(items, 5);

    expect(picked).toHaveLength(5);
    expect(picked[0]).toBe(0);
    expect(picked[picked.length - 1]).toBeGreaterThan(70);
  });

  it('liefert keine Dubletten', () => {
    const items = Array.from({ length: 7 }, (_, index) => index);
    const picked = sample(items, 5);

    expect(new Set(picked).size).toBe(picked.length);
  });

  it('gibt bei Kontingent null nichts zurück', () => {
    expect(sample([1, 2, 3], 0)).toEqual([]);
  });

  it('behält die Reihenfolge bei', () => {
    // Die Reihenfolge im Prompt entspricht der im Dokument; das Modell soll
    // Abläufe erkennen können.
    const items = Array.from({ length: 50 }, (_, index) => index);
    const picked = sample(items, 8);

    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
  });
});
