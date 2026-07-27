/**
 * Content-Security-Policy mit Nonce.
 *
 * Die CSP steht hier und nicht in der Caddy-Konfiguration, weil sie einen
 * **Nonce pro Anfrage** braucht: Next.js gibt eigene Skripte inline aus
 * (Hydration, Routendaten), und ohne Nonce bliebe nur `'unsafe-inline'` — was
 * die Richtlinie gegen genau die Angriffe wirkungslos macht, wegen derer man
 * sie aufstellt. Ein statischer Header im Reverse Proxy kann das nicht
 * leisten.
 *
 * Next erkennt den Nonce selbst, wenn er im CSP-Header steht, und setzt ihn an
 * seine Skript-Elemente. Dafür muss der Header auf der *Anfrage* mitgegeben
 * werden, nicht nur auf der Antwort — daher die zwei Stellen unten.
 */

/**
 * Warum `'unsafe-inline'` bei `style-src` bleibt.
 *
 * Zwei Stellen brauchen es und beide lassen sich nicht mit Nonce versorgen:
 * React setzt `style`-Attribute für Fortschrittsbalken und Panelbreiten, und
 * Mermaid erzeugt beim Zeichnen eigene Stilblöcke. Inline-Styles sind zudem
 * eine deutlich kleinere Angriffsfläche als Inline-Skripte — sie können Daten
 * abgreifen, aber keinen Code ausführen.
 *
 * `style-src-attr` liesse sich theoretisch trennen; solange Mermaid Stilblöcke
 * erzeugt, brächte das nichts.
 */
/**
 * @param entwicklung Im Dev-Betrieb wird `'unsafe-eval'` erlaubt.
 *
 * **Nicht aus Bequemlichkeit.** React braucht `eval()` im Entwicklungsmodus für
 * seine Debugging-Werkzeuge — Fehler-Overlay, rekonstruierte Aufrufstapel, Hot
 * Reload. Ohne die Erlaubnis erscheint die Seite, aber der Dev-Server verliert
 * genau die Eigenschaften, wegen derer man ihn benutzt: ein Fehler zeigt kein
 * Overlay, sondern nur eine CSP-Meldung in der Konsole. Das sieht aus wie ein
 * Absturz der Anwendung und ist keiner.
 *
 * Im Produktionsbuild bleibt es aus. React verwendet `eval()` dort nicht, und
 * `'unsafe-eval'` in einer ausgelieferten Richtlinie würde einen guten Teil
 * ihres Zwecks aufheben. Der Unterschied ist geprüft: der E2E-Test läuft in der
 * CI gegen den Produktionsbuild und besteht darauf, dass es dort fehlt.
 */
export function contentSecurityPolicy(
  nonce: string,
  supabaseOrigin: string,
  entwicklung = false,
): string {
  const directives = [
    `default-src 'self'`,
    /*
     * `'strict-dynamic'` erlaubt Skripten, die über einen genehmigten Nonce
     * geladen wurden, weitere nachzuladen — genau das tut Next beim Aufteilen
     * in Bündel. Ohne die Angabe müsste jede Bündeladresse einzeln aufgeführt
     * werden.
     *
     * Ältere Browser ignorieren `'strict-dynamic'` und fallen auf `'self'`
     * zurück; deshalb steht es zusätzlich da.
     */
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${entwicklung ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    // `data:` für die Favicons und für SVG, das Mermaid erzeugt.
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    /*
     * Die Anwendung spricht ausschliesslich mit sich selbst und mit Supabase.
     * Anthropic und Voyage werden vom Server gerufen, nie vom Browser — stünden
     * sie hier, wäre das ein Hinweis darauf, dass ein Schlüssel im Bundle
     * gelandet ist.
     */
    `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace(/^http/, 'ws')}`,
    // Die signierten Storage-Adressen liefern die Audiodateien aus.
    `media-src 'self' ${supabaseOrigin} blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // Formulare dürfen nirgendwo anders hin abgeschickt werden.
    `form-action 'self'`,
    // Doppelt zu X-Frame-Options, aber die moderne und genauere Variante.
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];

  return directives.join('; ');
}

/**
 * Erzeugt einen Nonce.
 *
 * `crypto.randomUUID()` wäre bequemer, ist aber kein Zufall in der Menge, die
 * eine CSP verlangt — eine UUID v4 hat 122 Bit, und davon sind Teile
 * strukturell festgelegt. 128 Bit aus `getRandomValues` sind es wirklich.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
