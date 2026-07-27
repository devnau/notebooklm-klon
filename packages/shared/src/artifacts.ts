import { z } from 'zod';

/**
 * Die Studio-Artefakte: Schema, Prompt und Beschriftung je Art.
 *
 * Alles an einer Stelle, weil es zusammengehört und sonst auseinanderläuft.
 * Ein Schema, das der Worker anders versteht als der Renderer, führt zu einer
 * leeren Karte in der Oberfläche ohne Fehlermeldung — der Job war ja
 * erfolgreich.
 *
 * **Warum Structured Outputs statt freiem Text.** Ein Lernleitfaden als
 * Fliesstext liesse sich nur als Markdown-Block anzeigen. Als Struktur kann die
 * Oberfläche Fragen einzeln aufklappen, eine Zeitleiste chronologisch
 * anordnen, eine Mindmap als Diagramm zeichnen. Und: was gegen ein Schema
 * validiert, lässt sich prüfen — ein fehlendes Feld fällt beim Speichern auf
 * und nicht erst beim Rendern.
 *
 * Zitate sind in jedem Schema vorgesehen und optional. Ein Artefakt ohne
 * Belege ist weniger wert, aber ein erzwungener Beleg an einer Stelle, die
 * keinen hergibt, wäre schlimmer — dann erfindet das Modell einen.
 */

/** Zitatmarker wie im Chat: `S1:4`. Aufgelöst wird später, wie bei Antworten. */
const citationRefs = z
  .array(z.string().regex(/^S\d{1,3}:\d{1,5}$/))
  .max(8)
  .default([]);

export const summarySchema = z.object({
  tldr: z.string().min(1).max(1_200),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1).max(200),
        bullets: z.array(z.string().min(1).max(600)).min(1).max(8),
        citations: citationRefs,
      }),
    )
    .min(1)
    .max(10),
});

export const studyGuideSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1).max(400),
        answer: z.string().min(1).max(1_500),
        citations: citationRefs,
      }),
    )
    .min(3)
    .max(20),
  glossary: z
    .array(
      z.object({
        term: z.string().min(1).max(120),
        definition: z.string().min(1).max(600),
        citations: citationRefs,
      }),
    )
    .max(20)
    .default([]),
});

export const faqSchema = z.object({
  items: z
    .array(
      z.object({
        question: z.string().min(1).max(400),
        answer: z.string().min(1).max(1_500),
        citations: citationRefs,
      }),
    )
    .min(3)
    .max(20),
});

export const timelineSchema = z.object({
  events: z
    .array(
      z.object({
        /*
         * Bewusst Text und kein Datum. In Dokumenten stehen „im dritten
         * Quartal", „nach Ablauf der Frist" oder „2024" — ein Datumsfeld
         * zwänge das Modell, sich etwas auszudenken, damit es parst.
         */
        date: z.string().min(1).max(80),
        label: z.string().min(1).max(200),
        detail: z.string().max(800).default(''),
        citations: citationRefs,
      }),
    )
    .min(2)
    .max(30),
});

export const briefingSchema = z.object({
  purpose: z.string().min(1).max(800),
  keyPoints: z
    .array(
      z.object({
        point: z.string().min(1).max(600),
        citations: citationRefs,
      }),
    )
    .min(2)
    .max(12),
  implications: z.array(z.string().min(1).max(600)).max(8).default([]),
  openQuestions: z.array(z.string().min(1).max(400)).max(8).default([]),
});

export const mindmapSchema = z.object({
  root: z.string().min(1).max(120),
  nodes: z
    .array(
      z.object({
        /* Kurze, stabile Kennung — sie wird als Mermaid-Knotenname verwendet. */
        id: z
          .string()
          .min(1)
          .max(24)
          .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Nur Buchstaben, Ziffern und Unterstrich'),
        label: z.string().min(1).max(120),
        /** `null` bedeutet: hängt direkt an der Wurzel. */
        parent: z.string().max(24).nullable(),
      }),
    )
    .min(3)
    .max(40),
});

export const ARTIFACT_SCHEMAS = {
  summary: summarySchema,
  study_guide: studyGuideSchema,
  faq: faqSchema,
  timeline: timelineSchema,
  briefing: briefingSchema,
  mindmap: mindmapSchema,
} as const;

export type GeneratedArtifactKind = keyof typeof ARTIFACT_SCHEMAS;

export type SummaryPayload = z.infer<typeof summarySchema>;
export type StudyGuidePayload = z.infer<typeof studyGuideSchema>;
export type FaqPayload = z.infer<typeof faqSchema>;
export type TimelinePayload = z.infer<typeof timelineSchema>;
export type BriefingPayload = z.infer<typeof briefingSchema>;
export type MindmapPayload = z.infer<typeof mindmapSchema>;

