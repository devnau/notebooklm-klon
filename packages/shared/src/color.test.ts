import { describe, expect, it } from 'vitest';

import {
  CONTRAST_AA_LARGE_TEXT,
  CONTRAST_AA_NON_TEXT,
  CONTRAST_AA_TEXT,
  contrastRatio,
  type Oklch,
} from './color.js';

/**
 * Die Design-Tokens aus apps/web/src/app/globals.css, hier gespiegelt.
 *
 * Die Doppelpflege ist Absicht: CSS-Variablen lassen sich nicht ohne Browser
 * auswerten, und ein Test, der einen Browser braucht, läuft nicht bei jedem
 * Commit. Läuft ein Wert auseinander, fällt es beim nächsten axe-Durchlauf in
 * den E2E-Tests auf — die Absicherung ist also zweistufig, nicht doppelt.
 *
 * Dieser Test hat die erste Fassung der Palette widerlegt: muted-foreground
 * hatte 3,99:1 statt der geforderten 4,5:1.
 */
const light = {
  background: { l: 0.975, c: 0.004, h: 85 },
  surface: { l: 1, c: 0, h: 0 },
  surfaceSunken: { l: 0.94, c: 0.005, h: 85 },
  foreground: { l: 0.19, c: 0.007, h: 70 },
  mutedForeground: { l: 0.53, c: 0.009, h: 78 },
  muted: { l: 0.94, c: 0.005, h: 85 },
  input: { l: 0.66, c: 0.009, h: 79 },
  borderStrong: { l: 0.66, c: 0.009, h: 79 },
  ring: { l: 0.56, c: 0.11, h: 196 },
  primary: { l: 0.48, c: 0.1, h: 198 },
  primaryForeground: { l: 1, c: 0, h: 0 },
  primarySubtle: { l: 0.97, c: 0.02, h: 195 },
  destructive: { l: 0.58, c: 0.19, h: 25 },
  destructiveSubtle: { l: 0.94, c: 0.03, h: 25 },
  successSubtle: { l: 0.94, c: 0.04, h: 152 },
  success: { l: 0.6, c: 0.13, h: 152 },
  citation: { l: 0.48, c: 0.1, h: 198 },
  citationBg: { l: 0.97, c: 0.02, h: 195 },
} satisfies Record<string, Oklch>;

const dark = {
  background: { l: 0.14, c: 0.006, h: 68 },
  surface: { l: 0.19, c: 0.007, h: 70 },
  surfaceRaised: { l: 0.26, c: 0.008, h: 72 },
  foreground: { l: 0.975, c: 0.004, h: 85 },
  mutedForeground: { l: 0.66, c: 0.009, h: 79 },
  muted: { l: 0.26, c: 0.008, h: 72 },
  input: { l: 0.51, c: 0.009, h: 74 },
  borderStrong: { l: 0.38, c: 0.009, h: 74 },
  ring: { l: 0.66, c: 0.11, h: 195 },
  primary: { l: 0.66, c: 0.11, h: 195 },
  primaryForeground: { l: 0.14, c: 0.006, h: 68 },
  destructive: { l: 0.68, c: 0.17, h: 25 },
  destructiveSubtle: { l: 0.28, c: 0.07, h: 25 },
  successSubtle: { l: 0.28, c: 0.05, h: 152 },
  success: { l: 0.7, c: 0.13, h: 152 },
  citation: { l: 0.77, c: 0.09, h: 195 },
  citationBg: { l: 0.27, c: 0.045, h: 198 },
} satisfies Record<string, Oklch>;

function expectContrast(name: string, fg: Oklch, bg: Oklch, minimum: number): void {
  const ratio = contrastRatio(fg, bg);
  expect(
    ratio,
    `${name}: ${ratio.toFixed(2)}:1 (mindestens ${minimum}:1)`,
  ).toBeGreaterThanOrEqual(minimum);
}

