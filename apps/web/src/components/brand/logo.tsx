import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * Wortmarke als Inline-SVG. Platzhalter, bis brand/logo-wordmark.svg vorliegt
 * (Prompt 1 in assets/PROMPTS.md) — gleiche Maße, damit der Austausch später
 * kein Layout verschiebt.
 *
 * Das Zeichen greift die Idee der App auf: zwei versetzte Flächen, verbunden
 * durch eine Linie, die auf einen Punkt zeigt — eine Aussage und ihre Quelle.
 */
export function LogoMark({
  className,
  label,
}: {
  readonly className?: string;
  /**
   * Nur setzen, wenn die Marke allein steht. Steht daneben der Schriftzug,
   * bleibt sie ohne Namen — sonst liest ein Screenreader „Notebook Studio
   * Notebook Studio".
   */
  readonly label?: string | undefined;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-8', className)}
      fill="none"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <rect
        x="3"
        y="4"
        width="15"
        height="19"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="14"
        y="9"
        width="15"
        height="19"
        rx="2.5"
        className="fill-background"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M18.5 18.5h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18.5" cy="18.5" r="1.75" fill="currentColor" />
    </svg>
  );
}

export function Logo({
  className,
  href = '/notebooks',
  showText = true,
}: {
  readonly className?: string;
  readonly href?: string | undefined;
  readonly showText?: boolean;
}) {
  const content = (
    <>
      <LogoMark
        className="text-primary"
        {...(showText ? {} : { label: 'Notebook Studio' })}
      />
      {showText && (
        <span className="text-lg font-semibold tracking-tight">
          Notebook<span className="text-muted-foreground font-normal"> Studio</span>
        </span>
      )}
    </>
  );

  const classes = cn(
    'inline-flex items-center gap-2.5 rounded-md',
    href && 'focus-visible:ring-ring hover:opacity-90 focus-visible:ring-2',
    className,
  );

  if (!href) {
    return <span className={classes}>{content}</span>;
  }

  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}
