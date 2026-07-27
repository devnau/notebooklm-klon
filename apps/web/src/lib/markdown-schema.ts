import { defaultSchema, type Schema } from 'hast-util-sanitize';

/**
 * Was aus Markdown gerendert werden darf.
 *
 * Grundlage ist das Standardschema von `hast-util-sanitize` — im Wesentlichen
 * die Liste, die GitHub für Kommentare verwendet. Zwei Einschränkungen kommen
 * dazu:
 *
 * **Keine Bilder und keine eingebetteten Medien.** Sie würden externe Adressen
 * laden und damit die IP-Adresse jedes Lesers an einen fremden Server melden,
 * sobald jemand ein `![](https://…)` in eine Notiz schreibt. In einer
 * Anwendung, in der Leute vertrauliche Dokumente ablegen, ist das kein guter
 * Tausch — und ein Bild in einer Notiz ist selten das, worum es geht.
 *
 * **Nur http, https und mailto als Protokoll.** Damit sind `javascript:` und
 * `data:` ausgeschlossen. Das Standardschema deckt das bereits ab; die Liste
 * steht hier trotzdem ausdrücklich, weil sie sich sonst mit einer neuen Version
 * der Bibliothek stillschweigend ändern könnte.
 *
 * Als eigenes Modul ohne React, damit die Grenze ohne Browserumgebung prüfbar
 * ist. Bei einer Sicherheitsentscheidung reicht ein Kommentar nicht.
 */

const BLOCKED_TAGS = ['img', 'input', 'video', 'audio', 'iframe', 'object', 'embed'];

export const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => !BLOCKED_TAGS.includes(tag)),
  attributes: {
    ...defaultSchema.attributes,
    /*
     * `target` und `rel` an Links: nicht zur Zierde. Ein Link aus fremdem
     * Inhalt soll die Anwendung nicht ersetzen, und `noopener` verhindert, dass
     * die geöffnete Seite über `window.opener` auf unsere zugreift.
     */
    a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
};
