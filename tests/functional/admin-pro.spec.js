const { test, expect } = require('@playwright/test');
const { createGitHubMock } = require('./helpers/github-stateful-mock');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.stack || error?.message || error)));
  return errors;
}
test('Admin Pro: import CSV prepara file canonico e anteprima di pubblicazione', async ({ page }) => {
  const mock = createGitHubMock();
  await mock.install(page);
  await mock.seedSession(page, true);
  const errors = watchErrors(page);

  await page.goto('/admin/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Importa CSV/ }).click();
  const picker = page.locator('.pro-drop input[type="file"]');
  await picker.setInputFiles({
    name: 'calendario_con_gol_vuoti.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'Giornata;Data;Squadra casa;Gol casa;Squadra trasferta;Gol trasferta',
      '1;2026-09-10;Alpha;;Beta;',
      '2;2026-09-17;Beta;;Alpha;'
    ].join('\n'))
  });
  const row = page.locator('.pro-table tbody tr').first();
  await expect(row).toContainText('Calendario');
  await expect(row).toContainText('calendario.csv');
  await page.getByRole('button', { name: /Prepara importazione/i }).click();
  await expect(page.getByRole('heading', { name: 'Pubblicazione', exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText('Anteprima modifiche');
  await expect(page.locator('body')).toContainText('calendario.csv');
  await expect(page.locator('body')).toContainText('manifest.csv');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Admin: selezionare un nuovo capitano deseleziona quello precedente', async ({ page }) => {
  const mock = createGitHubMock();
  await mock.install(page);
  await mock.seedSession(page, true);
  const errors = watchErrors(page);

  await page.goto('/admin/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Squadre/ }).click();
  await expect(page.getByRole('heading', { name: 'Squadre', exact: true })).toBeVisible();

  const captainChecks = page.locator('.team-editor .data-table tbody input[type="checkbox"]');
  await expect(captainChecks).toHaveCount(2);
  await expect(captainChecks.nth(0)).toBeChecked();
  await expect(captainChecks.nth(1)).not.toBeChecked();

  await captainChecks.nth(1).check();

  await expect(captainChecks.nth(0)).not.toBeChecked();
  await expect(captainChecks.nth(1)).toBeChecked();
  await expect(page.locator('.team-editor .data-table tbody input[type="checkbox"]:checked')).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Admin Pro: Promuovi esegue ADD/UPDATE/DELETE, copia binari e aggiorna lifecycle Produzione', async ({ page }) => {
  const mock = createGitHubMock();
  await mock.install(page);
  await mock.seedSession(page, true);
  const errors = watchErrors(page);
  await page.goto('/admin/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Promuovi/ }).click();
  await expect(page.getByRole('heading', { name: /Promuovi in Produzione/i })).toBeVisible();
  await page.getByRole('button', { name: /Confronta con Produzione/i }).click();
  await expect(page.locator('body')).toContainText(/Aggiunti in Produzione:/);
  await expect(page.locator('body')).toContainText(/Aggiornati:/);
  await expect(page.locator('body')).toContainText(/Eliminati perché non più presenti/);
  const makeCurrent = page.getByLabel(/Imposta come torneo corrente anche in Produzione/i);
  await makeCurrent.check();
  await page.getByPlaceholder('PROMUOVI PRODUZIONE').fill('PROMUOVI PRODUZIONE');
  await page.getByRole('button', { name: /Promuovi ora/i }).click();
  await expect(page.locator('body')).toContainText(/Promozione completata in Produzione/i, { timeout: 20_000 });
  const prefix = 'tornei/2026-test/';
  const src = [...mock.source.currentFiles()].filter(([p]) => p.startsWith(prefix));
  const dst = [...mock.production.currentFiles()].filter(([p]) => p.startsWith(prefix));
  expect(dst.map(([p]) => p).sort()).toEqual(src.map(([p]) => p).sort());
  expect(mock.production.readFile('tornei/2026-test/data/stale.csv')).toBeNull();
  expect(mock.production.readFile('tornei/2026-test/data/nuovo.csv')?.toString('utf8')).toContain('nuovo;si');
  expect(mock.production.readFile('tornei/2026-test/immagini/logo_cral.png')).toEqual(mock.source.readFile('tornei/2026-test/immagini/logo_cral.png'));
  const prodRegistry = JSON.parse(mock.production.readFile('tornei.json').toString('utf8'));
  const promoted = prodRegistry.tornei.find(t => t.cartella === 'tornei/2026-test');
  const old = prodRegistry.tornei.find(t => t.cartella === 'tornei/2025-old');
  expect(promoted.corrente).toBe(true);
  expect(promoted.stato).toBe('in-corso');
  expect(old.corrente).toBe(false);
  expect(old.stato).toBe('concluso');

  expect(errors, errors.join('\n')).toEqual([]);
});
test('Admin Pro: rollback ripristina la cartella e solo la entry del torneo in tornei.json', async ({ page }) => {
  const mock = createGitHubMock({ rollbackHistory: true });
  await mock.install(page);
  await mock.seedSession(page, true);
  const errors = watchErrors(page);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/admin/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Storico/ }).click();
  await expect(page.getByRole('heading', { name: /Storico e rollback/i })).toBeVisible();
  const rows = page.locator('.pro-history-row');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });
  await page.getByLabel(/Ripristina anche i metadati/i).check();
  await rows.nth(1).getByRole('button', { name: /Ripristina torneo/i }).click();
  await expect(page.locator('body')).toContainText(/Rollback completato/i, { timeout: 20_000 });
  expect(mock.source.readFile('tornei/2026-test/data/versione.txt')?.toString('utf8')).toBe('OLD\n');
  expect(mock.source.readFile('tornei/2026-test/data/extra-da-rimuovere.txt')).toBeNull();
  const registry = JSON.parse(mock.source.readFile('tornei.json').toString('utf8'));
  const restored = registry.tornei.find(t => t.cartella === 'tornei/2026-test');
  const future = registry.tornei.find(t => t.cartella === 'tornei/2027-futuro');
  expect(restored.titolo).toBe('Titolo storico');
  expect(restored.corrente).toBe(true);
  expect(future?.titolo).toBe('Futuro corrente da preservare');
  expect(errors, errors.join('\n')).toEqual([]);
});
