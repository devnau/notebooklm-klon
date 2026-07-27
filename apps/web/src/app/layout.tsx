import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Instrument_Sans, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme-provider';

import './globals.css';

const instrumentSans = Instrument_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

/** Für Quellentexte im Viewer — eine Leseschrift, keine UI-Schrift. */
const sourceSerif = Source_Serif_4({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-source-serif',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Notebook Studio',
    template: '%s · Notebook Studio',
  },
  description:
    'Eigene Quellen hochladen und mit belegten Antworten durcharbeiten — jede Aussage klickbar zur Textstelle.',
  applicationName: 'Notebook Studio',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f6' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1917' },
  ],
};

/**
 * Alle Seiten werden je Anfrage gerendert.
 *
 * Nicht aus Bequemlichkeit, sondern weil die Content-Security-Policy einen
 * **Nonce pro Anfrage** vergibt. Eine statisch vorgerenderte Seite trägt ihre
 * Skripte fertig im HTML — mit dem Nonce vom Build-Zeitpunkt, also mit gar
 * keinem. Der Browser blockiert dann jedes Skript, und die Seite erscheint,
 * reagiert aber auf nichts.
 *
 * Aufgefallen ist das nur, weil der CSP-Test gegen den Produktionsbuild läuft:
 * im Dev-Server wird ohnehin alles dynamisch gerendert, und dort war die Welt
 * in Ordnung.
 *
 * Der Preis ist gering. Statisch waren bisher `/`, `/registrieren`,
 * `/passwort-vergessen` und die Fehlerseite — vier kleine Formularseiten ohne
 * Daten. Alles Übrige liegt hinter der Anmeldung und war nie statisch.
 */
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  // Der Proxy legt den Nonce dieser Anfrage in eine eigene Kopfzeile, weil
  // Server Components den CSP-Header nicht selbst auslesen können.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html
      lang="de"
      suppressHydrationWarning
      // Sagt Next.js, dass das weiche Scrollen gewollt ist. Ohne dieses
      // Attribut warnt der Router und schaltet es bei Routenwechseln ab.
      data-scroll-behavior="smooth"
      className={`${instrumentSans.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <ThemeProvider nonce={nonce}>
          <a
            href="#main"
            className="sr-only-focusable bg-primary text-primary-foreground fixed top-3 left-3 z-50 rounded-md px-3 py-2 text-sm font-medium"
          >
            Zum Hauptinhalt springen
          </a>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
