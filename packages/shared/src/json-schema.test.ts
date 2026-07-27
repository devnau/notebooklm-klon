import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ARTIFACT_SCHEMAS } from './artifacts.js';
import { toStructuredOutputSchema } from './json-schema.js';

/**
 * Diese Umwandlung ist der Unterschied zwischen „funktioniert" und „HTTP 400
 * beim ersten echten Aufruf". Gefunden wurde die Einschränkung genau so: alle
 * Unit-Tests grün, und dann lehnte die API jedes einzelne Artefaktschema ab.
 */

/** Sucht rekursiv nach einem Schlüssel — für die Prüfung, dass nichts übrig bleibt. */
function collect(value: unknown, key: string, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, key, found);
    return found;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (entryKey === key) found.push(entryValue);
      collect(entryValue, key, found);
    }
  }
  return found;
}

describe('Nicht unterstützte Angaben entfernen', () => {
  it('entfernt maxItems', () => {
    const converted = toStructuredOutputSchema({
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    });

    expect(collect(converted, 'maxItems')).toEqual([]);
  });

  it('senkt minItems auf 1', () => {
    const converted = toStructuredOutputSchema({ type: 'array', minItems: 3 });

    expect(collect(converted, 'minItems')).toEqual([1]);
  });

  it('lässt minItems 0 und 1 unverändert', () => {
    // Beide tragen eine Aussage: „darf leer sein" gegen „mindestens einer".
    expect(collect(toStructuredOutputSchema({ minItems: 0 }), 'minItems')).toEqual([0]);
    expect(collect(toStructuredOutputSchema({ minItems: 1 }), 'minItems')).toEqual([1]);
  });

  it('greift auch tief verschachtelt', () => {
    const converted = toStructuredOutputSchema({
      type: 'object',
      properties: {
        aussen: {
          type: 'array',
          minItems: 5,
          items: { type: 'array', maxItems: 8, minItems: 2 },
        },
      },
    });

    expect(collect(converted, 'maxItems')).toEqual([]);
    expect(collect(converted, 'minItems')).toEqual([1, 1]);
  });

  it('verändert das übergebene Schema nicht', () => {
    // Sonst hinge das Verhalten davon ab, ob vorher schon jemand konvertiert
    // hat — ein Fehler, der erst beim zweiten Aufruf auftritt.
    const original = { type: 'array', maxItems: 20, minItems: 3 };
    toStructuredOutputSchema(original);

    expect(original).toEqual({ type: 'array', maxItems: 20, minItems: 3 });
  });

  it('lässt alles andere unangetastet', () => {
    const converted = toStructuredOutputSchema({
      type: 'string',
      minLength: 1,
      maxLength: 200,
      pattern: '^[A-Z]',
      description: 'Ein Titel',
    });

    expect(converted).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 200,
      pattern: '^[A-Z]',
      description: 'Ein Titel',
    });
  });
});

describe('Alle Artefaktschemas', () => {
  it.each(Object.entries(ARTIFACT_SCHEMAS))(
    '%s enthält nach der Umwandlung nichts Unzulässiges',
    (_kind, schema) => {
      const converted = toStructuredOutputSchema(z.toJSONSchema(schema));

      expect(collect(converted, 'maxItems')).toEqual([]);
      for (const value of collect(converted, 'minItems')) {
        expect(value === 0 || value === 1).toBe(true);
      }
    },
  );
});
