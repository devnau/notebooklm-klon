import { expect, test } from '@playwright/test';

import { createNotebook, register, signOut, uniqueUser } from './helpers';

test.describe('Notebooks', () => {
  test('anlegen, umbenennen, löschen', async ({ page }) => {
    await register(page, uniqueUser());

    const id = await createNotebook(page, 'Erstes Notebook');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // Umbenennen
    await page.getByRole('button', { name: 'Umbenennen' }).click();
    await page.getByLabel('Titel').fill('Umbenanntes Notebook');
    await page.getByRole('button', { name: 'Speichern' }).click();

    await expect(
      page.getByRole('heading', { name: 'Umbenanntes Notebook', level: 1 }),
    ).toBeVisible();

    // Löschen — mit Bestätigung, weil es alle Inhalte mitnimmt.
    await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Notebook löschen' }).click();
    await expect(page.getByRole('heading', { name: 'Notebook löschen?' })).toBeVisible();
    await page.getByRole('button', { name: 'Endgültig löschen' }).click();

    await expect(page).toHaveURL(/\/notebooks$/);
    await expect(page.getByText('Umbenanntes Notebook')).toBeHidden();
  });

  test('leerer Zustand bietet den nächsten Schritt an', async ({ page }) => {
    await register(page, uniqueUser());

    await expect(page.getByRole('heading', { name: 'Noch kein Notebook' })).toBeVisible();
    // Nicht nur feststellen, dass nichts da ist — die Aktion muss dabeistehen.
    await expect(
      page.getByRole('button', { name: 'Neues Notebook', exact: true }).first(),
    ).toBeVisible();
  });

  test('Titel ist verpflichtend', async ({ page }) => {
    await register(page, uniqueUser());

    await page.getByRole('button', { name: 'Neues Notebook', exact: true }).first().click();
    await page.getByLabel('Titel').fill('   ');
    await page.getByRole('button', { name: 'Anlegen' }).click();

    // Der Dialog rendert in einem Portal außerhalb von <main>, deshalb hier
    // der Dialog als Bezug und nicht main.
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      'Bitte einen Titel eingeben',
    );
  });

  test('Arbeitsfläche zeigt alle drei Bereiche', async ({ page }) => {
    await register(page, uniqueUser());
    await createNotebook(page, 'Arbeitsfläche');

    // Auf dem Desktop-Viewport sind alle drei Spalten gleichzeitig sichtbar —
    // das ist der Kern des Layouts, nicht Beiwerk.
    await expect(page.getByRole('region', { name: 'Quellen' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Chat' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Studio' })).toBeVisible();
  });

  test('fremdes Notebook ist nicht erreichbar', async ({ page, browser }) => {
    // Nutzer A legt ein Notebook an.
    const userA = uniqueUser();
    await register(page, userA);
    const id = await createNotebook(page, 'Privat von A');

    // Nutzer B in einem eigenen Browser-Kontext: eigene Cookies, eigene Session.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await register(pageB, uniqueUser());

    await pageB.goto(`/notebooks/${id}`);

    // 404 und nicht 403: ob die ID existiert, ist selbst eine Information.
    await expect(pageB.getByRole('heading', { name: 'Nicht gefunden' })).toBeVisible();
    await expect(pageB.getByText('Privat von A')).toBeHidden();

    await contextB.close();
  });

  test('nach dem Abmelden ist das Notebook nicht mehr abrufbar', async ({ page }) => {
    await register(page, uniqueUser());
    const id = await createNotebook(page, 'Nach dem Abmelden');

    await page.goto('/notebooks');
    await signOut(page);

    await page.goto(`/notebooks/${id}`);
    await expect(page).toHaveURL(new RegExp(`/anmelden\\?weiter=%2Fnotebooks%2F${id}`));
  });
});
