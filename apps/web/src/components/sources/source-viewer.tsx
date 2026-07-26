'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createSourceTextUrl } from '@/app/(app)/notebooks/[id]/sources/actions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Zeigt den extrahierten Text einer Quelle und markiert darin eine Stelle.
 *
 * Das ist die Komponente, an der die ganze Anwendung gemessen wird: ein Zitat
 * ist nur so viel wert, wie der Sprung dorthin verlässlich ist. Ab Phase 3
 * öffnet jeder Zitat-Chip im Chat genau diesen Viewer mit dem passenden
 * Bereich.
 *
 * Angezeigt wird der Text als Text, nicht als gerendertes Markdown. Zwei
 * Gründe: Erstens beziehen sich `charStart`/`charEnd` auf genau diese
 * Zeichenkette — jede Umwandlung würde die Positionen verschieben. Zweitens
 * stammt der Inhalt aus einer fremden Datei; ihn als Markup zu rendern hiesse,
 * dem Dokument zu erlauben, im Browser des Nutzers etwas darzustellen, das
 * nicht darin steht.
 */

export type TextRange = {
  readonly charStart: number;
  readonly charEnd: number;
};

export function SourceViewer({
  sourceId,
  title,
  range,
  open,
  onOpenChange,
}: {
  readonly sourceId: string | null;
  readonly title: string;
  readonly range?: TextRange | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open || !sourceId) return;

    let cancelled = false;
    setText(null);
    setError(null);

    void (async () => {
      const result = await createSourceTextUrl(sourceId);
      if (cancelled) return;
      if (result.error ?? !result.url) {
        setError(result.error ?? 'Der Text ließ sich nicht laden.');
        return;
      }
      try {
        const response = await fetch(result.url);
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.text();
        if (!cancelled) setText(body);
      } catch {
        if (!cancelled) setError('Der Text ließ sich nicht laden.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, sourceId]);

  // Erst scrollen, wenn der Text steht — vorher gibt es das Ziel nicht.
  useEffect(() => {
    if (!text || !range) return;
    markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [text, range]);

  const body = useCallback(() => {
    if (error) {
      return (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      );
    }
    if (text === null) {
      return (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </div>
      );
    }
    return (
      <pre className="font-serif text-sm leading-relaxed whitespace-pre-wrap">
        <Highlighted text={text} range={range} markRef={markRef} />
      </pre>
    );
  }, [error, text, range]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
          <DialogDescription>
            Extrahierter Text, so wie er indexiert wurde.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{body()}</div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Teilt den Text in drei Stücke und markiert das mittlere.
 *
 * Die Grenzen werden geklemmt statt vertraut: ein Zitat, dessen Bereich nicht
 * mehr zum Text passt — etwa weil eine Quelle neu importiert wurde —, darf
 * nicht dazu führen, dass gar nichts angezeigt wird. Lieber ohne Markierung
 * als eine leere Seite.
 */
function Highlighted({
  text,
  range,
  markRef,
}: {
  readonly text: string;
  readonly range: TextRange | undefined;
  readonly markRef: React.RefObject<HTMLElement | null>;
}) {
  if (!range) return <>{text}</>;

  const start = Math.max(0, Math.min(range.charStart, text.length));
  const end = Math.max(start, Math.min(range.charEnd, text.length));
  if (start === end) return <>{text}</>;

  return (
    <>
      {text.slice(0, start)}
      <mark ref={markRef} className="cited-range">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}
