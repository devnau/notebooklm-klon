import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mixDialogue } from '../src/lib/audio-mix.js';

const run = promisify(execFile);

/**
 * Gegen echtes ffmpeg, nicht gegen eine Attrappe.
 *
 * Was hier schiefgehen kann, geht in der Filtersyntax schief — ein falsches
 * Label, eine Stille, die nur einmal verwendet werden darf, eine nicht
 * angeglichene Abtastrate. Ein Mock würde all das durchwinken und der Fehler
 * fiele erst auf, wenn jemand die fertige Datei anhört.
 */

let workdir = '';

/** Erzeugt einen Sinuston als WAV — Ersatz für einen synthetisierten Beitrag. */
async function tone(seconds: number, frequency: number, rate = 22050): Promise<Uint8Array> {
  const file = join(workdir, `ton-${String(frequency)}-${String(rate)}.wav`);
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${String(frequency)}:duration=${String(seconds)}:sample_rate=${String(rate)}`,
    '-ac',
    '1',
    '-y',
    file,
  ]);
  return new Uint8Array(await readFile(file));
}

async function duration(mp3: Uint8Array): Promise<number> {
  const file = join(workdir, 'pruefung.mp3');
  await writeFile(file, mp3);
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number.parseFloat(stdout.trim());
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'nlm-audio-test-'));
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe('Dialog zusammensetzen', () => {
  it('fügt zwei Beiträge mit Pause dazwischen zusammen', async () => {
    const result = await mixDialogue([await tone(1, 440), await tone(1, 660)]);

    expect(result.mp3.byteLength).toBeGreaterThan(1000);
    // Zwei Sekunden Ton plus 0,35 Sekunden Pause. MP3 rundet auf Rahmengrenzen,
    // deshalb mit Toleranz.
    const actual = await duration(result.mp3);
    expect(actual).toBeGreaterThan(2.2);
    expect(actual).toBeLessThan(2.6);
  });

  it('liefert Startzeiten, die zur Reihenfolge passen', async () => {
    // Sie steuern das mitlaufende Transkript. Stimmen sie nicht, springt die
    // Hervorhebung beim Hören an die falsche Stelle.
    const result = await mixDialogue([
      await tone(1, 440),
      await tone(2, 660),
      await tone(1, 880),
    ]);

    expect(result.offsets[0]).toBe(0);
    expect(result.offsets[1]).toBeCloseTo(1.35, 1);
    expect(result.offsets[2]).toBeCloseTo(3.7, 1);
  });

  it('rechnet die Spielzeit ohne Pause am Ende', async () => {
    const result = await mixDialogue([await tone(1, 440), await tone(1, 660)]);

    // 1 + 0,35 + 1 = 2,35, gerundet 2.
    expect(result.durationSeconds).toBe(2);
  });

  it('kommt mit einem einzigen Beitrag zurecht', async () => {
    // Der Sonderfall ohne jede Lücke: der asplit-Filter darf dann nicht
    // erzeugt werden, sonst bricht ffmpeg mit „Invalid argument" ab.
    const result = await mixDialogue([await tone(1, 440)]);

    expect(result.offsets).toEqual([0]);
    expect(await duration(result.mp3)).toBeGreaterThan(0.9);
  });

  it('gleicht unterschiedliche Abtastraten an', async () => {
    /*
     * Piper liefert 22 050 Hz, Kokoro 24 000 Hz. Ohne Angleichung bricht
     * ffmpeg entweder ab oder liefert eine Datei mit falscher Tonhöhe — und
     * Letzteres fiele erst beim Anhören auf.
     */
    const result = await mixDialogue([
      await tone(1, 440, 22050),
      await tone(1, 660, 24000),
    ]);

    const actual = await duration(result.mp3);
    expect(actual).toBeGreaterThan(2.2);
    expect(actual).toBeLessThan(2.6);
  });

  it('weist eine leere Liste ab', async () => {
    await expect(mixDialogue([])).rejects.toThrow(/Keine Audiodaten/);
  });

  it('setzt auch viele Beiträge zusammen', async () => {
    // Ein echter Überblick hat zwanzig bis dreissig Beiträge. Die Filterkette
    // wächst linear mit; ab einer gewissen Länge lehnt ffmpeg sie ab.
    const parts = await Promise.all(
      Array.from({ length: 24 }, (_, index) => tone(0.2, 400 + index * 10)),
    );
    const result = await mixDialogue(parts);

    expect(result.offsets).toHaveLength(24);
    expect(await duration(result.mp3)).toBeGreaterThan(12);
  }, 60_000);
});
