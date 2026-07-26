import { expect, test } from '@playwright/test';

import { register, signIn, signOut, uniqueUser } from './helpers';

test.describe('Authentifizierung', () => {
  test('Registrieren, abmelden, wieder anmelden', async ({ page }) => {
    const user = uniqueUser();

    await register(page, user);
    // Der Trigger in der Datenbank muss das Profil angelegt haben — sonst
    // stünde hier kein Name im Konto-Menü.
    await expect(page.getByRole('button', { name: /Konto-Menü/ })).toBeVisible();

    await signOut(page);
    await signIn(page, user);
  });

  test('geschützte Route leitet mit Rücksprungziel zur Anmeldung', async ({ page }) => {
    await page.goto('/notebooks');

    await expect(page).toHaveURL(/\/anmelden\?weiter=%2Fnotebooks/);
    await expect(
      page.getByRole('heading', { name: 'Anmelden', exact: true }),
    ).toBeVisible();
  });

  test('nach der Anmeldung geht es zum ursprünglichen Ziel weiter', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await signOut(page);

    await page.goto('/konto');
    await expect(page).toHaveURL(/\/anmelden\?weiter=%2Fkonto/);

    await page.getByLabel('E-Mail-Adresse').fill(user.email);
    await page.getByLabel('Passwort').fill(user.password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

    await expect(page).toHaveURL(/\/konto$/);
    await expect(page.getByRole('heading', { name: 'Profil', level: 1 })).toBeVisible();
  });

  test('falsches Passwort nennt nicht, ob die Adresse existiert', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await signOut(page);

    await page.getByLabel('E-Mail-Adresse').fill(user.email);
    await page.getByLabel('Passwort').fill('völlig-falsches-passwort-2026');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

    await expect(page.locator('main').getByRole('alert')).toContainText(
      'E-Mail-Adresse oder Passwort stimmen nicht',
    );

    // Dieselbe Meldung für eine nie registrierte Adresse: alles andere wäre
    // eine Auskunft darüber, welche Adressen ein Konto haben.
    await page.getByLabel('E-Mail-Adresse').fill('gibt-es-nicht@example.test');
    await page.getByLabel('Passwort').fill('völlig-falsches-passwort-2026');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(
      page.getByText('E-Mail-Adresse oder Passwort stimmen nicht.'),
    ).toBeVisible();
  });

  test('zu kurzes Passwort wird bei der Registrierung abgelehnt', async ({ page }) => {
    const user = uniqueUser();
    await page.goto('/registrieren');
    await page.getByLabel('E-Mail-Adresse').fill(user.email);
    await page.getByLabel('Passwort').fill('kurz');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();

    await expect(page.locator('main').getByRole('alert')).toContainText(
      'Mindestens 12 Zeichen',
    );
    await expect(page).toHaveURL(/\/registrieren/);
  });

  test('Anmeldelink verrät nicht, ob die Adresse registriert ist', async ({ page }) => {
    await page.goto('/anmelden');
    await page.getByRole('button', { name: 'Ohne Passwort anmelden' }).click();
    await page.getByLabel('E-Mail-Adresse').fill('unbekannt@example.test');
    await page.getByRole('button', { name: 'Anmeldelink senden' }).click();

    await expect(
      page.getByText(/Wenn ein Konto zu dieser Adresse existiert/),
    ).toBeVisible();
  });

  test('offene Weiterleitung über den weiter-Parameter ist nicht möglich', async ({
    page,
  }) => {
    const user = uniqueUser();
    await register(page, user);
    await signOut(page);

    // Absolute URL als Rücksprungziel: muss verworfen werden.
    await page.goto('/anmelden?weiter=https%3A%2F%2Ffremde-seite.example');
    await page.getByLabel('E-Mail-Adresse').fill(user.email);
    await page.getByLabel('Passwort').fill(user.password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

    await expect(page).toHaveURL(/localhost:3000\/notebooks$/);
  });

  test('protokollrelative URL als Rücksprungziel wird verworfen', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await signOut(page);

    // //fremde-seite ist protokollrelativ und damit ebenfalls extern.
    await page.goto('/anmelden?weiter=%2F%2Ffremde-seite.example');
    await page.getByLabel('E-Mail-Adresse').fill(user.email);
    await page.getByLabel('Passwort').fill(user.password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

    await expect(page).toHaveURL(/localhost:3000\/notebooks$/);
  });
});
