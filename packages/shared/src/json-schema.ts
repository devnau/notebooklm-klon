/**
 * Bringt ein JSON-Schema in die Teilmenge, die Structured Outputs akzeptieren.
 *
 * Die API nimmt nicht jedes gültige JSON-Schema. Für Arrays lehnt sie
 * `maxItems` vollständig ab und erlaubt `minItems` nur mit 0 oder 1 — ein
 * `.min(3).max(20)` aus Zod führt also zu HTTP 400, und zwar erst zur
 * Laufzeit beim ersten echten Aufruf.
 *
 * Statt die Zod-Schemas zu verstümmeln, werden die Angaben hier für den
 * Versand entfernt. Das ist keine Notlösung, sondern die saubere
 * Aufgabenteilung:
 *
 *  * Die **API** erzwingt die *Form* — welche Felder es gibt, welchen Typ sie
 *    haben, was verpflichtend ist. Das ist der Teil, den ein Modell ohne
 *    Zwang zuverlässig falsch macht.
 *  * **Zod** erzwingt danach unsere *Zusatzbedingungen* — Anzahlen, Längen,
 *    Muster. Sie bleiben vollständig erhalten und werden beim Speichern
 *    geprüft; ein Verstoss führt zu einem erneuten Versuch.
 *
 * Die gewünschten Anzahlen stehen zusätzlich im Auftragstext („drei bis
 * zwanzig Fragen"). Ein Modell hält sich daran meist auch ohne Schemazwang —
 * und wenn nicht, greift Zod.
 */

/** Schlüssel, die die API bei Arrays ablehnt. */
const UNSUPPORTED_ARRAY_KEYS = ['maxItems', 'uniqueItems'] as const;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Entfernt rekursiv, was die API nicht versteht.
 *
 * Arbeitet auf einer Kopie: das übergebene Schema wird nicht verändert. Sonst
 * hinge das Verhalten davon ab, ob vorher schon jemand konvertiert hat — ein
 * Fehler, der nur beim zweiten Aufruf auftritt.
 */
export function toStructuredOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry) => toStructuredOutputSchema(entry));
  }
  if (!isObject(schema)) return schema;

  const result: JsonObject = {};

  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_ARRAY_KEYS.includes(key as (typeof UNSUPPORTED_ARRAY_KEYS)[number])) {
      continue;
    }

    if (key === 'minItems') {
      /*
       * 0 und 1 sind erlaubt und tragen eine Aussage: „darf leer sein" gegen
       * „mindestens ein Eintrag". Höhere Werte werden auf 1 gesenkt statt
       * entfernt — die Aussage „nicht leer" bleibt damit erhalten, und der
       * Rest steht im Auftragstext.
       */
      const asNumber = typeof value === 'number' ? value : 0;
      result[key] = asNumber > 1 ? 1 : asNumber;
      continue;
    }

    result[key] = toStructuredOutputSchema(value);
  }

  return result;
}
