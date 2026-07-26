import { CircleAlert, CircleCheck } from 'lucide-react';

import type { AuthResult } from '@/app/(auth)/actions';

/**
 * Fehler- und Hinweismeldung für die Auth-Formulare.
 *
 * Die Unterscheidung ist bewusst: ein Fehler nach dem Abschicken bekommt
 * `role="alert"` und wird sofort vorgelesen — der Nutzer wartet ohnehin auf
 * eine Antwort. Eine Bestätigung meldet sich über `aria-live="polite"` und
 * unterbricht nicht.
 *
 * Ohne die Live-Region bliebe beides für Screenreader unsichtbar: das Ergebnis
 * einer Server Action erscheint ohne Navigation.
 */
export function AuthFormStatus({ state }: { readonly state: AuthResult }) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {state.error && (
        <p
          role="alert"
          className="bg-destructive-subtle text-destructive flex items-start gap-2 rounded-md p-3 text-sm"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </p>
      )}
      {state.notice && (
        <p className="bg-success-subtle text-success flex items-start gap-2 rounded-md p-3 text-sm">
          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{state.notice}</span>
        </p>
      )}
    </div>
  );
}
