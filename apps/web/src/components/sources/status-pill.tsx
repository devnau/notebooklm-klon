import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Der Verarbeitungsstand einer Quelle.
 *
 * Die Zustände heißen in der Datenbank technisch (`extracting`, `embedding`),
 * hier stehen sie in der Sprache des Nutzers. „Wird indexiert" sagt ihm mehr
 * als „embedding", und er muss nicht wissen, dass es Vektoren gibt.
 *
 * Farbe ist nie der einzige Träger der Information: jeder Zustand hat ein
 * eigenes Symbol und eigenen Text. Wer Rot und Grün nicht unterscheiden kann,
 * sieht trotzdem den Unterschied zwischen „Bereit" und „Fehlgeschlagen".
 */

export type SourceStatus = 'pending' | 'extracting' | 'embedding' | 'ready' | 'failed';

const STATES: Record<
  SourceStatus,
  { label: string; className: string; icon: typeof Clock; spin?: boolean }
> = {
  pending: {
    label: 'In der Warteschlange',
    className: 'text-muted-foreground bg-muted',
    icon: Clock,
  },
  extracting: {
    label: 'Wird gelesen',
    className: 'text-primary bg-primary/10',
    icon: Loader2,
    spin: true,
  },
  embedding: {
    label: 'Wird indexiert',
    className: 'text-primary bg-primary/10',
    icon: Loader2,
    spin: true,
  },
  ready: {
    label: 'Bereit',
    className: 'text-success bg-success/10',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Fehlgeschlagen',
    className: 'text-destructive bg-destructive/10',
    icon: AlertCircle,
  },
};

export function StatusPill({
  status,
  className,
}: {
  readonly status: SourceStatus;
  readonly className?: string;
}) {
  const state = STATES[status];
  const Icon = state.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        state.className,
        className,
      )}
    >
      <Icon className={cn('size-3', state.spin && 'animate-spin')} aria-hidden />
      {state.label}
    </span>
  );
}

/** Für `aria-live`: dieselbe Aussage, aber als vollständiger Satz. */
export function statusAnnouncement(title: string, status: SourceStatus): string {
  switch (status) {
    case 'ready':
      return `${title} ist bereit.`;
    case 'failed':
      return `${title} konnte nicht verarbeitet werden.`;
    default:
      return `${title}: ${STATES[status].label}.`;
  }
}
