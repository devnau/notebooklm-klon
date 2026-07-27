import { expect, test } from '@playwright/test';

import { createNotebook, register, uniqueUser } from './helpers';

/**
 * Die Content-Security-Policy.
 *
 * Eine CSP ist die Art Härtung, die man leicht einbaut und ebenso leicht
 * unbrauchbar macht: ein `'unsafe-inline'` bei `script-src`, und sie verhindert
 * genau nichts mehr. Umgekehrt bricht eine zu strenge Richtlinie die
 * Anwendung, ohne dass ein Test rot wird — die Seite erscheint, reagiert aber
 * auf nichts, weil die Hydration blockiert wurde.
 *
 * Deshalb hier beides: dass die Richtlinie streng ist, und dass die Anwendung
 * darunter funktioniert.
 */

test.describe('Sicherheits-Kopfzeilen', () => {
  test('die Richtlinie ist gesetzt und streng', async ({ page }) => {
    const response = await page.goto('/anmelden');
    const csp = response?.headers()['content-security-policy'] ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");

    // Der entscheidende Punkt: Skripte laufen nur mit Nonce. Das gilt in jeder
    // Betriebsart.
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  });

  test('der Produktionsbuild erlaubt kein unsafe-eval', async ({ page }) => {
    /*
     * Nur gegen den Produktionsbuild geprüft, und das ist keine Ausnahme,
     * sondern der Punkt: React braucht `eval()` im Entwicklungsmodus für
     * Fehler-Overlay und Hot Reload. Verbietet man es dort, erscheint die Seite,
     * aber der Dev-Server verliert genau die Eigenschaften, wegen derer man ihn
     * benutzt — was sich wie ein Absturz der Anwendung anfühlt und keiner ist.
     *
     * In der CI läuft der Produktionsbuild (siehe playwright.config.ts), lokal
     * der Dev-Server. Deshalb hängt die Prüfung an dieser Unterscheidung und
     * nicht an einer Vermutung über die Umgebung.
     */
    test.skip(
      !process.env.CI,
      'Läuft nur gegen den Produktionsbuild; lokal ist der Dev-Server aktiv.',
    );

    const response = await page.goto('/anmelden');
    const csp = response?.headers()['content-security-policy'] ?? '';

    expect(csp).not.toMatch(/script-src [^;]*'unsafe-eval'/);
  });

  test('jede Anfrage bekommt einen eigenen Nonce', async ({ page }) => {
    // Ein wiederverwendeter Nonce ist so gut wie keiner: wer ihn einmal
    // ausliest, kann beliebige Skripte nachreichen.
    const erste = (await page.goto('/anmelden'))?.headers()['content-security-policy'];
    const zweite = (await page.goto('/registrieren'))?.headers()['content-security-policy'];

    const nonce = (value: string | undefined) =>
      /'nonce-([A-Za-z0-9+/=]+)'/.exec(value ?? '')?.[1];

    expect(nonce(erste)).toBeTruthy();
    expect(nonce(zweite)).toBeTruthy();
    expect(nonce(erste)).not.toBe(nonce(zweite));
  });

  test('die weiteren Kopfzeilen stehen', async ({ page }) => {
    const headers = (await page.goto('/anmelden'))?.headers() ?? {};

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    // Verrät sonst, womit die Anwendung gebaut ist.
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('die Anwendung funktioniert unter der Richtlinie', async ({ page }) => {
    /*
     * Der eigentliche Test. Ein CSP-Verstoss erscheint als Konsolenfehler und
     * blockiert Skripte — ohne diese Prüfung fiele es erst auf, wenn jemand
     * die Anwendung öffnet und nichts klickbar ist.
     */
    const verstoesse: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/Content Security Policy|Refused to (execute|load|apply)/i.test(text)) {
        verstoesse.push(text);
      }
    });

    await register(page, uniqueUser());
    await createNotebook(page, 'CSP-Notebook');

    // Interaktion, die Hydration voraussetzt: reagiert die Seite nicht, ist
    // die Richtlinie zu streng.
    await page.getByRole('button', { name: 'Umbenennen' }).click();
    await expect(page.getByLabel('Titel')).toBeVisible();

    expect(verstoesse, verstoesse.join('\n')).toEqual([]);
  });
});
