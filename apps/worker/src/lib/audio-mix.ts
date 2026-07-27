import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Fügt die einzelnen Redebeiträge zu einer MP3 zusammen.
 *
 * Drei Dinge passieren hier, und jedes davon aus einem hörbaren Grund:
 *
 * **Pausen zwischen den Beiträgen.** Ohne sie fallen sich die Sprecher ins
 * Wort — die Synthese schneidet am letzten Laut ab, und der nächste Beitrag
 * beginnt übergangslos. 350 Millisekunden reichen für einen Sprecherwechsel,
 * ohne dass es zäh wird.
 *
 * **Gleiche Abtastrate.** Piper liefert 22 050 Hz, Kokoro 24 000 Hz. Wer
 * beides ohne Umrechnung aneinanderhängt, bekommt entweder eine Datei mit
 * falscher Tonhöhe oder gar keine. Innerhalb eines Überblicks kommt zwar nur
 * ein Anbieter zum Zug, aber darauf zu bauen hiesse, den Fehler für später
 * aufzuheben.
 *
 * **Lautheitsnormalisierung.** Zwei Stimmen aus demselben Modell sind
 * unterschiedlich laut, und der Hörer regelt sonst bei jedem Wechsel nach.
 * `loudnorm` bringt beides auf -16 LUFS, den üblichen Wert für Sprache.
 */

/** Pause zwischen zwei Beiträgen. */
const GAP_SECONDS = 0.35;

export class AudioMixError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = 'AudioMixError';
  }
}

export type MixResult = {
  readonly mp3: Uint8Array;
  readonly durationSeconds: number;
  /** Startzeit jedes Beitrags in Sekunden — für das mitlaufende Transkript. */
  readonly offsets: number[];
};

/**
 * @param parts WAV-Daten je Redebeitrag, in Reihenfolge
 */
export async function mixDialogue(parts: readonly Uint8Array[]): Promise<MixResult> {
  if (parts.length === 0) {
    throw new AudioMixError('Keine Audiodaten', 'Es gab nichts zu vertonen.');
  }

  const dir = await mkdtemp(join(tmpdir(), 'nlm-audio-'));

  try {
    const files: string[] = [];
    for (const [index, part] of parts.entries()) {
      const file = join(dir, `${String(index).padStart(4, '0')}.wav`);
      await writeFile(file, part);
      files.push(file);
    }

    /*
     * Die Startzeiten werden aus den Einzeldateien berechnet, nicht aus dem
     * Ergebnis. ffprobe je Datei ist genauer als eine Hochrechnung aus der
     * Zeichenzahl — und das Transkript soll beim Abspielen an der richtigen
     * Stelle mitlaufen, nicht ungefähr.
     */
    const durations: number[] = [];
    for (const file of files) {
      durations.push(await probeDuration(file));
    }

    const offsets: number[] = [];
    let position = 0;
    for (const duration of durations) {
      offsets.push(Number(position.toFixed(3)));
      position += duration + GAP_SECONDS;
    }
    // Die letzte Pause hängt hinten dran und zählt nicht zur Spielzeit.
    const total = Math.max(0, position - GAP_SECONDS);

    const output = join(dir, 'ueberblick.mp3');
    await concat(files, output);

    const { readFile } = await import('node:fs/promises');
    const mp3 = new Uint8Array(await readFile(output));

    return { mp3, durationSeconds: Math.round(total), offsets };
  } finally {
    // Auch im Fehlerfall: sonst füllt jeder fehlgeschlagene Lauf das
    // temporäre Verzeichnis mit hunderten WAV-Dateien.
    await rm(dir, { recursive: true, force: true });
  }
}

async function probeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ]);
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? seconds : 0;
  } catch (error) {
    throw new AudioMixError(
      `ffprobe fehlgeschlagen: ${String(error)}`,
      'Die Audiodatei konnte nicht ausgewertet werden.',
    );
  }
}

/**
 * Setzt die Teile zusammen.
 *
 * Über den `concat`-Filter und nicht über die Demuxer-Variante mit Dateiliste:
 * der Filter kann in einem Durchgang auch die Abtastrate angleichen und die
 * Pausen einfügen. Die Demuxer-Variante verlangt identische Formate und böte
 * keine Stelle, an der sich Stille einschieben liesse.
 */
async function concat(files: readonly string[], output: string): Promise<void> {
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];

  for (const [index, file] of files.entries()) {
    inputs.push('-i', file);
    // Auf 24 kHz mono vereinheitlichen, bevor irgendetwas verbunden wird.
    filters.push(
      `[${String(index)}:a]aresample=24000,aformat=channel_layouts=mono[a${String(index)}]`,
    );
    labels.push(`[a${String(index)}]`);
  }

  /*
   * Die Pausen. Ein Filter-Ausgang lässt sich nur einmal verwenden, also wird
   * die Stille per `asplit` so oft vervielfacht, wie Lücken entstehen.
   *
   * Bei einem einzigen Beitrag gibt es keine Lücke — dann darf die Stille auch
   * nicht erzeugt werden. Ein unbenutzter Filter-Ausgang bringt ffmpeg zum
   * Abbruch, und dieser Sonderfall ist keine Theorie: ein Überblick kann aus
   * einem einzigen Beitrag bestehen, wenn die Quellen wenig hergeben.
   */
  const gapCount = Math.max(0, labels.length - 1);
  const gapLabels = Array.from({ length: gapCount }, (_, index) => `[g${String(index)}]`);

  if (gapCount === 1) {
    // asplit mit n=1 ist zwar gültig, aber unnötig — eine Stille, ein Verbrauch.
    filters.push(`anullsrc=r=24000:cl=mono:d=${String(GAP_SECONDS)}${gapLabels[0] ?? ''}`);
  } else if (gapCount > 1) {
    filters.push(
      `anullsrc=r=24000:cl=mono:d=${String(GAP_SECONDS)}[gapsrc]`,
      `[gapsrc]asplit=${String(gapCount)}${gapLabels.join('')}`,
    );
  }

  const sequence: string[] = [];
  for (const [index, label] of labels.entries()) {
    if (index > 0) sequence.push(gapLabels[index - 1] ?? '');
    sequence.push(label);
  }

  filters.push(
    `${sequence.join('')}concat=n=${String(sequence.length)}:v=0:a=1[joined]`,
    // -16 LUFS ist der übliche Zielwert für Sprache; darunter wird es im Auto
    // oder mit Kopfhörern in der Bahn unverständlich.
    `[joined]loudnorm=I=-16:TP=-1.5:LRA=11[out]`,
  );

  try {
    await run(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...inputs,
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[out]',
        // 96 kbit/s mono reichen für Sprache und halten die Datei klein — ein
        // Überblick von zwanzig Minuten bleibt damit unter 15 MB.
        '-c:a',
        'libmp3lame',
        '-b:a',
        '96k',
        '-ac',
        '1',
        '-y',
        output,
      ],
      // Ein langer Überblick mit achtzig Beiträgen braucht seine Zeit.
      { maxBuffer: 1024 * 1024 * 8, timeout: 600_000 },
    );
  } catch (error) {
    throw new AudioMixError(
      `ffmpeg fehlgeschlagen: ${String(error)}`,
      'Die Audiodatei konnte nicht zusammengesetzt werden.',
    );
  }
}
