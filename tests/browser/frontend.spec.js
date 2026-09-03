const { test, expect } = require('@playwright/test');
const fs = require('fs');

const registry = JSON.parse(fs.readFileSync('tornei.json', 'utf8'));
const active = registry.tornei.filter(t => t.attivo !== false);

function isExpectedServiceWorkerProbe(url, response) {
  // Il frontend prova più path relativi prima di arrivare al service worker
  // globale /sw.js. I 404 dei candidati intermedi sono quindi fallback attesi,
  // non errori funzionali.
  return response.status() === 404 && /\/sw\.js$/i.test(url.pathname) && url.pathname !== '/sw.js';
}

function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('response', response => {
    const url = new URL(response.url());
    const critical = ['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(response.request().resourceType());
    if (
      url.origin === 'http://127.0.0.1:4173' &&
      critical &&
      response.status() >= 400 &&
      !isExpectedServiceWorkerProbe(url, response)
    ) {
      errors.push(`${response.status()} ${url.pathname}`);
    }
  });
  return errors;
}

test('landing page carica senza errori locali critici', async ({ page, request }) => {
  const errors = collectRuntimeErrors(page);
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).not.toBeEmpty();
  await page.waitForTimeout(1200);

  // Il service worker vero deve comunque esistere alla root.
  const sw = await request.get('/sw.js');
  expect(sw.status(), 'Il service worker globale /sw.js deve esistere').toBe(200);

  expect(errors, errors.join('\n')).toEqual([]);
});

for (const torneo of active) {
  test(`frontend torneo ${torneo.id} carica dati e navigazione`, async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const url = '/' + String(torneo.url || `${torneo.cartella}/`).replace(/^\/+/, '');
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(1800);

    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(100);
    expect(text).toMatch(/Calendario|Classifica|Squadre|Risultati/i);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('layout mobile non crea overflow orizzontale della pagina', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'Specifico per progetto iPhone');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(m.scrollWidth, `Overflow orizzontale: viewport=${m.width}, document=${m.scrollWidth}`).toBeLessThanOrEqual(m.width + 2);
});
