/**
 * Farbumrechnung und Kontrastberechnung.
 *
 * Liegt hier und nicht in der Web-App, weil die Design-Tokens damit in einem
 * Test geprüft werden: „Kontrast ist ausreichend" soll eine überprüfbare
 * Aussage sein und keine Behauptung in der Dokumentation. Genau dieser Test
 * hat aufgedeckt, dass die erste Fassung der Palette 3,99:1 statt 4,5:1 hatte.
 */

export type Oklch = { readonly l: number; readonly c: number; readonly h: number };

/** oklch → linear sRGB. Formeln nach der CSS Color 4 Spezifikation. */
export function oklchToLinearSrgb(color: Oklch): [number, number, number] {
  const hRad = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(hRad);
  const b = color.c * Math.sin(hRad);

  // Oklab → LMS
  const l_ = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = color.l - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * Relative Luminanz nach WCAG 2. Erwartet lineare sRGB-Werte, deshalb kein
 * erneutes Entfernen der Gammakorrektur.
 */
export function relativeLuminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearSrgb(color);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

/** Kontrastverhältnis zweier Farben, 1:1 bis 21:1. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG-2-AA-Schwellen. */
export const CONTRAST_AA_TEXT = 4.5;
export const CONTRAST_AA_LARGE_TEXT = 3;
/** Für Ränder, Icons und Bedienelemente (WCAG 2.1, 1.4.11). */
export const CONTRAST_AA_NON_TEXT = 3;
