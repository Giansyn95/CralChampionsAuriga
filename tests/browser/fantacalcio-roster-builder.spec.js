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

async function forceRosterWindowOpen(page) {
  await page.route('**/tornei/2026-spring/data/config.csv*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      body: [
        'chiave;valore',
        'titolo;CRAL Champions - Auriga 2026',
        'sottotitolo;Fixture test',
        'fantacalcioCreazioneRosaEnabled;true',
        'fantacalcioCreazioneRosaOpenFrom;',
        'fantacalcioCreazioneRosaCloseAt;'
      ].join('\n') + '\n'
    });
  });
}

async function cheapestValidRoster(page) {
  const players = await page.locator('.player-card').evaluateAll(cards => cards.map(card => {
    const id = card.dataset.playerId || '';
    const role = (card.querySelector('.role-pill')?.textContent || '').trim();
    const meta = card.querySelector('.player-meta')?.textContent || '';
    const match = meta.match(/([0-9]+(?:[.,][0-9]+)?)\s*crediti/i);
    const credits = match ? Number(match[1].replace(',', '.')) : Number.POSITIVE_INFINITY;
    return { id, role, credits };
  }));

  const keepers = players.filter(p => p.role === 'PT').sort((a, b) => a.credits - b.credits || a.id.localeCompare(b.id));
  const movement = players.filter(p => p.role !== 'PT').sort((a, b) => a.credits - b.credits || a.id.localeCompare(b.id));
  expect(keepers.length).toBeGreaterThanOrEqual(1);
  expect(movement.length).toBeGreaterThanOrEqual(4);

  const chosen = [keepers[0], ...movement.slice(0, 4)];
  for (const player of chosen) {
    await page.locator(`.player-card[data-player-id="${player.id}"] .player-add`).click();
  }
  return chosen;
}

test('generatore rosa carica il listone ufficiale e produce un CSV compatibile', async ({ page }) => {
  const errors = collectLocalErrors(page);
  await forceRosterWindowOpen(page);

  const response = await page.goto('/tornei/2026-spring/crea-rosa.html', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);

  await expect(page.locator('#listoneStatus')).toContainText(/Listone ufficiale caricato.*giocatori.*budget 250 crediti/i);
  await expect(page.locator('#creditBudget')).toHaveText('250');
  await expect(page.getByText('Giornata 1', { exact: true })).toHaveCount(0);
  await page.locator('#participantName').fill('Filippo Capurso');

  // Non dipende dalle quotazioni del listone: sceglie automaticamente la rosa
  // valida piu' economica disponibile (1 PT + 4 giocatori di movimento).
  const chosen = await cheapestValidRoster(page);
  const expectedCredits = chosen.reduce((sum, player) => sum + player.credits, 0);

  await expect(page.locator('#validationStatus')).toContainText('Rosa valida');
  await expect(page.locator('#countTotal')).toHaveText('5/5');
  await expect(page.locator('#countPt')).toHaveText('1/1');
  await expect(page.locator('#countMovement')).toHaveText('4/4');
  await expect(page.locator('#creditUsed')).toHaveText(String(expectedCredits));

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadRoster').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('rosa_filippo_capurso.csv');
  const path = await download.path();
  const generated = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  expect(generated).toBe([
    'partecipante;idGiocatore',
    ...chosen.map(player => `Filippo Capurso;${player.id}`),
    ''
  ].join('\n'));
  expect(generated).not.toContain('giornata');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('il tab Fantacalcio espone il link al generatore senza alterare la navigazione esistente', async ({ page }) => {
  const errors = collectLocalErrors(page);
  await forceRosterWindowOpen(page);

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
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  expect(errors, errors.join('\n')).toEqual([]);
});


test('Crea la tua rosa resta nascosto se il manifest del torneo non contiene il listone Fantacalcio', async ({ page }) => {
  const errors = collectLocalErrors(page);
  await forceRosterWindowOpen(page);
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
