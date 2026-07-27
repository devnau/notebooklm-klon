'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * @param nonce Der CSP-Nonce dieser Anfrage.
 *
 * `next-themes` schreibt ein Inline-Skript in den Kopf, das die gespeicherte
 * Einstellung anwendet, bevor die Seite gezeichnet wird — ohne das blitzt beim
 * Laden kurz das helle Design auf. Inline heisst: es braucht den Nonce, sonst
 * blockiert die Content-Security-Policy es. Die Folge wäre kein Fehler,
 * sondern genau das Aufblitzen, gegen das es gebaut wurde.
 */
export function ThemeProvider({
  children,
  nonce,
}: {
  readonly children: ReactNode;
  readonly nonce?: string | undefined;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...(nonce ? { nonce } : {})}
    >
      {children}
    </NextThemesProvider>
  );
}
