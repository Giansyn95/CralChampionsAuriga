const { test, expect } = require('@playwright/test');
const { createGitHubMock } = require('./helpers/github-stateful-mock');
const { failNextGitHubApi } = require('./helpers/github-api-failure');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.stack || error?.message || error)));
  return errors;
}

async function openAdmin(page, mock) {
  await mock.install(page);
  await mock.seedSession(page, true);
  await page.goto('/admin/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
}

async function stageSecondCaptain(page) {
  await page.getByRole('button', { name: /Squadre/ }).click();
  await expect(page.getByRole('heading', { name: 'Squadre', exact: true })).toBeVisible();
  const captainChecks = page.locator('.team-editor .data-table tbody input[type="checkbox"]');
  await expect(captainChecks).toHaveCount(2);
  await captainChecks.nth(1).check();
  await expect(captainChecks.nth(0)).not.toBeChecked();
  await expect(captainChecks.nth(1)).toBeChecked();
  await page.getByRole('button', { name: 'Salva rosa' }).click();
  await expect(page.locator('body')).toContainText(/pronta per la pubblicazione/i);
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

// -----------------------------------------------------------------------------
// Hardening produzione: failure path e persistenza end-to-end
// -----------------------------------------------------------------------------

test('Admin hardening: blocca la pubblicazione se il branch cambia dopo lo snapshot (409)', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  await stageSecondCaptain(page);

  const originalRoster = mock.source.readFile('tornei/2026-test/data/squadra_Alpha.csv').toString('utf8');
  const config = mock.source.readFile('tornei/2026-test/data/config.csv').toString('utf8');
  mock.source.commitChanges('main', [
    { path: 'tornei/2026-test/data/config.csv', content: `${config}modifica_esterna;si\n` }
  ], 'Modifica concorrente simulata');

  await page.locator('.sidebar .nav-btn').filter({ hasText: 'Pubblica' }).click();
  await expect(page.getByRole('heading', { name: 'Pubblicazione', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pubblica in collaudo' }).click();

  await expect(page.locator('body')).toContainText(/Pubblicazione bloccata/i, { timeout: 20_000 });
  await expect(page.locator('body')).toContainText(/Ricarica i dati prima di riprovare/i);
  await expect(page.getByRole('button', { name: 'Pubblica in collaudo' })).toBeVisible();
  expect(mock.source.readFile('tornei/2026-test/data/squadra_Alpha.csv').toString('utf8')).toBe(originalRoster);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Admin hardening: token scaduto/401 riporta alla schermata di accesso senza crash', async ({ page }) => {
  const mock = createGitHubMock();
  await mock.install(page);
  await mock.seedSession(page, true);
  await failNextGitHubApi(page, {
    status: 401,
    message: 'Bad credentials',
    method: 'GET',
    pathIncludes: '/git/ref/heads/main'
  });
  const errors = watchErrors(page);

  await page.goto('/admin/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'CRAL Admin' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('body')).toContainText(/token salvato non è più valido/i);
  await expect(page.getByRole('button', { name: 'Verifica e accedi' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Admin hardening: permessi insufficienti/403 non perdono le modifiche in sospeso', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  await stageSecondCaptain(page);

  const originalRoster = mock.source.readFile('tornei/2026-test/data/squadra_Alpha.csv').toString('utf8');
  await page.locator('.sidebar .nav-btn').filter({ hasText: 'Pubblica' }).click();
  await expect(page.getByRole('heading', { name: 'Pubblicazione', exact: true })).toBeVisible();
  const pendingRows = page.locator('.change-row');
  const pendingBefore = await pendingRows.count();
  expect(pendingBefore).toBeGreaterThan(0);

  await failNextGitHubApi(page, {
    status: 403,
    message: 'Resource not accessible by personal access token',
    method: 'GET',
    pathIncludes: '/git/ref/heads/main'
  });
  await page.getByRole('button', { name: 'Pubblica in collaudo' }).click();

  await expect(page.locator('body')).toContainText(/Resource not accessible by personal access token/i, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Pubblica in collaudo' })).toBeVisible();
  await expect(pendingRows).toHaveCount(pendingBefore);
  expect(mock.source.readFile('tornei/2026-test/data/squadra_Alpha.csv').toString('utf8')).toBe(originalRoster);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Admin hardening: il nuovo capitano persiste nel CSV dopo pubblicazione e reload', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);
  await stageSecondCaptain(page);

  await page.locator('.sidebar .nav-btn').filter({ hasText: 'Pubblica' }).click();
  await page.getByRole('button', { name: 'Pubblica in collaudo' }).click();
  await expect(page.locator('body')).toContainText(/Pubblicazione completata/i, { timeout: 20_000 });

  const roster = mock.source.readFile('tornei/2026-test/data/squadra_Alpha.csv').toString('utf8');
  const rosterLines = roster.trim().split(/\r?\n/);
  const rosterRows = Object.fromEntries(rosterLines.slice(1).map(line => {
    const columns = line.split(';');
    return [`${columns[0]} ${columns[1]}`, columns];
  }));
  expect(rosterRows['Mario Rossi']?.[4]).toBe('');
  expect(rosterRows['Luca Bianchi']?.[4]).toBe('SI');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Squadre/ }).click();
  const captainChecks = page.locator('.team-editor .data-table tbody input[type="checkbox"]');
  await expect(captainChecks).toHaveCount(2);
  await expect(captainChecks.nth(0)).not.toBeChecked();
  await expect(captainChecks.nth(1)).toBeChecked();
  await expect(page.locator('.team-editor .data-table tbody input[type="checkbox"]:checked')).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Admin hardening: crea un nuovo torneo atomico con file base, logo e registry coerente', async ({ page }) => {
  const mock = createGitHubMock();
  const errors = watchErrors(page);
  await openAdmin(page, mock);

  await page.getByRole('button', { name: /Nuovo torneo/ }).click();
  await expect(page.getByRole('heading', { name: 'Nuovo torneo', exact: true })).toBeVisible();

  const fields = page.locator('.wizard-grid .field');
  await fields.nth(0).locator('input').fill('2028');
  await fields.nth(1).locator('input').fill('Estate E2E');
  await fields.nth(2).locator('input').fill('2028-estate-e2e');
  await fields.nth(3).locator('input').fill('CRAL Champions - Estate E2E 2028');
  await fields.nth(4).locator('input').fill('Torneo creato dal test funzionale di hardening');

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Crea torneo' }).click();

  await expect(page.locator('body')).toContainText(/Torneo tornei\/2028-estate-e2e creato/i, { timeout: 20_000 });
  expect(mock.source.readFile('tornei/2028-estate-e2e/index.html')).not.toBeNull();
  expect(mock.source.readFile('tornei/2028-estate-e2e/data/config.csv')?.toString('utf8')).toContain('CRAL Champions - Estate E2E 2028');
  expect(mock.source.readFile('tornei/2028-estate-e2e/data/manifest.csv')?.toString('utf8')).toContain('classifica_squadre.csv');
  expect(mock.source.readFile('tornei/2028-estate-e2e/immagini/logo_cral.png')).toEqual(mock.source.readFile('tornei/2026-test/immagini/logo_cral.png'));

  const registry = JSON.parse(mock.source.readFile('tornei.json').toString('utf8'));
  const created = registry.tornei.find(t => t.id === '2028-estate-e2e');
  const previous = registry.tornei.find(t => t.id === '2026-test');
  expect(created).toMatchObject({
    anno: '2028',
    stagione: 'Estate E2E',
    cartella: 'tornei/2028-estate-e2e',
    titolo: 'CRAL Champions - Estate E2E 2028',
    corrente: true,
    attivo: true
  });
  expect(previous.corrente).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});