describe('Kontrast im Light Mode', () => {
  it('Fließtext auf allen Flächen', () => {
    expectContrast(
      'foreground auf background',
      light.foreground,
      light.background,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'foreground auf surface',
      light.foreground,
      light.surface,
      CONTRAST_AA_TEXT,
    );
    expectContrast('foreground auf muted', light.foreground, light.muted, CONTRAST_AA_TEXT);
    expectContrast(
      'foreground auf surface-sunken',
      light.foreground,
      light.surfaceSunken,
      CONTRAST_AA_TEXT,
    );
  });

  it('sekundärer Text — der Fall, der beim ersten Entwurf durchfiel', () => {
    expectContrast(
      'muted-foreground auf background',
      light.mutedForeground,
      light.background,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'muted-foreground auf surface',
      light.mutedForeground,
      light.surface,
      CONTRAST_AA_TEXT,
    );
  });

  it('Schrift auf farbigen Flächen', () => {
    expectContrast(
      'primary-foreground auf primary',
      light.primaryForeground,
      light.primary,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'primary auf primary-subtle',
      light.primary,
      light.primarySubtle,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'destructive auf destructive-subtle',
      light.destructive,
      light.destructiveSubtle,
      CONTRAST_AA_LARGE_TEXT,
    );
    expectContrast(
      'success auf success-subtle',
      light.success,
      light.successSubtle,
      CONTRAST_AA_LARGE_TEXT,
    );
  });

  it('Zitatmarker — das zentrale Bedienelement der Anwendung', () => {
    expectContrast(
      'citation auf citation-bg',
      light.citation,
      light.citationBg,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'citation auf background',
      light.citation,
      light.background,
      CONTRAST_AA_TEXT,
    );
  });

  it('Ränder von Bedienelementen und Fokus-Ring (WCAG 1.4.11)', () => {
    // Der Rand eines Eingabefelds ist das einzige Merkmal, an dem das Feld
    // erkennbar ist — deshalb gilt hier 3:1 und nicht die Freiheit einer
    // dekorativen Linie.
    expectContrast(
      'input-Rand auf surface',
      light.input,
      light.surface,
      CONTRAST_AA_NON_TEXT,
    );
    expectContrast(
      'ring auf background',
      light.ring,
      light.background,
      CONTRAST_AA_NON_TEXT,
    );
    expectContrast('ring auf surface', light.ring, light.surface, CONTRAST_AA_NON_TEXT);
  });
});

describe('Kontrast im Dark Mode', () => {
  it('Fließtext auf allen Flächen', () => {
    expectContrast(
      'foreground auf background',
      dark.foreground,
      dark.background,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'foreground auf surface',
      dark.foreground,
      dark.surface,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'foreground auf surface-raised',
      dark.foreground,
      dark.surfaceRaised,
      CONTRAST_AA_TEXT,
    );
    expectContrast('foreground auf muted', dark.foreground, dark.muted, CONTRAST_AA_TEXT);
  });

  it('sekundärer Text', () => {
    expectContrast(
      'muted-foreground auf background',
      dark.mutedForeground,
      dark.background,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'muted-foreground auf surface',
      dark.mutedForeground,
      dark.surface,
      CONTRAST_AA_TEXT,
    );
  });

  it('Schrift auf farbigen Flächen', () => {
    expectContrast(
      'primary-foreground auf primary',
      dark.primaryForeground,
      dark.primary,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'destructive auf destructive-subtle',
      dark.destructive,
      dark.destructiveSubtle,
      CONTRAST_AA_LARGE_TEXT,
    );
    expectContrast(
      'success auf success-subtle',
      dark.success,
      dark.successSubtle,
      CONTRAST_AA_LARGE_TEXT,
    );
  });

  it('Zitatmarker', () => {
    expectContrast(
      'citation auf citation-bg',
      dark.citation,
      dark.citationBg,
      CONTRAST_AA_TEXT,
    );
    expectContrast(
      'citation auf background',
      dark.citation,
      dark.background,
      CONTRAST_AA_TEXT,
    );
  });

  it('Ränder von Bedienelementen und Fokus-Ring', () => {
    expectContrast(
      'input-Rand auf surface',
      dark.input,
      dark.surface,
      CONTRAST_AA_NON_TEXT,
    );
    expectContrast('ring auf background', dark.ring, dark.background, CONTRAST_AA_NON_TEXT);
    expectContrast('ring auf surface', dark.ring, dark.surface, CONTRAST_AA_NON_TEXT);
  });
});

describe('Farbumrechnung', () => {
  it('Schwarz auf Weiß ergibt 21:1', () => {
    const ratio = contrastRatio({ l: 0, c: 0, h: 0 }, { l: 1, c: 0, h: 0 });
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('gleiche Farbe ergibt 1:1', () => {
    const color = { l: 0.5, c: 0.1, h: 200 };
    expect(contrastRatio(color, color)).toBeCloseTo(1, 5);
  });

  it('ist symmetrisch — die Reihenfolge darf nichts ändern', () => {
    const a = { l: 0.2, c: 0.05, h: 40 };
    const b = { l: 0.9, c: 0.02, h: 200 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});