export type ArtifactPayload =
  | SummaryPayload
  | StudyGuidePayload
  | FaqPayload
  | TimelinePayload
  | BriefingPayload
  | MindmapPayload;

/** Beschriftung und Auftrag je Art. Die Oberfläche liest das Erste, das Modell das Zweite. */
export const ARTIFACT_META: Record<
  GeneratedArtifactKind,
  {
    readonly label: string;
    readonly description: string;
    /** Was das Modell tun soll — wird an den gemeinsamen Systemprompt angehängt. */
    readonly instruction: string;
  }
> = {
  summary: {
    label: 'Zusammenfassung',
    description: 'Kernaussagen über alle Quellen, gegliedert',
    instruction: `Fasse die Quellen zusammen.

Beginne mit einem Absatz, der die wichtigste Aussage in zwei bis drei Sätzen enthält — jemand, der nur diesen liest, soll wissen, worum es geht.

Gliedere danach nach Themen, nicht nach Dokumenten. Was in mehreren Quellen steht, gehört in einen Abschnitt, nicht in zwei. Widersprüche zwischen Quellen benennst du ausdrücklich, statt dich für eine Seite zu entscheiden.`,
  },
  study_guide: {
    label: 'Lernleitfaden',
    description: 'Fragen mit Antworten und ein Glossar',
    instruction: `Erstelle einen Lernleitfaden.

Die Fragen prüfen Verständnis, nicht Auswendiglernen: „Warum gilt die Frist nicht für Frachtbriefe?" ist besser als „Wie lange gilt die Frist?". Ordne sie vom Grundlegenden zum Speziellen.

Ins Glossar kommen nur Begriffe, die in den Quellen tatsächlich erklärt oder als bekannt vorausgesetzt werden — keine allgemeinsprachlichen Wörter.`,
  },
  faq: {
    label: 'FAQ',
    description: 'Häufige Fragen, direkt beantwortet',
    instruction: `Erstelle eine Liste häufiger Fragen.

Stelle die Fragen so, wie jemand sie stellen würde, der das Dokument nicht gelesen hat: konkret, in eigenen Worten, ohne Fachbegriffe aus der Quelle. Die Antwort steht im ersten Satz; Erläuterung danach.`,
  },
  timeline: {
    label: 'Zeitleiste',
    description: 'Ereignisse und Fristen in ihrer Abfolge',
    instruction: `Trage die zeitlichen Angaben zusammen.

Dazu gehören Daten, Fristen, Laufzeiten und Abfolgen. Übernimm die Zeitangabe so, wie sie in der Quelle steht — „im dritten Quartal" bleibt „im dritten Quartal" und wird nicht in ein Datum umgerechnet.

Ordne chronologisch. Ist die Reihenfolge unklar, ordne nach der Reihenfolge im Dokument und sag es im Detailtext.

Gibt es weniger als zwei zeitliche Angaben, ist eine Zeitleiste für diese Quellen nicht sinnvoll — sag das im Detailtext des einen Eintrags, statt Ereignisse zu erfinden.`,
  },
  briefing: {
    label: 'Briefing',
    description: 'Zweck, Kernpunkte, Konsequenzen',
    instruction: `Schreibe ein Briefing für jemanden, der gleich in eine Besprechung geht.

Zweck: worum es geht, in zwei Sätzen. Kernpunkte: was man wissen muss. Konsequenzen: was daraus folgt — aber nur, soweit die Quellen es hergeben, keine eigenen Schlüsse.

Offene Fragen: was die Quellen nicht beantworten, obwohl es zur Sache gehört. Dieser Teil ist der wertvollste; lass ihn nicht leer, wenn es wirklich Lücken gibt.`,
  },
  mindmap: {
    label: 'Mindmap',
    description: 'Begriffe und ihre Beziehungen als Diagramm',
    instruction: `Baue eine Begriffslandkarte.

Die Wurzel ist das übergreifende Thema. Darunter zwei bis fünf Hauptäste, darunter jeweils die Unterbegriffe. Halte die Beschriftungen kurz — zwei bis vier Wörter, keine Sätze.

Die Kennung jedes Knotens ist kurz und eindeutig (etwa \`fristen\`, \`fristen_bewerbung\`). Jeder Knoten verweist über \`parent\` auf seine Kennung oder auf \`null\` für die Wurzel. Verweise nie auf eine Kennung, die es nicht gibt.

Höchstens drei Ebenen. Tiefer wird ein Diagramm unlesbar.`,
  },
};

export const GENERATED_ARTIFACT_KINDS = Object.keys(
  ARTIFACT_SCHEMAS,
) as GeneratedArtifactKind[];

export function isGeneratedArtifactKind(value: string): value is GeneratedArtifactKind {
  return value in ARTIFACT_SCHEMAS;
}
