'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/**
 * Hell, dunkel, Systemeinstellung — ohne Fremdbibliothek.
 *
 * **Warum nicht `next-themes`.** Die Bibliothek rendert ihr Anti-Flacker-Skript
 * als `<script>`-Element *innerhalb einer Client-Komponente*. React 19
 * beanstandet das zu Recht mit „Encountered a script tag while rendering React
 * component. Scripts inside React components are never executed when rendering
 * on the client" — und im Entwicklungsbetrieb erscheint die Meldung als Fehler
 * im Overlay. Von hier aus beheben lässt sie sich nicht; es ist deren Code.
 *
 * Gebraucht wurden davon ohnehin nur `theme` und `setTheme`. Das sind die
 * fünfzig Zeilen hier — und dafür liegt das Skript nun dort, wo es hingehört:
 * im Wurzel-Layout, serverseitig gerendert (`ThemeScript` unten). Dort gibt es
 * keine Beanstandung, und der CSP-Nonce lässt sich direkt setzen.
 */

export type Theme = 'light' | 'dark' | 'system';

/** Muss mit dem Skript unten übereinstimmen. */
const SPEICHER_SCHLUESSEL = 'nlm-theme';

type ThemeValue = {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  /*
   * Startwert `system`, nicht der gespeicherte: der Server kennt die
   * Einstellung nicht, und ein anderer Wert hier ergäbe eine
   * Hydration-Abweichung. Der Effekt unten holt ihn nach — die *Darstellung*
   * ist davon nicht betroffen, weil das Skript im Layout die Klasse bereits vor
   * dem ersten Zeichnen gesetzt hat.
   */
  const [theme, setThemeState] = useState<Theme>('system');

  useEffect(() => {
    const gespeichert = leseGespeichert();
    if (gespeichert) setThemeState(gespeichert);
  }, []);

  /*
   * Auf Systemwechsel reagieren, solange „system" gewählt ist. Wer sein
   * Betriebssystem abends umstellt, erwartet, dass die Seite mitgeht, ohne sie
   * neu zu laden.
   */
  useEffect(() => {
    if (theme !== 'system') return;
    const abfrage = window.matchMedia('(prefers-color-scheme: dark)');
    const anwenden = () => {
      wendeAn('system');
    };
    abfrage.addEventListener('change', anwenden);
    return () => {
      abfrage.removeEventListener('change', anwenden);
    };
  }, [theme]);

  const setTheme = useCallback((naechstes: Theme) => {
    setThemeState(naechstes);
    wendeAn(naechstes);
    try {
      window.localStorage.setItem(SPEICHER_SCHLUESSEL, naechstes);
    } catch {
      // Privater Modus: dann gilt die Wahl eben nur für diese Sitzung.
    }
  }, []);

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme benötigt einen ThemeProvider.');
  return value;
}

function leseGespeichert(): Theme | null {
  try {
    const wert = window.localStorage.getItem(SPEICHER_SCHLUESSEL);
    return wert === 'light' || wert === 'dark' || wert === 'system' ? wert : null;
  } catch {
    return null;
  }
}

function wendeAn(theme: Theme): void {
  const dunkel =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dunkel);
}

/**
 * Das Skript, das das Aufblitzen verhindert.
 *
 * Es muss **vor** dem ersten Zeichnen laufen, also synchron im Dokumentkopf und
 * nicht in einem Effekt. Andernfalls sieht der Nutzer bei dunkler Einstellung
 * für einen Moment die helle Oberfläche — auffällig genug, dass es wie ein
 * Fehler wirkt.
 *
 * Wird aus dem Wurzel-Layout gerendert, und das ist eine Server-Komponente.
 * Genau darum geht es: dasselbe Skript aus einer Client-Komponente heraus lässt
 * React 19 beanstanden.
 *
 * `dangerouslySetInnerHTML` ist hier unvermeidbar und unbedenklich — der Inhalt
 * ist eine Konstante aus dieser Datei, ohne jede Eingabe von aussen.
 */
export function ThemeScript({ nonce }: { readonly nonce?: string | undefined }) {
  const skript = `try{var t=localStorage.getItem(${JSON.stringify(SPEICHER_SCHLUESSEL)});var d=t==="dark"||((t===null||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`;

  return (
    <script
      // Der Server rendert das Skript, der Client sieht es nie erneut — ohne
      // diesen Hinweis beanstandet React die Abweichung.
      suppressHydrationWarning
      {...(nonce ? { nonce } : {})}
      dangerouslySetInnerHTML={{ __html: skript }}
    />
  );
}
