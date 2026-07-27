import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * Die Bildmarke als Inline-SVG.
 *
 * Nachgezeichnet nach der gelieferten Vorlage (`assets/quellen/icon-hell.png`),
 * nicht eingebettet: als SVG bleibt sie bei jeder Grösse scharf, erbt die
 * Themenfarbe über `currentColor` und kostet keinen zusätzlichen Request. Ein
 * Rasterbild im Kopfbereich müsste in mehreren Auflösungen vorliegen und
 * bräuchte für den dunklen Modus eine zweite Datei.
 *
 * Die Geometrie ist die Aussage der Anwendung: zwei versetzte Flächen — die
 * Antwort und ihre Quelle — als eine gemeinsame Kontur, und darin eine Linie,
 * die von einem Punkt zurück in die zweite Fläche führt. Der Punkt ist das
 * Zitat.
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
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="round"
      strokeLinecap="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {/*
        Eine einzige Kontur um beide Flächen statt zweier Rechtecke: so gibt es
        keine Linie mitten durch die Form, und die Marke bleibt bei 16 Pixel
        noch als Silhouette lesbar.
      */}
      <path d="M5 6h14v5h8v15H13v-5H5z" />
      {/* Vom Zitatpunkt zurück in die zweite Fläche. */}
      <path d="M13.5 16H19v10" />
      <circle cx="12" cy="16" r="2.1" fill="currentColor" stroke="none" />
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
