const { test, expect } = require('@playwright/test');
const fs = require('fs');

const registry = JSON.parse(fs.readFileSync('tornei.json', 'utf8'));
const torneo = registry.tornei.find(t => t.attivo !== false);
const torneoUrl = torneo ? '/' + String(torneo.url || `${torneo.cartella}/`).replace(/^\/+/, '') : '/';

function onlyChromium(testInfo) {
  test.skip(testInfo.project.name !== 'chromium', 'Test di strategia cache eseguito una volta su Chromium');
  test.skip(!torneo, 'Nessun torneo attivo');
}

test('Fantacalcio cache-first: il primo rendering non attende le rose live', async ({ page }, testInfo) => {
  onlyChromium(testInfo);

  let rosterCompleted = 0;
  await page.route(/\/data\/fantacalcio\/giornata\d+\//i, async route => {
    // Simula una rete lenta per le molte rose. Se il tab le attendesse ancora,
    // la tabella non potrebbe comparire entro il timeout dell'assert qui sotto.
    await new Promise(resolve => setTimeout(resolve, 5000));
    const response = await route.fetch();
    rosterCompleted++;
    await route.fulfill({ response });
  });

  await page.goto(torneoUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#tab-fantacalcio')).toBeVisible({ timeout: 5000 });
  await page.locator('#tab-fantacalcio').click();

  await expect(page.locator('#fantacalcio.active .fanta-results-wrap')).toBeVisible({ timeout: 2000 });
  const debug = await page.evaluate(() => window.__cralFantaDebug?.());
  expect(debug?.source).toBe('precalcolata');
  expect(Object.keys(debug?.final?.days || {}).length).toBeGreaterThan(0);
  expect(rosterCompleted, 'Il primo paint non deve attendere risposte delle rose live').toBe(0);
});

test('Fantacalcio fallback: senza cache precalcolata usa correttamente le rose live', async ({ page }, testInfo) => {
  onlyChromium(testInfo);

  await page.route(/\/data\/fantacalcio\/fantacalcio_cache\.json(?:\?.*)?$/i, route =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  );

  await page.goto(torneoUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#tab-fantacalcio')).toBeVisible({ timeout: 15000 });
  await page.locator('#tab-fantacalcio').click();
  await expect(page.locator('#fantacalcio.active .fanta-results-wrap')).toBeVisible({ timeout: 15000 });

  const debug = await page.evaluate(() => window.__cralFantaDebug?.());
  expect(debug?.source).not.toBe('precalcolata');
  expect(['calcolata', 'ibrida', 'importata']).toContain(debug?.source);
  expect(Object.keys(debug?.final?.days || {}).length).toBeGreaterThan(0);
  expect(debug?.rosterDays?.length || 0).toBeGreaterThan(0);
});

test('Fantacalcio refresh manuale forza il bypass cache con cache-buster', async ({ page }, testInfo) => {
  onlyChromium(testInfo);

  const cacheRequests = [];
  page.on('request', request => {
    if (/\/data\/fantacalcio\/fantacalcio_cache\.json/i.test(request.url())) cacheRequests.push(request.url());
  });

  await page.goto(torneoUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#btnRefresh')).toBeVisible();
  await page.locator('#btnRefresh').click();

  await expect.poll(
    () => cacheRequests.some(url => /fantacalcio_cache\.json\?t=\d+/i.test(url)),
    { timeout: 10000, message: 'Il refresh manuale deve richiedere la cache Fantacalcio con ?t=<timestamp>' }
  ).toBeTruthy();
});
