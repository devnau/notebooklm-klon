'use client';

import { useId, type ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type FieldProps = {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly className?: string;
  /** Bekommt die zu setzenden Attribute — id, aria-invalid, aria-describedby. */
  readonly children: (props: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
};

/**
 * Verbindet Label, Eingabefeld, Hinweis und Fehlermeldung korrekt miteinander.
 *
 * Der Grund für das Render-Prop: die ARIA-Verknüpfung (`aria-describedby` auf
 * das richtige Element, `aria-invalid` nur im Fehlerfall) wird sonst an jedem
 * Formular einzeln gebaut und dabei zuverlässig irgendwo vergessen. Hier ist
 * sie einmal richtig.
 */
export function Field({ label, error, hint, className, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        // role="alert" sorgt dafür, dass die Meldung sofort vorgelesen wird.
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
