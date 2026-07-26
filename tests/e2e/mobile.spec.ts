import { expect, test } from '@playwright/test';

import { createNotebook, register, uniqueUser } from './helpers';

/**
 * Unter der lg-Breite greift ein anderes Layout: Tabs statt drei Spalten.
 * Ohne eigenen Test würde dieser Zweig nie ausgeführt.
 */
test.describe('Mobiles Layout', () => {
  test('Arbeitsfläche nutzt Tabs statt Spalten', async ({ page }) => {
    await register(page, uniqueUser());
    await createNotebook(page, 'Mobil');

    const tablist = page.getByRole('tablist', { name: 'Arbeitsbereiche' });
    await expect(tablist).toBeVisible();

    // Der Chat ist der Standard — er ist der Grund, warum man die App öffnet.
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByRole('tab', { name: 'Quellen' }).click();
    await expect(page.getByRole('tab', { name: 'Quellen' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tabpanel')).toBeVisible();

    await page.getByRole('tab', { name: 'Studio' }).click();
    await expect(page.getByRole('tab', { name: 'Studio' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('Notebook anlegen funktioniert auf kleinem Bildschirm', async ({ page }) => {
    await register(page, uniqueUser());
    await createNotebook(page, 'Vom Telefon');
    await expect(page.getByRole('heading', { name: 'Vom Telefon' })).toBeVisible();
  });
});
