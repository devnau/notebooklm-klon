import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Leere Zustände arbeiten mit: sie erklären, was hier entsteht, und bieten den
 * nächsten Schritt direkt an — statt nur festzustellen, dass nichts da ist.
 */
export function EmptyState({
  title,
  description,
  action,
  illustration,
  className,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly illustration?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed',
        'px-6 py-16 text-center',
        className,
      )}
    >
      {illustration ?? <PlaceholderIllustration />}
      <h2 className="mt-6 font-medium">{title}</h2>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/**
 * Platzhalter in den Maßen der späteren Illustration (800 × 600, siehe
 * assets/PROMPTS.md), damit der Austausch kein Layout verschiebt.
 */
function PlaceholderIllustration() {
  return (
    <svg viewBox="0 0 160 120" className="text-border h-24 w-32" fill="none" aria-hidden>
      <rect
        x="18"
        y="26"
        width="62"
        height="78"
        rx="5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="40"
        y="16"
        width="62"
        height="78"
        rx="5"
        stroke="currentColor"
        strokeWidth="2"
        className="fill-background"
      />
      <rect
        x="62"
        y="26"
        width="62"
        height="78"
        rx="5"
        stroke="currentColor"
        strokeWidth="2"
        className="fill-background"
      />
      <path
        d="M78 52h30M78 64h22M78 76h26"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
