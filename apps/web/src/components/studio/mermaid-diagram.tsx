'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Zeichnet ein Mermaid-Diagramm.
 *
 * Drei Entscheidungen, die hier zusammenkommen:
 *
 * **Nachgeladen, nicht mitgebündelt.** Mermaid ist gross — grösser als der
 * Rest der Anwendung. Es liegt hinter einem dynamischen Import und wird erst
 * geholt, wenn tatsächlich eine Mindmap angezeigt wird. Die überwiegende
 * Mehrheit der Aufrufe kommt ohne aus.
 *
 * **`htmlLabels: false`.** Damit rendert Mermaid Beschriftungen als
 * SVG-Textknoten statt als eingebettetes HTML. Der Quelltext stammt aus einer
 * Modellausgabe; ihn HTML erzeugen zu lassen wäre eine unnötige Angriffsfläche,
 * auch wenn `escapeMermaidLabel` bereits entschärft. Zwei Linien statt einer.
 *
 * **Fehler werden angezeigt, nicht verschluckt.** Mermaid wirft bei ungültigem
 * Quelltext. Ohne Behandlung bliebe eine leere Fläche stehen, und niemand
 * wüsste, ob noch geladen wird.
 */

export function MermaidDiagram({
  source,
  title,
}: {
  readonly source: string;
  readonly title: string;
}) {
  const reactId = useId();
  // Mermaid verlangt eine gültige CSS-Kennung; useId liefert Doppelpunkte.
  const domId = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          theme: 'neutral',
          flowchart: { htmlLabels: false, curve: 'basis' },
          // Die Schrift kommt aus dem Token-Set, damit das Diagramm nicht wie
          // ein Fremdkörper wirkt.
          fontFamily: 'inherit',
        });

        const { svg: rendered } = await mermaid.render(domId, source);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, domId]);

  if (failed) {
    return (
      <p role="alert" className="text-muted-foreground text-sm">
        Das Diagramm liess sich nicht zeichnen. Ein erneutes Erzeugen hilft oft.
      </p>
    );
  }

  if (svg === null) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <figure>
      {/*
        dangerouslySetInnerHTML ist hier unvermeidbar — Mermaid gibt fertiges
        SVG als Zeichenkette zurück. Vertretbar ist es, weil der Quelltext aus
        `toMermaid()` stammt: Beschriftungen sind dort entschärft, Kennungen
        sind auf `[A-Za-z][A-Za-z0-9_]*` beschränkt, und Mermaid läuft mit
        securityLevel 'strict' und ohne HTML-Labels. Modellausgabe geht also
        nirgends unmaskiert in Markup.
      */}
      <div
        ref={container}
        className="overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="sr-only">Begriffslandkarte zu {title}</figcaption>
    </figure>
  );
}
