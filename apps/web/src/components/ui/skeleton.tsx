import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Platzhalter in der Form des erwarteten Inhalts — nicht ein Spinner. Der
 * Layoutsprung beim Nachladen entfällt, und die Wartezeit fühlt sich kürzer an,
 * weil die Struktur schon sichtbar ist.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('bg-muted animate-shimmer rounded-md', className)}
      // Für Screenreader ist ein Skeleton bedeutungslos: das Ladeereignis wird
      // an anderer Stelle über aria-live gemeldet.
      aria-hidden
      {...props}
    />
  );
}
