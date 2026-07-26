import { expect, type Page } from '@playwright/test';

/**
 * Jeder Test legt seinen eigenen Nutzer an. Kein geteilter Testnutzer: die
 * Tests laufen parallel, und ein gemeinsamer Nutzer würde sie über die
 * Notebook-Liste aneinander koppeln.
 */
export function uniqueUser() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return {
    email: `e2e-${suffix}@example.test`,
    password: 'e2e-test-passphrase-2026',
    displayName: `Test ${suffix.slice(0, 5)}`,
  };
}

export type TestUser = ReturnType<typeof uniqueUser>;

/** Registriert einen neuen Nutzer und wartet, bis die Notebook-Liste steht. */
export async function register(page: Page, user: TestUser): Promise<void> {
  await page.goto('/registrieren');
  await page.getByLabel('Anzeigename').fill(user.displayName);
  await page.getByLabel('E-Mail-Adresse').fill(user.email);
  await page.getByLabel('Passwort').fill(user.password);
  await page.getByRole('button', { name: 'Konto anlegen' }).click();

  await expect(page.getByRole('heading', { name: 'Notebooks', level: 1 })).toBeVisible();
}

export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail-Adresse').fill(user.email);
  await page.getByLabel('Passwort').fill(user.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Notebooks', level: 1 })).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Konto-Menü/ }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
}

/** Legt ein Notebook an und gibt dessen ID aus der URL zurück. */
export async function createNotebook(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: 'Neues Notebook', exact: true }).first().click();
  await page.getByLabel('Titel').fill(title);
  await page.getByRole('button', { name: 'Anlegen' }).click();

  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();

  const match = /\/notebooks\/([0-9a-f-]{36})/.exec(page.url());
  if (!match?.[1]) {
    throw new Error(`Keine Notebook-ID in der URL gefunden: ${page.url()}`);
  }
  return match[1];
}
