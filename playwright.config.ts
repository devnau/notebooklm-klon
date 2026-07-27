import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-Tests gegen die laufende App und einen echten Supabase-Stack.
 *
 * Bewusst keine Mocks: geprüft werden soll, ob Auth, RLS und die Formulare
 * tatsächlich zusammenspielen. Ein Test gegen einen gemockten Client würde
 * genau die Fehler nicht finden, die hier teuer sind.
 *
 * Voraussetzung: docker compose up -d --wait
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Auf CI kein retry-Ausblenden von Flakiness: ein instabiler Test ist ein
  // Fehler im Test, nicht in der Anwendung. Lokal ebenfalls null.
  retries: process.env.CI ? 1 : 0,
  // In der CI feste Anzahl, lokal die Standardheuristik von Playwright.
  // `exactOptionalPropertyTypes` verbietet ein explizites undefined, deshalb
  // wird das Feld weggelassen statt auf undefined gesetzt.
  ...(process.env.CI ? { workers: 2 } : {}),
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  /*
   * In der CI grosszügiger. Der Läufer teilt sich die Maschine mit dem
   * gesamten Docker-Stack; eine Seite, die lokal in 300 ms steht, braucht dort
   * gelegentlich mehrere Sekunden. Ein Test, der daran scheitert, meldet keinen
   * Fehler in der Anwendung, sondern verbrennt Zeit mit Wiederholungen.
   *
   * Lokal bleibt es knapp: dort soll ein träger Aufruf auffallen.
   */
  expect: { timeout: process.env.CI ? 15_000 : 7_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Das mobile Layout gehört ins eigene Projekt: im Desktop-Viewport sind
      // die Tabs ausgeblendet, der Test würde dort zwangsläufig scheitern.
      testIgnore: /.*mobile\.spec\.ts/,
    },
    {
      // Eigenes Projekt für die Tab-Navigation der Arbeitsfläche: unter lg
      // greift ein anderes Layout, das sonst nie getestet würde.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /.*mobile\.spec\.ts/,
    },
  ],

  webServer: {
    /*
     * In der CI gegen den Produktionsbuild, lokal gegen den Dev-Server.
     *
     * Der Grund ist nicht Geschwindigkeit um ihrer selbst willen: der
     * Dev-Server kompiliert jede Route beim ersten Aufruf, und mit dem
     * Studio-Panel aus Phase 4 — Markdown-Renderer, Mermaid im Modulgraphen —
     * dauerte das auf einem ausgelasteten Läufer länger als jede vertretbare
     * Wartezeit. Die Tests scheiterten damit an der Übersetzung, nicht an der
     * Anwendung.
     *
     * Gestartet wird über `node apps/web/server.js` — dieselbe Zeile wie im
     * Produktionsimage. `next start` warnt bei `output: standalone`
     * ausdrücklich, dass es dafür nicht vorgesehen ist, und liefert trotzdem
     * aus; damit würde die CI einen anderen Server prüfen als den
     * ausgelieferten. Die Kopierschritte für `.next/static` und `public`
     * stecken in scripts/start-standalone.sh.
     *
     * Lokal bleibt der Dev-Server, weil ein Build vor jedem Testlauf die
     * Rückkopplung zerstören würde.
     *
     * @nlm/shared wird über das exports-Feld aus dist/ geladen. In einem
     * frischen Checkout existiert dist/ nicht, und der Server bricht beim
     * ersten Import ab — lokal fällt das nicht auf, weil dist/ dort meist schon
     * liegt. Genau daran ist der E2E-Job in der CI schon einmal gescheitert.
     */
    command: process.env.CI
      ? 'npm run build --workspace=@nlm/shared && npm run build --workspace=@nlm/web && npm run start:standalone'
      : 'npm run build --workspace=@nlm/shared && npm run dev --workspace=@nlm/web',
    url: 'http://localhost:3000/anmelden',
    reuseExistingServer: !process.env.CI,
    // Der Produktionsbuild in der CI braucht mehr als zwei Minuten Anlauf.
    timeout: process.env.CI ? 300_000 : 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
