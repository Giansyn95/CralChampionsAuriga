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

test('Hall of Fame dalla landing aggrega le edizioni concluse', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hallOpenBtn').click();
  await expect(page.locator('#hallPanel')).toBeVisible();
  const completed = registry.tornei.filter(t => t.attivo !== false && /conclus/i.test(String(t.stato || '')));
  if (completed.length) {
    await expect(page.locator('.hall-edition').first()).toBeVisible();
    expect(await page.locator('.hall-record').count()).toBeGreaterThan(0);
  }
  expect(errors, errors.join('\n')).toEqual([]);

  // Deep link diretto: la Hall of Fame deve essere apribile anche condividendo l'URL.
  await page.goto('/#hall-of-fame', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#hallPanel')).toBeVisible();
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

    // Landing intelligente: torneo aperto -> Pulse, torneo concluso -> Home/Dashboard.
    const expectedLanding = await page.evaluate(() => isTournamentComplete() ? 'home' : 'pulse');
    const activeSection = await page.locator('.section.active').getAttribute('id');
    expect(activeSection).toBe(expectedLanding);

    // Tournament Pulse resta sempre raggiungibile anche a torneo concluso.
    await page.locator('#tab-pulse').click();
    await expect(page.locator('#pulse.active .pulse-shell')).toBeVisible();
    expect(await page.locator('#pulse .pulse-card').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#pulse .pulse-card').filter({ hasText: /^🏅?\s*Record$/ })).toBeVisible();
    const playedMatches = await page.evaluate(() => tournamentInsightMatches().filter(m => String(m.homeGoals) !== '' && String(m.awayGoals) !== '').length);
    if (playedMatches > 0) expect(await page.locator('#pulse .pulse-record').count()).toBeGreaterThan(0);

    // Il leader marcatori deve essere apribile tramite un click reale da desktop/mobile
    // e deve mostrare gli achievement senza generare errori JavaScript.
    const topScorer = await page.evaluate(() => tournamentInsightScorers().sort((a,b) => a.position-b.position)[0] || null);
    if (topScorer) {
      await page.evaluate(() => showTab('classifiche', false, { skipRoute:true }));
      const playerLink = page.locator('#classifiche .player-link').filter({ hasText: topScorer.name }).first();
      await expect(playerLink, `Link giocatore non trovato per ${topScorer.name}`).toBeVisible();
      await playerLink.click();
      await expect(page.locator('.player-profile-card')).toBeVisible();
      expect(await page.locator('.achievement-badge').count()).toBeGreaterThan(0);
      await page.evaluate(() => closePlayerProfile({ skipRoute:true }));
    }

    // Il profilo squadra espone il DNA derivato dai risultati senza nuovi dati persistiti.
    const firstTeam = await page.evaluate(() => {
      const row=(state.rows['classifica_squadre']||[])[0]||null;
      return row ? firstPresent(row,[['squadra','team','nome squadra']]) : '';
    });
    if (firstTeam) {
      await page.evaluate(team => openTeamProfile(team), firstTeam);
      await expect(page.locator('.team-profile-view')).toBeVisible();
      expect(await page.locator('.team-dna-card').count()).toBeGreaterThan(0);
      await page.evaluate(() => cralNavCloseEntity({ skipRoute:true }));
    }

    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test("mobile: Tournament Pulse -> Dashboard torna sempre all'inizio della pagina", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'Specifico per progetto iPhone');
  const torneo = active[0];
  test.skip(!torneo, 'Nessun torneo attivo');
  const url = '/' + String(torneo.url || `${torneo.cartella}/`).replace(/^\/+/, '');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  await page.locator('#tab-pulse').click();
  await expect(page.locator('#pulse.active')).toBeVisible();
  const button = page.locator('.pulse-dashboard-btn');
  await button.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, Math.max(250, window.innerHeight * 0.65)));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await button.click();
  await expect(page.locator('#home.active')).toBeVisible();
  await page.waitForFunction(() => window.scrollY === 0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('layout mobile non crea overflow orizzontale della pagina', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'Specifico per progetto iPhone');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(m.scrollWidth, `Overflow orizzontale: viewport=${m.width}, document=${m.scrollWidth}`).toBeLessThanOrEqual(m.width + 2);
});
