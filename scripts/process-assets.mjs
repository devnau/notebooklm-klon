#!/usr/bin/env node
/**
 * Erzeugt aus den generierten Vorlagen in `assets/quellen/` die Dateien, die
 * die Anwendung ausliefert.
 *
 * Warum als Skript und nicht von Hand: die Ableitungen sind reproduzierbar.
 * Kommt eine neue Fassung eines Assets, wird die Vorlage ersetzt und das
 * Skript erneut ausgeführt — statt fünf Zuschnitte in einem Bildprogramm
 * nachzustellen und sich zu fragen, welche Grösse damals warum gewählt wurde.
 *
 * Die erzeugten Dateien liegen im Repo (nicht in .gitignore): der Build soll
 * ohne Bildverarbeitung auskommen, und ein Deployment darf nicht davon
 * abhängen, dass sharp auf dem Server läuft.
 *
 * Aufruf:  node scripts/process-assets.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = new URL('..', import.meta.url);
const src = (name) => fileURLToPath(new URL(`assets/quellen/${name}`, root));
const out = (name) => fileURLToPath(new URL(`apps/web/${name}`, root));

async function ensureDirs() {
  for (const dir of [
    'public/brand',
    'public/backgrounds',
    'public/illustrations',
    'src/app',
  ]) {
    await mkdir(fileURLToPath(new URL(`apps/web/${dir}`, root)), { recursive: true });
  }
}

const done = [];
function report(file, detail) {
  done.push(`  ✓ ${file} — ${detail}`);
}

/**
 * App-Icons.
 *
 * Quelle ist das Zeichen auf Petrol, quadratisch. Next.js erkennt
 * `src/app/icon.png` und `src/app/apple-icon.png` selbst und schreibt die
 * passenden `<link>`-Elemente — deshalb liegen sie dort und nicht in `public/`.
 */
async function icons() {
  const master = sharp(src('icon-app.png')).resize(512, 512, { fit: 'cover' });

  await master.clone().png({ compressionLevel: 9 }).toFile(out('src/app/icon.png'));
  report('src/app/icon.png', '512×512');

  await master
    .clone()
    .resize(180, 180)
    .png({ compressionLevel: 9 })
    .toFile(out('src/app/apple-icon.png'));
  report('src/app/apple-icon.png', '180×180');

  /*
   * Maskable-Variante für Android: das Betriebssystem beschneidet das Icon auf
   * eine beliebige Form und darf dabei bis zu 20 Prozent am Rand verlieren.
   * Die Vorlage bringt genug Luft mit, deshalb reicht Skalieren; wäre das
   * Zeichen randnah, müsste hier zusätzlich Rand ergänzt werden.
   */
  await master
    .clone()
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toFile(out('public/brand/icon-maskable-512.png'));
  report('public/brand/icon-maskable-512.png', '512×512, maskable');

  await writeIco(
    await master.clone().resize(48, 48).png({ compressionLevel: 9 }).toBuffer(),
    48,
    out('public/favicon.ico'),
  );
  report('public/favicon.ico', '48×48, PNG in ICO-Hülle');
}

/**
 * Schreibt eine ICO-Datei mit eingebettetem PNG.
 *
 * Seit Vista dürfen ICO-Dateien PNG-Daten direkt enthalten, statt sie als BMP
 * abzulegen — der Header ist dann nur eine 22 Byte lange Hülle. Das erspart
 * eine weitere Abhängigkeit für eine Datei, die sich in einer halben Seite
 * Code schreiben lässt.
 *
 * Warum überhaupt noch `.ico`: Next liefert die Icons oben unter eigenen
 * Adressen aus, aber Suchmaschinen, Feed-Reader und Chat-Vorschauen fragen
 * unverdrossen `/favicon.ico` ab. Ohne die Datei steht dort eine 404 im
 * Protokoll und im Tab manchmal nichts.
 */
async function writeIco(pngBuffer, size, target) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserviert
  header.writeUInt16LE(1, 2); // Typ 1 = Icon
  header.writeUInt16LE(1, 4); // ein Bild

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // Breite (0 bedeutet 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1); // Höhe
  entry.writeUInt8(0, 2); // Farbpalette: keine
  entry.writeUInt8(0, 3); // reserviert
  entry.writeUInt16LE(1, 4); // Farbebenen
  entry.writeUInt16LE(32, 6); // Bits pro Pixel
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12); // Offset der Bilddaten

  await writeFile(target, Buffer.concat([header, entry, pngBuffer]));
}

/**
 * Hintergrund der Anmeldeseite.
 *
 * Die Vorlage ist 1672 × 941, gefordert waren 2000 × 1200. Statt sie
 * hochzurechnen wird auf das Zielverhältnis zugeschnitten und in der
 * natürlichen Auflösung belassen — das Bild liegt hinter einem Formular und
 * wird ohnehin skaliert; ein künstlich vergrössertes wäre nur grösser, nicht
 * schärfer.
 *
 * AVIF und WebP, kein PNG: das Motiv ist grossflächig und weich, dafür sind
 * beide um ein Vielfaches kleiner. `<picture>` in der Anmeldeseite wählt aus.
 */
async function authBackground() {
  const base = sharp(src('auth-hintergrund.png')).resize(1672, 1003, {
    fit: 'cover',
    position: 'right',
  });

  await base.clone().avif({ quality: 55 }).toFile(out('public/backgrounds/auth.avif'));
  report('public/backgrounds/auth.avif', '1672×1003');

  await base.clone().webp({ quality: 78 }).toFile(out('public/backgrounds/auth.webp'));
  report('public/backgrounds/auth.webp', '1672×1003');
}

/**
 * Wortmarke als Rasterbild.
 *
 * Im Kopfbereich wird sie **nicht** verwendet — dort steht ein Inline-SVG, das
 * bei jeder Grösse scharf bleibt und die Themenfarbe erbt. Diese Dateien sind
 * für Stellen, an denen kein SVG geht: Social-Vorschau, README, E-Mail.
 *
 * Die Vorlage hat einen papierweissen Hintergrund statt Transparenz. Ihn
 * herauszurechnen wäre bei der leichten Textur der Vorlage ein Ratespiel mit
 * ausgefransten Kanten; er bleibt deshalb stehen. Für die genannten Zwecke ist
 * das richtig — dort liegt ohnehin eine helle Fläche darunter.
 */
async function wordmark() {
  await sharp(src('wortmarke-hell.png'))
    .resize({ width: 1200 })
    .png({ compressionLevel: 9 })
    .toFile(out('public/brand/wortmarke-hell.png'));
  report('public/brand/wortmarke-hell.png', '1200 breit');

  await sharp(src('icon-hell.png'))
    .resize(512, 512, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(out('public/brand/icon-hell.png'));
  report('public/brand/icon-hell.png', '512×512');
}

await ensureDirs();
await icons();
await authBackground();
await wordmark();

console.log('Assets erzeugt:');
for (const entry of done) console.log(entry);
console.log(
  '\nNicht verarbeitet: assets/quellen/empty-notebooks-entwurf.png\n' +
    '  Grauer Vollflächenhintergrund und Leuchteffekt statt flacher Formen auf\n' +
    '  transparentem Grund. Siehe assets/PROMPTS.md, Abschnitt „Nachzuliefern".',
);
