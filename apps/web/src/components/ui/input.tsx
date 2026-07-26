import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'bg-surface border-input h-9 w-full rounded-md border px-3 py-1 text-sm',
        'placeholder:text-muted-foreground shadow-subtle transition-colors',
        'focus-visible:ring-ring focus-visible:border-ring focus-visible:ring-2',
        'focus-visible:ring-offset-background focus-visible:ring-offset-1 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Fehlerhafte Felder werden über aria-invalid markiert, nicht über eine
        // eigene Klasse: so bleibt visueller und assistiver Zustand synchron.
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  );
}
