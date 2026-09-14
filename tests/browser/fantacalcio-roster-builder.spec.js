const { test, expect } = require('@playwright/test');
const fs = require('fs');

function collectLocalErrors(page) {
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === 'http://127.0.0.1:4173' && response.status() >= 400) {
      errors.push(`${response.status()} ${url.pathname}`);
    }
  });
  return errors;
}

test('generatore rosa carica il listone ufficiale e produce un CSV compatibile', async ({ page }) => {
  const errors = collectLocalErrors(page);
  const response = await page.goto('/tornei/2026-spring/crea-rosa.html', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);

  await expect(page.locator('#listoneStatus')).toContainText('35 giocatori');
  await expect(page.locator('#creditBudget')).toHaveText('250');
  await expect(page.getByText('Giornata 1', { exact: true })).toHaveCount(0);
  await page.locator('#participantName').fill('Filippo Capurso');

  for (const id of ['001', '010', '021', '028', '030']) {
    await page.locator(`.player-card[data-player-id="${id}"] .player-add`).click();
  }

  await expect(page.locator('#validationStatus')).toContainText('Rosa valida');
  await expect(page.locator('#countTotal')).toHaveText('5/5');
  await expect(page.locator('#countPt')).toHaveText('1/1');
  await expect(page.locator('#countMovement')).toHaveText('4/4');
  await expect(page.locator('#creditUsed')).toHaveText('48');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadRoster').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('rosa_filippo_capurso.csv');
  const path = await download.path();
  const generated = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  expect(generated).toBe([
    'partecipante;idGiocatore',
    'Filippo Capurso;001',
    'Filippo Capurso;010',
    'Filippo Capurso;021',
    'Filippo Capurso;028',
    'Filippo Capurso;030',
    ''
  ].join('\n'));
  expect(generated).not.toContain('giornata');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('il tab Fantacalcio espone il link al generatore senza alterare la navigazione esistente', async ({ page }) => {
  const errors = collectLocalErrors(page);
  await page.goto('/tornei/2026-spring/', { waitUntil: 'domcontentloaded' });
  await page.locator('#tab-fantacalcio').click();
  await expect(page.locator('#fantacalcio.active')).toBeVisible();
  const link = page.locator('.fanta-roster-creator-link');
  const intro = page.locator('.fanta-claim');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'crea-rosa.html');
  await expect(intro).toContainText('Scegli la giornata');
  const order = await page.locator('.fanta-card-shell').evaluate(card => {
    const cta = card.querySelector('.fanta-roster-creator-cta');
    const claim = card.querySelector('.fanta-claim');
    return !!cta && !!claim && Boolean(cta.compareDocumentPosition(claim) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});


test('Crea la tua rosa resta nascosto se il manifest del torneo non contiene il listone Fantacalcio', async ({ page }) => {
  const errors = collectLocalErrors(page);
  await page.route('**/tornei/2026-spring/data/manifest.csv*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      body: 'file\nclassifica_squadre.csv\nclassifica_marcatori.csv\ncalendario_andata_ritorno.csv\n'
    });
  });
  await page.goto('/tornei/2026-spring/', { waitUntil: 'domcontentloaded' });
  await page.locator('#tab-fantacalcio').click();
  await expect(page.locator('#fantacalcio.active')).toBeVisible();
  await expect(page.locator('.fanta-roster-creator-link')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  expect(errors.filter(e => !/fantacalcio\/(?:manifest_fantacalcio|listone_fantacalcio|eventi_fantacalcio)/.test(e)), errors.join('\n')).toEqual([]);
});

test('Crea la tua rosa resta nascosto quando l Admin disabilita la finestra', async ({ page }) => {
  const errors = collectLocalErrors(page);
  await page.route('**/tornei/2026-spring/data/config.csv*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      body: [
        'chiave;valore',
        'titolo;CRAL Champions - Auriga 2026',
        'sottotitolo;Fixture timer',
        'fantacalcioCreazioneRosaEnabled;false'
      ].join('\n') + '\n'
    });
  });
  await page.goto('/tornei/2026-spring/', { waitUntil: 'domcontentloaded' });
  await page.locator('#tab-fantacalcio').click();
  await expect(page.locator('#fantacalcio.active')).toBeVisible();
  await expect(page.locator('.fanta-roster-creator-link')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('link diretto crea-rosa applica lo stesso blocco configurato dall Admin', async ({ page }) => {
  const errors = collectLocalErrors(page);
  await page.route('**/tornei/2026-spring/data/config.csv*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      body: 'chiave;valore\nfantacalcioCreazioneRosaEnabled;false\n'
    });
  });
  await page.goto('/tornei/2026-spring/crea-rosa.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#listoneStatus')).toContainText(/disabilitata dall'admin/i);
  await expect(page.locator('#downloadRoster')).toBeDisabled();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  expect(errors, errors.join('\n')).toEqual([]);
});
