import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createNotebook, register, uniqueUser } from './helpers';

/**
 * Barrierefreiheit wird geprüft, nicht behauptet. axe findet nicht alles —
 * Tastaturführung und sinnvolle Beschriftungen prüfen die Tests darunter
 * zusätzlich von Hand.
 */
async function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
}

test.describe('Barrierefreiheit', () => {
  test('Anmeldeseite ohne Verstöße', async ({ page }) => {
    await page.goto('/anmelden');
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test('Registrierung ohne Verstöße', async ({ page }) => {
    await page.goto('/registrieren');
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test('Notebook-Übersicht ohne Verstöße', async ({ page }) => {
    await register(page, uniqueUser());
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test('Arbeitsfläche ohne Verstöße', async ({ page }) => {
    await register(page, uniqueUser());
    await createNotebook(page, 'Barrierefreiheit');
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test('Dialog „Quelle hinzufügen" ohne Verstöße', async ({ page }) => {
    /*
     * Die Reiterleiste ist von Hand gebaut (role="tablist" mit
     * aria-selected/aria-controls). Genau bei solchen Konstruktionen fällt
     * etwas aus — eine fehlende Verknüpfung sieht man nicht, aber ein
     * Screenreader liest dann drei Schaltflächen ohne Zusammenhang.
     */
    await register(page, uniqueUser());
    await createNotebook(page, 'Dialog-Prüfung');

    await page
      .getByRole('region', { name: 'Quellen' })
      .filter({ visible: true })
      .getByRole('button', { name: 'Quelle hinzufügen' })
      .click();

    for (const reiter of ['Datei', 'Adresse', 'Text']) {
      await page.getByRole('tab', { name: reiter }).click();
      const { violations } = await scan(page);
      expect(violations, `${reiter}: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
    }
  });

  test('Studio-Spalte ohne Verstöße', async ({ page }) => {
    // Die Studio-Spalte kam mit Phase 4 und 5 dazu: Übersichten mit
    // aufklappbaren Karten, Notizen, Audio-Player. Bis dahin deckte der Scan
    // der Arbeitsfläche einen Platzhalter ab.
    await register(page, uniqueUser());
    await createNotebook(page, 'Studio-Prüfung');

    const studio = page.getByRole('region', { name: 'Studio' }).filter({ visible: true });
    await expect(studio).toBeVisible();

    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test('neue Notiz: Formular ist beschriftet und bedienbar', async ({ page }) => {
    await register(page, uniqueUser());
    await createNotebook(page, 'Notiz-Prüfung');

    const studio = page.getByRole('region', { name: 'Studio' }).filter({ visible: true });
    await studio.getByRole('button', { name: 'Neu' }).click();

    // Beide Felder müssen über ihre Beschriftung erreichbar sein — sie sind
    // visuell versteckt, weil das Formular klein ist, und genau dann wird das
    // Label gern vergessen.
    await expect(studio.getByLabel('Titel der Notiz')).toBeVisible();
    await expect(studio.getByLabel('Inhalt der Notiz')).toBeVisible();

    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test('Sprunglink ist der erste fokussierbare Punkt und funktioniert', async ({
    page,
  }) => {
    await page.goto('/anmelden');

    /*
     * Geprüft wird die Reihenfolge im DOM statt „erster Tab-Druck": wo der
     * Browser den Fokus direkt nach dem Laden hat, ist nicht Teil der
     * Anwendung und in Playwright nicht verlässlich reproduzierbar. Die Zusage
     * lautet: der Sprunglink kommt vor allem anderen Fokussierbaren.
     */
    const firstFocusable = await page.evaluate(() => {
      const selector =
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
      const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
      return elements[0]?.textContent?.trim() ?? null;
    });
    expect(firstFocusable).toBe('Zum Hauptinhalt springen');

    // Und er tut, was er verspricht.
    const skipLink = page.getByRole('link', { name: 'Zum Hauptinhalt springen' });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('Anmeldeformular ist mit der Tastatur durchlaufbar', async ({ page }) => {
    await page.goto('/anmelden');

    await page.getByLabel('E-Mail-Adresse').focus();
    await page.keyboard.type('tastatur@example.test');

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Passwort')).toBeFocused();
    await page.keyboard.type('irgendein-passwort-2026');

    // Abschicken mit Enter muss funktionieren — ein Formular, das sich nur per
    // Mausklick auf die Schaltfläche abschicken lässt, ist für Tastaturnutzer
    // kaputt.
    await page.keyboard.press('Enter');
    await expect(page.locator('main').getByRole('alert')).toBeVisible();
  });

  test('Dialog fängt den Fokus und schließt mit Escape', async ({ page }) => {
    await register(page, uniqueUser());
    await page.getByRole('button', { name: 'Neues Notebook', exact: true }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Radix setzt den Fokus in den Dialog; das Titelfeld hat autoFocus.
    await expect(page.getByLabel('Titel')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('Fehlermeldung ist mit dem Feld verknüpft', async ({ page }) => {
    await page.goto('/registrieren');
    await page.getByLabel('E-Mail-Adresse').fill('keine-email');
    await page.getByLabel('Passwort').fill('kurz');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();

    // aria-invalid und aria-describedby müssen gesetzt sein, sonst hört ein
    // Screenreader-Nutzer die Fehlermeldung nicht am Feld.
    const email = page.getByLabel('E-Mail-Adresse');
    await expect(email).toHaveAttribute('aria-invalid', 'true');

    const describedBy = await email.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveAttribute('role', 'alert');
  });
});
