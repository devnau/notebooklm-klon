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
  expect: { timeout: 7_000 },

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
    command: 'npm run dev --workspace=@nlm/web',
    url: 'http://localhost:3000/anmelden',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
