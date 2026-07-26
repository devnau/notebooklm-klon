import type { Metadata, Viewport } from 'next';
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

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html
      lang="de"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <ThemeProvider>
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
