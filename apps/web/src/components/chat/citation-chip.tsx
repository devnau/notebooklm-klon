'use client';

import type { Citation } from '@nlm/shared';

import { cn } from '@/lib/utils';

/**
 * Ein anklickbarer Beleg im Antworttext.
 *
 * Das zentrale Vertrauenselement der Anwendung: der Klick öffnet die Quelle an
 * genau der Stelle, auf die sich die Aussage stützt. Wenn das ruckelt oder
 * danebentrifft, wirkt die ganze Anwendung unzuverlässig — deshalb sitzt hinter
 * dem Sprung ein Zeichenoffset aus dem Chunker und keine Textsuche.
 *
 * Gestaltet als kleiner, hochgestellter Chip statt als Fussnotenzahl: er soll
 * im Lesefluss erkennbar sein, ohne ihn zu zerreissen, und gross genug zum
 * Antippen bleiben.
 */
export function CitationChip({
  citation,
  onOpen,
}: {
  readonly citation: Citation;
  readonly onOpen: (citation: Citation) => void;
}) {
  const location = [
    citation.page !== null ? `Seite ${String(citation.page)}` : null,
    citation.headingPath,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={() => {
        onOpen(citation);
      }}
      className={cn(
        'mx-0.5 inline-flex items-baseline rounded px-1 align-baseline',
        'bg-citation-bg text-citation border-citation-border border',
        'text-[0.7em] leading-none font-medium',
        'hover:border-citation transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
      )}
      // Der sichtbare Text ist nur eine Nummer. Ohne diesen Namen hörte ein
      // Screenreader-Nutzer „S1 Doppelpunkt 4" und wüsste nichts.
      aria-label={`Beleg öffnen: ${citation.sourceTitle}${location ? `, ${location}` : ''}`}
      title={`${citation.sourceTitle}${location ? ` — ${location}` : ''}`}
    >
      {citation.label}
    </button>
  );
}
