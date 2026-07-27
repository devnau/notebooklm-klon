import { z } from 'zod';

/**
 * Der Audio-Überblick: zwei Stimmen im Gespräch über die eigenen Quellen.
 *
 * Warum ein Dialog und kein vorgelesener Text: eine Zusammenfassung, die
 * jemand vorliest, ist ein Hörbuch — man muss die ganze Zeit aufpassen. Ein
 * Gespräch hat Rückfragen, Einwürfe und Wechsel; das trägt über zehn Minuten,
 * ohne dass man mitschreiben muss. Das ist der eigentliche Nutzen des Formats.
 */

export const dialogueTurnSchema = z.object({
  speaker: z.enum(['host', 'guest']),
  text: z
    .string()
    .min(1)
    /*
     * Obergrenze pro Beitrag. Nicht willkürlich: die Synthese läuft je Beitrag
     * einzeln, und ein sehr langer Block wäre nicht nur langsam, sondern auch
     * ein Monolog — genau das, was das Format vermeiden soll.
     */
    .max(1_200),
});

export const audioScriptSchema = z.object({
  title: z.string().min(1).max(160),
  turns: z.array(dialogueTurnSchema).min(6).max(80),
});

export type DialogueTurn = z.infer<typeof dialogueTurnSchema>;
export type AudioScript = z.infer<typeof audioScriptSchema>;

/**
 * Was im Dialog steht, entscheidet dieser Auftrag.
 *
 * Die Regeln sind konkreter, als sie sein müssten, und das mit Absicht: ohne
 * sie entsteht zuverlässig ein Werbetext, in dem zwei Stimmen einander
 * bestätigen, wie spannend das Thema ist. Was ein Hörer davon hat, ist nichts.
 */
export const AUDIO_SCRIPT_INSTRUCTION_DE = `Schreibe ein Gespräch zwischen zwei Personen über die bereitgestellten Auszüge.

**host** führt durch das Gespräch, ordnet ein und stellt die Fragen, die ein Aussenstehender hätte.
**guest** kennt die Unterlagen im Detail und antwortet.

## Regeln

Der Inhalt kommt **ausschliesslich** aus den Auszügen. Was dort nicht steht, kommt nicht vor — auch nicht als allgemeine Einordnung, auch nicht als Beispiel.

Sagt der Gast etwas, das die Quellen nicht hergeben, ist das ein Fehler, kein Service. Fehlt zu einem Punkt die Angabe, soll er das sagen: „Dazu steht in den Unterlagen nichts."

Ein Beitrag ist zwei bis vier Sätze lang. Längere Blöcke sind Vorträge, und dann kann man den Text auch lesen.

Der Host fragt echte Fragen — solche, deren Antwort er nicht schon kennt. Kein „Erzähl doch mal", kein „Das ist ja spannend, und was noch?".

Keine Begrüssungsfloskeln, kein „Willkommen zu einer neuen Folge", kein Abspann. Steig mit der Sache ein und hör auf, wenn sie erzählt ist.

Zahlen, Fristen und Eigennamen werden ausgesprochen, nicht abgekürzt: „vierzehn Tage" statt „14 T.", „Paragraf drei" statt „§ 3". Der Text wird vorgelesen, nicht gelesen.

Keine Zitatmarker im Text. Sie wären hörbar und ergäben keinen Sinn.

## Länge

Zwölf bis dreissig Beiträge, je nach Materialmenge. Lieber kürzer und dicht als lang und wiederholend.`;

export const AUDIO_SCRIPT_INSTRUCTION_EN = `Write a conversation between two people about the provided excerpts.

**host** guides the conversation and asks the questions an outsider would have.
**guest** knows the material in detail and answers.

## Rules

Content comes **exclusively** from the excerpts. What is not in them does not appear — not as general context, not as an example.

If the guest says something the sources do not support, that is an error, not a service. Where an excerpt is silent, say so.

A turn is two to four sentences. Longer blocks are lectures, and then the text may as well be read.

The host asks real questions — ones whose answers they do not already know. No "tell us more", no "that's fascinating".

No greetings, no "welcome to another episode", no sign-off. Start with the substance and stop when it is told.

Numbers, deadlines and names are spoken out, not abbreviated: "fourteen days", not "14 d.". The text is read aloud, not read.

No citation markers in the text. They would be audible and make no sense.

## Length

Twelve to thirty turns depending on how much material there is. Shorter and denser beats long and repetitive.`;

export function audioScriptInstruction(language: string): string {
  return language === 'en' ? AUDIO_SCRIPT_INSTRUCTION_EN : AUDIO_SCRIPT_INSTRUCTION_DE;
}

/** Grobe Schätzung der Spieldauer, für die Anzeige während der Erzeugung. */
export function estimateDurationSeconds(script: AudioScript): number {
  // Rund 14 Zeichen pro Sekunde bei ruhigem Sprechtempo, plus die Pause
  // zwischen zwei Beiträgen.
  const characters = script.turns.reduce((sum, turn) => sum + turn.text.length, 0);
  return Math.round(characters / 14 + script.turns.length * 0.25);
}
