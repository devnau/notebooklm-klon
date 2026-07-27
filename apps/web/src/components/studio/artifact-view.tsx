'use client';

import {
  toMermaid,
  type BriefingPayload,
  type Citation,
  type FaqPayload,
  type GeneratedArtifactKind,
  type MindmapPayload,
  type StudyGuidePayload,
  type SummaryPayload,
  type TimelinePayload,
} from '@nlm/shared';

import { CitationChip } from '@/components/chat/citation-chip';
import { Markdown } from '@/components/ui/markdown';
import { MermaidDiagram } from '@/components/studio/mermaid-diagram';

/**
 * Stellt ein Artefakt dar — je Art anders.
 *
 * Genau dafür sind die Structured Outputs da: eine Zeitleiste als Fliesstext
 * wäre eine Liste mit Datumsangaben am Zeilenanfang; als Struktur kann sie
 * chronologisch gesetzt werden, mit Datum in einer eigenen Spalte. Ein
 * Lernleitfaden kann Frage und Antwort trennen, sodass man sich selbst abfragen
 * kann.
 *
 * Die Textfelder gehen durch den Markdown-Renderer, obwohl sie meist einfacher
 * Text sind: das Modell setzt gelegentlich Betonungen, und ungerendert stünde
 * dann `**wichtig**` im Fliesstext. Sanitisiert wird dabei ohnehin.
 */

/** Was der Worker zusätzlich zum Schema ins `payload` legt. */
type WithCitations = { readonly resolvedCitations?: Citation[] };

export function ArtifactView({
  kind,
  payload,
  onOpenCitation,
}: {
  readonly kind: GeneratedArtifactKind;
  readonly payload: unknown;
  readonly onOpenCitation: (citation: Citation) => void;
}) {
  const resolved = (payload as WithCitations).resolvedCitations ?? [];
  const byLabel = new Map(resolved.map((citation) => [citation.label, citation]));

  /** Zeigt die Belege eines Eintrags — nur die, die sich auflösen liessen. */
  const refs = (labels: readonly string[] | undefined) => {
    const citations = (labels ?? [])
      .map((label) => byLabel.get(label))
      .filter((citation): citation is Citation => citation !== undefined);
    if (citations.length === 0) return null;
    return (
      <span className="ml-1 inline-flex flex-wrap gap-0.5">
        {citations.map((citation) => (
          <CitationChip key={citation.label} citation={citation} onOpen={onOpenCitation} />
        ))}
      </span>
    );
  };

  switch (kind) {
    case 'summary': {
      const data = payload as SummaryPayload;
      return (
        <div className="flex flex-col gap-4">
          <p className="bg-muted rounded-md p-3 text-sm leading-relaxed">{data.tldr}</p>
          {data.sections.map((section, index) => (
            <section key={`${section.heading}-${String(index)}`}>
              <h4 className="mb-1.5 text-sm font-medium">
                {section.heading}
                {refs(section.citations)}
              </h4>
              <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
                {section.bullets.map((bullet, bulletIndex) => (
                  <li key={bulletIndex}>{bullet}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      );
    }

    case 'study_guide': {
      const data = payload as StudyGuidePayload;
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {data.questions.map((entry, index) => (
              // <details> statt eigener Aufklapp-Logik: die Tastaturbedienung
              // und das Vorlesen bringt der Browser mit, und beim Drucken ist
              // alles offen.
              <details key={index} className="bg-surface rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {entry.question}
                </summary>
                <div className="text-muted-foreground mt-2 text-sm">
                  <Markdown>{entry.answer}</Markdown>
                  {refs(entry.citations)}
                </div>
              </details>
            ))}
          </div>

          {data.glossary.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-medium">Glossar</h4>
              <dl className="flex flex-col gap-2 text-sm">
                {data.glossary.map((entry, index) => (
                  <div key={index}>
                    <dt className="font-medium">{entry.term}</dt>
                    <dd className="text-muted-foreground">
                      {entry.definition}
                      {refs(entry.citations)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      );
    }

    case 'faq': {
      const data = payload as FaqPayload;
      return (
        <div className="flex flex-col gap-2">
          {data.items.map((item, index) => (
            <details key={index} className="bg-surface rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {item.question}
              </summary>
              <div className="text-muted-foreground mt-2 text-sm">
                <Markdown>{item.answer}</Markdown>
                {refs(item.citations)}
              </div>
            </details>
          ))}
        </div>
      );
    }

    case 'timeline': {
      const data = payload as TimelinePayload;
      return (
        // Die Linie links ist rein dekorativ und deshalb über einen Rahmen
        // gelöst statt über ein Element — sie taucht so gar nicht erst im
        // Zugänglichkeitsbaum auf.
        <ol className="border-border flex flex-col gap-4 border-l pl-4">
          {data.events.map((event, index) => (
            <li key={index} className="relative">
              <span className="bg-primary absolute top-1.5 -left-[21px] size-2 rounded-full" />
              <p className="text-primary text-xs font-medium">{event.date}</p>
              <p className="mt-0.5 text-sm font-medium">
                {event.label}
                {refs(event.citations)}
              </p>
              {event.detail && (
                <p className="text-muted-foreground mt-1 text-sm">{event.detail}</p>
              )}
            </li>
          ))}
        </ol>
      );
    }

    case 'briefing': {
      const data = payload as BriefingPayload;
      return (
        <div className="flex flex-col gap-4">
          <section>
            <h4 className="mb-1.5 text-sm font-medium">Worum es geht</h4>
            <p className="text-muted-foreground text-sm leading-relaxed">{data.purpose}</p>
          </section>

          <section>
            <h4 className="mb-1.5 text-sm font-medium">Kernpunkte</h4>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {data.keyPoints.map((entry, index) => (
                <li key={index}>
                  {entry.point}
                  {refs(entry.citations)}
                </li>
              ))}
            </ul>
          </section>

          {data.implications.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-sm font-medium">Was daraus folgt</h4>
              <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
                {data.implications.map((entry, index) => (
                  <li key={index}>{entry}</li>
                ))}
              </ul>
            </section>
          )}

          {data.openQuestions.length > 0 && (
            <section>
              {/*
                Der wertvollste Teil: was die Quellen *nicht* beantworten. Er
                steht deshalb nicht am Rand, sondern hervorgehoben.
              */}
              <h4 className="mb-1.5 text-sm font-medium">Offene Fragen</h4>
              <ul className="text-muted-foreground flex list-disc flex-col gap-1 border-l-2 border-amber-500/40 pl-5 text-sm">
                {data.openQuestions.map((entry, index) => (
                  <li key={index}>{entry}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      );
    }

    case 'mindmap': {
      const data = payload as MindmapPayload;
      return <MermaidDiagram source={toMermaid(data)} title={data.root} />;
    }
  }
}
