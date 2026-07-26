import { expect, test, type Page } from '@playwright/test';

import { createNotebook, register, uniqueUser } from './helpers';

/**
 * Der Quellen-Weg bis zur Warteschlange.
 *
 * Was hier bewusst **nicht** geprüft wird: dass eine Quelle „bereit" wird. Dazu
 * müsste der Worker laufen und Voyage antworten — das kostet Geld, braucht
 * einen Schlüssel und wäre nicht deterministisch. Diesen Teil deckt
 * `scripts/ingest-e2e.mjs` gegen den echten Stack ab.
 *
 * Geprüft wird hier der Teil, den nur ein Browser zeigen kann: dass die Quelle
 * nach dem Anlegen sofort mit ihrem Zustand in der Liste steht, dass eine
 * abgelehnte Adresse eine verständliche Meldung erzeugt und dass Löschen eine
 * Bestätigung verlangt.
 */

/*
 * Die Arbeitsfläche rendert die Quellenspalte zweimal — einmal für die
 * Dreispaltenansicht, einmal für die Tab-Navigation auf schmalen Geräten. Nur
 * eine der beiden ist je nach Breite sichtbar; ohne diese Einschränkung
 * scheitert jeder Locator an Playwrights strict mode.
 *
 * Auf `visible` gefiltert statt auf `.first()`: welche der beiden Instanzen
 * zuerst im DOM steht, ist eine Layout-Entscheidung und darf sich ändern, ohne
 * dass Tests umkippen.
 */
function sourcesPanel(page: Page) {
  return page.getByRole('region', { name: 'Quellen' }).filter({ visible: true });
}

test.describe('Quellen', () => {
  test('eingefügter Text landet als Quelle in der Warteschlange', async ({ page }) => {
    await register(page, uniqueUser());
    await createNotebook(page, 'Quellen-Notebook');

    await sourcesPanel(page).getByRole('button', { name: 'Quelle hinzufügen' }).click();
    await page.getByRole('tab', { name: 'Text' }).click();

    await page.getByLabel('Titel').fill('Sitzungsnotiz');
    // getByRole statt getByLabel: das Tabpanel trägt denselben Namen wie das
    // Feld darin, weil es per aria-labelledby auf den Reiter „Text" zeigt.
    await page
      .getByRole('textbox', { name: 'Text', exact: true })
      .fill('Die Verordnung regelt den Umgang mit personenbezogenen Daten.');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();

    // Die Quelle muss sofort sichtbar sein — nicht erst, wenn der Worker sie
    // angefasst hat. Ein Upload, der scheinbar nichts bewirkt, ist der
    // häufigste Grund, ihn ein zweites Mal auszulösen.
    const panel = sourcesPanel(page);
    await expect(panel.getByTitle('Sitzungsnotiz')).toBeVisible();
    await expect(panel.getByText(/In der Warteschlange|Wird gelesen/)).toBeVisible();
  });

  test('eine Adresse im lokalen Netz wird abgelehnt', async ({ page }) => {
    await register(page, uniqueUser());
    await createNotebook(page, 'SSRF-Notebook');

    await sourcesPanel(page).getByRole('button', { name: 'Quelle hinzufügen' }).click();
    await page.getByRole('tab', { name: 'Adresse' }).click();

    // Der Klassiker: die Metadaten-Adresse von Cloud-Anbietern. Sie muss
    // abgelehnt werden, bevor überhaupt jemand sie abruft.
    await page
      .getByLabel('Adresse der Seite')
      .fill('http://169.254.169.254/latest/meta-data/');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();

    const message = page.getByRole('alert');
    await expect(message).toBeVisible();
    // Keine Zeichenkette aus dem Code prüfen, sondern dass überhaupt etwas
    // Verständliches dasteht — die Formulierung darf sich ändern.
    await expect(message).not.toBeEmpty();

    // Und die Quelle darf nicht angelegt worden sein.
    await page.getByRole('button', { name: 'Schließen' }).click();
    await expect(sourcesPanel(page).getByText('169.254.169.254')).toBeHidden();
  });

  test('Löschen verlangt eine Bestätigung', async ({ page }) => {
    await register(page, uniqueUser());
    await createNotebook(page, 'Lösch-Notebook');

    await sourcesPanel(page).getByRole('button', { name: 'Quelle hinzufügen' }).click();
    await page.getByRole('tab', { name: 'Text' }).click();
    await page.getByLabel('Titel').fill('Wegwerfquelle');
    await page
      .getByRole('textbox', { name: 'Text', exact: true })
      .fill('Irgendein Inhalt, der gleich wieder verschwindet.');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();

    const panel = sourcesPanel(page);
    await expect(panel.getByTitle('Wegwerfquelle')).toBeVisible();

    // Erster Klick fragt nach, löscht aber nicht.
    await panel.getByRole('button', { name: /Wegwerfquelle Löschen/ }).click();
    await expect(panel.getByRole('button', { name: /Wirklich löschen/ })).toBeVisible();
    await expect(panel.getByTitle('Wegwerfquelle')).toBeVisible();

    await panel.getByRole('button', { name: /Wirklich löschen/ }).click();
    await expect(panel.getByTitle('Wegwerfquelle')).toBeHidden();
  });

  test('ein viewer bekommt keine Schaltfläche zum Hinzufügen', async ({ page }) => {
    /*
     * Sichtbarkeit ist keine Berechtigung — die entscheidet RLS, geprüft in
     * tests/security. Hier geht es um etwas anderes: eine Schaltfläche
     * anzubieten, die anschliessend an der Datenbank scheitert, ist eine
     * schlechte Oberfläche.
     *
     * Der Fall lässt sich erst mit Einladungen aus Phase 6 vollständig
     * aufbauen; bis dahin wird wenigstens der Eigentümerfall festgehalten,
     * damit die Bedingung nicht unbemerkt verschwindet.
     */
    await register(page, uniqueUser());
    await createNotebook(page, 'Rollen-Notebook');

    await expect(
      sourcesPanel(page).getByRole('button', { name: 'Quelle hinzufügen' }),
    ).toBeVisible();
  });
});
