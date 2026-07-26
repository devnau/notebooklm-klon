'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Fehler-Boundary für unerwartete Ausnahmen. Zeigt bewusst keine technischen
 * Details: eine Fehlermeldung kann Interna enthalten, die Nutzer nichts angehen.
 * Die Digest-Kennung genügt, um den Fehler im Serverlog zu finden.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error('Unbehandelter Fehler:', error);
  }, [error]);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Da ist etwas schiefgelaufen</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        Der Fehler wurde protokolliert. Ein erneuter Versuch hilft oft schon.
      </p>
      {error.digest && (
        <p className="text-muted-foreground mt-4 font-mono text-xs">
          Kennung: {error.digest}
        </p>
      )}
      <Button onClick={reset} className="mx-auto mt-8">
        <RotateCcw aria-hidden />
        Erneut versuchen
      </Button>
    </main>
  );
}
