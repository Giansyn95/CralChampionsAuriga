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
  await expect(page.locator('.hall-icon .hall-elite-mark')).toBeVisible();
  await expect(page.locator('.hall-feature')).toHaveCount(4);
  await expect(page.locator('.hall-feature-list')).toBeVisible();
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

    // Tournament Pulse è la landing unica, sia a torneo aperto sia a torneo concluso.
    const activeSection = await page.locator('.section.active').getAttribute('id');
    expect(activeSection).toBe('pulse');
    await expect(page.locator('#tab-home')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Apri dashboard/i })).toHaveCount(0);

    // Tournament Pulse resta sempre raggiungibile anche a torneo concluso.
    await page.locator('#tab-pulse').click();
    await expect(page.locator('#pulse.active .pulse-shell')).toBeVisible();
    expect(await page.locator('#pulse .pulse-card').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#pulse .pulse-card h2').filter({ hasText: /Record/i }).first()).toBeVisible();
    const playedMatches = await page.evaluate(() => tournamentInsightMatches().filter(m => String(m.homeGoals) !== '' && String(m.awayGoals) !== '').length);
    if (playedMatches > 0) expect(await page.locator('#pulse .pulse-record').count()).toBeGreaterThan(0);

    // Gli highlight sono un riepilogo premium solo mobile; su desktop restano le classifiche estese.
    await page.locator('#tab-classifiche').click();
    await expect(page.locator('#classifiche .classifiche-switch-btn').filter({ hasText: 'Classifiche' })).toBeVisible();
    const mobileClassifiche = await page.evaluate(() => matchMedia('(max-width:720px)').matches);
    const highlightAvailability = await page.evaluate(() => ({
      mvp: !!currentMvpOfTournament(),
      keeper: !!wrappedBestKeeper(),
      scorers: classificheTopScorers(5).length
    }));
    const highlights = page.locator('#classifiche .classifiche-highlights');
    if (highlightAvailability.mvp || highlightAvailability.keeper || highlightAvailability.scorers) {
      if (mobileClassifiche) {
        await expect(highlights).toBeVisible();
        await expect(page.locator('#classifiche .classifiche-mobile-ranking-actions')).toBeVisible();
        if (highlightAvailability.mvp) await expect(page.locator('#classifiche .classifiche-highlight-card.is-mvp')).toBeVisible();
        if (highlightAvailability.keeper) await expect(page.locator('#classifiche .classifiche-highlight-card.is-keeper')).toBeVisible();
        if (highlightAvailability.scorers) {
          await expect(page.locator('#classifiche .classifiche-highlight-card.is-scorers')).toBeVisible();
          expect(await page.locator('#classifiche .classifiche-top5-row').count()).toBe(Math.min(5, highlightAvailability.scorers));
        }
      } else {
        await expect(highlights).toBeHidden();
        await expect(page.locator('#classifiche .classifiche-mobile-ranking-actions')).toBeHidden();
      }
    }

    // Il leader marcatori deve essere apribile tramite un click reale da desktop/mobile
    // e deve mostrare gli achievement senza generare errori JavaScript.
    const topScorer = await page.evaluate(() => tournamentInsightScorers().sort((a,b) => a.position-b.position)[0] || null);
    if (topScorer) {
      await page.evaluate(() => showTab('classifiche', false, { skipRoute:true }));
      if (await page.evaluate(() => matchMedia('(max-width:720px)').matches)) {
        const marcatoriBtn=page.locator('#classifiche .classifiche-mobile-ranking-btn[data-classifiche-target="marcatori"]');
        if (await marcatoriBtn.count()) await marcatoriBtn.click();
      }
      const playerLink = page.locator('#classifiche .player-link').filter({ hasText: topScorer.name }).first();
      await expect(playerLink, `Link giocatore non trovato per ${topScorer.name}`).toBeVisible();
      await playerLink.click();
      await expect(page.locator('.player-profile-card')).toBeVisible();
      expect(await page.locator('.achievement-badge').count()).toBeGreaterThan(0);
      await page.evaluate(() => closePlayerProfile({ skipRoute:true, restoreFocus:false }));
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
      await page.evaluate(() => cralNavCloseEntityOverlay({ skipRoute:true, restoreFocus:false }));
    }

    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('Riepilogo giornata mostra il miglior portiere anche nella scheda partita', async ({ page }) => {
  const torneo = active[0];
  test.skip(!torneo, 'Nessun torneo attivo');
  const url = '/' + String(torneo.url || `${torneo.cartella}/`).replace(/^\/+/, '');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.locator('#tab-riepilogo').click();
  await expect(page.locator('#riepilogo.active')).toBeVisible();

  const expected = await page.evaluate(() => {
    const files=sectionFiles('riepilogo');
    const selected=state.selectedRiepilogoGiornata;
    const file=selected ? files.find(f=>riepilogoFileHasGiornata(f,selected)) : files[files.length-1];
    if(!file) return false;
    const parsed=parseRiepilogoFile(file);
    return (parsed.portiere||[]).some(r=>!selected || rowGiornataKey(r,file)===selected);
  });
  if (expected) {
    await expect(page.locator('#riepilogo .riepilogo-match [aria-label="Miglior portiere"]').first()).toBeVisible();
  }
});

test("mobile: Pulse è la landing unica, Classifiche è compatta e il Wrapped resta raggiungibile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'Specifico per progetto iPhone');
  const torneo = active[0];
  test.skip(!torneo, 'Nessun torneo attivo');
  const url = '/' + String(torneo.url || `${torneo.cartella}/`).replace(/^\/+/, '');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // Il Pulse è l'unica landing: Home e il vecchio CTA Dashboard non devono più esistere.
  await expect(page.locator('#pulse.active')).toBeVisible();
  await expect(page.locator('#tab-home')).toHaveCount(0);
  await expect(page.locator('.pulse-dashboard-btn')).toHaveCount(0);

  // Il Wrapped mantiene la logica originale: solo mobile + torneo concluso + dati sufficienti.
  const complete = await page.evaluate(() => isTournamentComplete());
  const canShowWrapped = await page.evaluate(() => {
    return isTournamentComplete() && wrappedIsMobileDevice() && wrappedSlidesData().length > 2;
  });
  if (complete && canShowWrapped) {
    const wrappedBanner = page.locator('#pulse .wrapped-banner');
    await expect(wrappedBanner).toBeVisible();
    await wrappedBanner.click();
    await expect(page.locator('#wrappedOverlay')).toBeVisible();
    await page.getByRole('button', { name: 'Chiudi' }).click();
    await expect(page.locator('#wrappedOverlay')).toHaveCount(0);
  }

  // Su mobile Classifiche mostra una sola vista alla volta tramite i tre switch interni.
  await page.locator('#tab-classifiche').click();
  await expect(page.locator('#classifiche.active')).toBeVisible();
  const switches = page.locator('#classifiche .classifiche-switch-btn');
  await expect(switches).toHaveCount(3);

  // Su mobile il selettore Classifiche / Andamento / Proiezione non deve flottare sopra i contenuti.
  const classSwitch = page.locator('#classifiche .classifiche-switch');
  const switchPosition = await classSwitch.evaluate(el => getComputedStyle(el).position);
  expect(switchPosition).toBe('static');
  await classSwitch.scrollIntoViewIfNeeded();
  const switchTopBefore = await classSwitch.evaluate(el => el.getBoundingClientRect().top);
  await page.evaluate(() => window.scrollBy(0, 700));
  await page.waitForTimeout(120);
  const switchTopAfter = await classSwitch.evaluate(el => el.getBoundingClientRect().top);
  expect(switchTopAfter).toBeLessThan(switchTopBefore - 100);

  await page.getByRole('tab', { name: /Andamento/i }).click();
  await expect(page.locator('#chartClassificheAndamento')).toBeVisible();
  await expect(page.locator('#chartClassificheProiezione')).toHaveCount(0);

  await page.getByRole('tab', { name: /Proiezione/i }).click();
  await expect(page.locator('#chartClassificheProiezione')).toBeVisible();
  await expect(page.locator('#chartClassificheAndamento')).toHaveCount(0);

  await page.locator('#classifiche .classifiche-switch-btn').filter({ hasText: 'Classifiche' }).click();
  await expect(page.locator('#chartClassificheAndamento')).toHaveCount(0);
  await expect(page.locator('#chartClassificheProiezione')).toHaveCount(0);

  // Mobile: protagonisti subito visibili; le classifiche individuali estese si aprono una alla volta.
  const hasHighlightData = await page.evaluate(() => !!currentMvpOfTournament() || !!wrappedBestKeeper() || classificheTopScorers(5).length>0);
  if (hasHighlightData) {
    await expect(page.locator('#classifiche .classifiche-highlights')).toBeVisible();
    await expect(page.locator('#classifiche .classifiche-mobile-ranking-actions')).toBeVisible();
    const marcatoriBtn=page.locator('#classifiche .classifiche-mobile-ranking-btn[data-classifiche-target="marcatori"]');
    if (await marcatoriBtn.count()) {
      await expect(page.locator('#classifiche .classifiche-secondary-ranking[data-classifiche-kind="marcatori"]')).toBeHidden();
      await marcatoriBtn.click();
      await expect(page.locator('#classifiche .classifiche-secondary-ranking[data-classifiche-kind="marcatori"]')).toBeVisible();
      await expect(marcatoriBtn).toHaveAttribute('aria-expanded','true');
      await expect(page.locator('#classifiche .classifiche-secondary-ranking[data-classifiche-kind="mvp"]')).toBeHidden();
    }
  }

  // Fantacalcio mobile costruisce solo le card: la tabella desktop non viene più creata inutilmente.
  if (await page.locator('#tab-fantacalcio').count() && await page.evaluate(() => innerWidth <= 720)) {
    await page.locator('#tab-fantacalcio').click();
    await expect(page.locator('#fantacalcio.active .fanta-mobile-list')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#fantacalcio.active .fanta-table-desktop')).toHaveCount(0);

    // Quando la creazione rosa è aperta, la CTA deve essere la principale azione mobile:
    // full-width, con stato/scadenza leggibili e senza la nota desktop ridondante.
    const creatorAvailable=await page.evaluate(() => fantaRosterCreatorAvailable());
    if (creatorAvailable) {
      const creatorLink=page.locator('#fantacalcio.active .fanta-roster-creator-link');
      const creatorMeta=page.locator('#fantacalcio.active .fanta-roster-creator-link-meta');
      await expect(creatorLink).toBeVisible();
      await expect(creatorMeta).toBeVisible();
      await expect(creatorMeta).toContainText(/Iscrizioni aperte/i);
      await expect(page.locator('#fantacalcio.active .fanta-roster-creator-note')).toBeHidden();
      const widths=await page.locator('#fantacalcio.active .fanta-card-shell').evaluate(card => {
        const link=card.querySelector('.fanta-roster-creator-link');
        return {card:card.getBoundingClientRect().width,link:link?.getBoundingClientRect().width||0};
      });
      expect(widths.link).toBeGreaterThan(widths.card * .88);
    }
  }
});



test('mobile: tutti i tab del torneo restano nella viewport e la navigazione mantiene touch target adeguati', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'Specifico per progetto iPhone');
  const torneo = active[0];
  test.skip(!torneo, 'Nessun torneo attivo');
  const url = '/' + String(torneo.url || `${torneo.cartella}/`).replace(/^\/+/, '');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#tab-pulse')).toBeVisible({ timeout: 5000 });

  const tabIds = await page.locator('#tabs .tab').evaluateAll(nodes => nodes.map(n => n.dataset.tab).filter(Boolean));
  expect(tabIds.length).toBeGreaterThan(4);

  for (const id of tabIds) {
    const tab = page.locator(`#tab-${id}`);
    const box = await tab.boundingBox();
    expect(box?.height || 0, `Touch target troppo basso per ${id}`).toBeGreaterThanOrEqual(40);
    await tab.click();
    await page.waitForTimeout(180);
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth
    }));
    expect(metrics.scrollWidth, `Overflow orizzontale nel tab ${id}`).toBeLessThanOrEqual(metrics.viewport + 2);
    expect(metrics.bodyWidth, `Overflow body nel tab ${id}`).toBeLessThanOrEqual(metrics.viewport + 2);
  }

  // Il tab attivo viene riportato automaticamente nella porzione visibile della barra orizzontale.
  if (tabIds.includes('fantacalcio')) {
    await page.locator('#tab-fantacalcio').click();
    await page.waitForTimeout(380);
    const visible = await page.locator('#tab-fantacalcio').evaluate(el => {
      const r=el.getBoundingClientRect();
      return r.left >= -1 && r.right <= innerWidth + 1;
    });
    expect(visible).toBeTruthy();
  }
});

test('layout mobile non crea overflow orizzontale della pagina', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'Specifico per progetto iPhone');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(m.scrollWidth, `Overflow orizzontale: viewport=${m.width}, document=${m.scrollWidth}`).toBeLessThanOrEqual(m.width + 2);
});
