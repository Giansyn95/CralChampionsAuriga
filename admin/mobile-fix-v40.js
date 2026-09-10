/*
 * CRAL Champions Admin - mobile/iOS stability v43
 *
 * Novita' rispetto a v40:
 * 7) risolto il "salto a sinistra" delle tabelle scrollabili orizzontalmente
 *    (es. la tabella giocatori con le colonne Numero/Presenze/Capitano).
 *    Verificato su admin-boot-v30.js: il gestore della checkbox "Capitano"
 *    e dell'input "Presenze" NON chiama mai render() e non ricostruisce il
 *    DOM della tabella, quindi il salto non e' causato da un re-render.
 *    E' molto probabile che sia Safari iOS a "riportare in vista" il
 *    controllo toccato dentro il contenitore con scroll orizzontale.
 *    Usiamo quindi due meccanismi indipendenti dalla causa esatta:
 *      a) un "blocco" temporaneo (~400ms) che pin-na lo scrollLeft del
 *         contenitore al valore che aveva subito prima di toccare un
 *         controllo al suo interno (checkbox/input/select), a meno che
 *         l'utente non stia davvero trascinando con il dito quel
 *         contenitore in quel momento;
 *      b) un ripristino via MutationObserver (come rete di sicurezza) nel
 *         caso in cui il DOM venga comunque ricostruito altrove, tracciando
 *         lo scroll per una "firma" stabile della tabella (il testo delle
 *         intestazioni) invece che per riferimento all'elemento.
 *
 * Tutto il resto (punti 1-6, viewport/zoom su Safari iOS) e' invariato
 * rispetto a v40.
 */

/* Persistenza del logo durante i rerender del login. */
(() => {
  'use strict';

  const STORAGE_KEY = 'cral-admin-brand-logo-src';
  const app = document.getElementById('app');
  if (!app || typeof MutationObserver === 'undefined') return;

  let lastLogoSrc = '';
  try { lastLogoSrc = sessionStorage.getItem(STORAGE_KEY) || ''; } catch {}

  function rememberLogo(img) {
    const src = img?.currentSrc || img?.src || '';
    if (!src || src === lastLogoSrc) return;
    lastLogoSrc = src;
    try { sessionStorage.setItem(STORAGE_KEY, src); } catch {}
  }

  function keepLogoVisible() {
    const mark = app.querySelector('.login-card .brand-mark');
    if (!mark) return;

    const currentImg = mark.querySelector('img');
    if (currentImg) {
      rememberLogo(currentImg);
      return;
    }

    if (!lastLogoSrc) return;
    const img = new Image();
    img.alt = 'Logo CRAL Champions Auriga';
    img.src = lastLogoSrc;
    mark.classList.add('brand-mark-logo');
    mark.replaceChildren(img);
  }

  new MutationObserver(keepLogoVisible).observe(app, {
    childList: true,
    subtree: true
  });
  keepLogoVisible();
})();

/* v43: mantiene lo scroll orizzontale delle tabelle (es. la tabella
 * giocatori con le colonne Numero/Presenze/Capitano) quando l'utente tocca
 * un controllo al loro interno. Vedi commento in testa al file per il
 * ragionamento su a) e b). */
(() => {
  'use strict';

  const app = document.getElementById('app');
  if (!app) return;

  // firma tabella -> ultimo scrollLeft "buono" (> 0) noto.
  const lastGoodBySignature = new Map();
  // contenitori che l'utente sta trascinando davvero in questo momento:
  // su questi NON dobbiamo mai forzare lo scrollLeft.
  const activeTouch = new WeakSet();

  function isHorizontallyScrollable(el) {
    return el instanceof HTMLElement && el.scrollWidth - el.clientWidth > 2;
  }

  // Identifica una tabella/contenitore in modo stabile tra un render e
  // l'altro, usando il testo delle intestazioni (thead th) come chiave.
  // Se non troviamo una <table> con intestazioni, ripieghiamo su una
  // combinazione di classe + numero di colonne della prima riga.
  function signatureFor(el) {
    if (!(el instanceof HTMLElement)) return null;
    const table = el.tagName === 'TABLE' ? el : el.querySelector('table');
    if (table) {
      const heads = Array.from(table.querySelectorAll('thead th'))
        .map(th => th.textContent.trim())
        .filter(Boolean);
      if (heads.length) return 'thead:' + heads.join('|');

      const firstRowCells = table.querySelector('tr')?.children?.length || 0;
      if (firstRowCells) return 'cols:' + firstRowCells + ':' + (el.className || '');
    }
    return el.className ? 'class:' + el.className : null;
  }

  function nearestScrollable(node) {
    let el = node instanceof HTMLElement ? node : node?.parentElement || null;
    while (el && el !== app.parentElement) {
      if (isHorizontallyScrollable(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // (a) Ricorda lo scroll "buono" mentre l'utente scrolla manualmente.
  document.addEventListener(
    'scroll',
    event => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !app.contains(el)) return;
      if (!isHorizontallyScrollable(el)) return;
      if (el.scrollLeft <= 0) return;
      const sig = signatureFor(el);
      if (sig) lastGoodBySignature.set(sig, el.scrollLeft);
    },
    { capture: true, passive: true }
  );

  // (a) Dopo aver toccato/cambiato un controllo dentro un contenitore
  // scrollabile, blocchiamo per una finestra breve il suo scrollLeft al
  // valore noto: se qualcosa (Safari o l'app) prova a riportarlo a 0,
  // lo correggiamo fotogramma per fotogramma finche' la finestra e' aperta.
  // Se l'utente sta davvero trascinando quel contenitore, non interveniamo.
  function clampFor(el, ms) {
    const sig = signatureFor(el);
    if (!sig) return;
    const target = lastGoodBySignature.get(sig);
    if (!target) return;
    const deadline = performance.now() + ms;
    (function tick() {
      if (!el.isConnected || activeTouch.has(el)) return;
      if (el.scrollLeft !== target) el.scrollLeft = target;
      if (performance.now() < deadline) requestAnimationFrame(tick);
    })();
  }

  ['focusin', 'click', 'change', 'input'].forEach(type => {
    document.addEventListener(
      type,
      event => {
        const container = nearestScrollable(event.target);
        if (container) clampFor(container, 400);
      },
      { capture: true, passive: true }
    );
  });

  document.addEventListener(
    'touchstart',
    event => {
      const container = nearestScrollable(event.target);
      if (container) activeTouch.add(container);
    },
    { capture: true, passive: true }
  );
  ['touchend', 'touchcancel'].forEach(type => {
    document.addEventListener(
      type,
      event => {
        const container = nearestScrollable(event.target);
        if (container) activeTouch.delete(container);
      },
      { capture: true, passive: true }
    );
  });

  // (b) Rete di sicurezza: se il DOM viene comunque ricostruito da zero
  // (nuovo nodo per la tabella), ripristiniamo lo scroll su qualunque
  // elemento con la stessa firma non appena compare.
  if (typeof MutationObserver !== 'undefined') {
    function findScrollableCandidates() {
      let candidates = Array.from(app.querySelectorAll('.table-wrap')).filter(
        isHorizontallyScrollable
      );
      if (candidates.length) return candidates;

      candidates = [];
      const walker = document.createTreeWalker(app, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
        if (isHorizontallyScrollable(node)) candidates.push(node);
        node = walker.nextNode();
      }
      return candidates;
    }

    function restoreScrollPositions() {
      if (!lastGoodBySignature.size) return;
      findScrollableCandidates().forEach(el => {
        if (el.scrollLeft !== 0) return;
        const sig = signatureFor(el);
        if (!sig) return;
        const saved = lastGoodBySignature.get(sig);
        if (saved) el.scrollLeft = saved;
      });
    }

    let restoreQueued = false;
    function queueRestore() {
      if (restoreQueued) return;
      restoreQueued = true;
      requestAnimationFrame(() => {
        restoreQueued = false;
        restoreScrollPositions();
        requestAnimationFrame(restoreScrollPositions);
      });
    }

    new MutationObserver(queueRestore).observe(app, {
      childList: true,
      subtree: true,
      attributes: true
    });
  }
})();

/* Reset zoom/viewport deterministico per Safari iOS. */
(() => {
  'use strict';

  const isMobile = window.matchMedia(
    '(max-width: 820px), (hover: none) and (pointer: coarse)'
  ).matches;
  if (!isMobile) return;

  const app = document.getElementById('app');
  const meta = document.querySelector('meta[name="viewport"]');
  if (!app || !meta) return;

  const GH_SESSION_KEY = 'cral-admin-gh-session';
  const REENTRY_KEY = 'cral-admin-mobile-v40-reentry';
  const RESET_PARAM = '__cral_vp';

  const LOCKED_VIEWPORT =
    'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  const STABLE_VIEWPORT =
    'width=device-width, initial-scale=1, viewport-fit=cover';

  try { history.scrollRestoration = 'manual'; } catch {}

  // Fondamentale: il blocco deve esistere PRIMA che l'utente tocchi il token.
  meta.setAttribute('content', LOCKED_VIEWPORT);

  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 820px), (hover: none) and (pointer: coarse) {
      .login-card input,
      .login-card select,
      .login-card textarea,
      .login-card .input,
      .login-card .select,
      .login-card .textarea {
        font-size: 17px !important;
      }
      html, body, #app {
        max-width: 100% !important;
        min-width: 0 !important;
        overflow-x: hidden !important;
      }
      #app[data-ios-scale-fix] {
        transform-origin: top left !important;
        will-change: transform;
      }
    }
  `;
  document.head.appendChild(style);

  let mode = 'unknown';
  let loginAttempt = false;
  let sessionPoll = 0;
  let settleTimers = [];
  let vvCleanup = null;
  let counterScale = 1;
  let adminSettling = false;

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function pageScale() {
    const s = num(window.visualViewport?.scale, 1);
    return s > 0.1 ? s : 1;
  }

  function resetTop() {
    const scroller = document.scrollingElement || document.documentElement;
    try { window.scrollTo({ left: 0, top: 0, behavior: 'auto' }); }
    catch { try { window.scrollTo(0, 0); } catch {} }
    if (scroller) {
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
    }
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
    if (document.body) {
      document.body.scrollTop = 0;
      document.body.scrollLeft = 0;
    }
  }

  function blurActiveField() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, textarea, select')) {
      try { active.blur(); } catch {}
    }
  }

  function keyboardLikelyOpen() {
    const vv = window.visualViewport;
    if (!vv) return false;
    const innerH = Math.max(1, num(window.innerHeight, 1));
    const h = Math.max(1, num(vv.height, innerH));
    return h < Math.min(innerH * 0.80, innerH - 130);
  }

  function lockViewport() {
    meta.setAttribute('content', LOCKED_VIEWPORT);
  }

  function unlockViewport() {
    meta.setAttribute('content', STABLE_VIEWPORT);
  }

  function clearCounterScale() {
    counterScale = 1;
    app.style.zoom = '';
    app.style.transform = '';
    delete app.dataset.iosScaleFix;
  }

  function applyCounterScale() {
    const scale = pageScale();

    // Il caso visto nel video e' uno zoom residuo > 1. Se siamo gia' circa a 1,
    // nessun artificio CSS deve restare attivo.
    if (scale <= 1.015 || scale > 3) {
      clearCounterScale();
      return false;
    }

    const inverse = 1 / scale;
    if (Math.abs(inverse - counterScale) < 0.003) return true;
    counterScale = inverse;

    // CSS zoom e' supportato dalle versioni Safari moderne. E' preferibile a
    // transform perche' partecipa al layout e non lascia altezza fantasma.
    if (CSS?.supports?.('zoom', '0.9')) {
      app.style.transform = '';
      app.style.zoom = inverse.toFixed(5);
    } else {
      app.style.zoom = '';
      app.style.transform = `scale(${inverse.toFixed(5)})`;
    }
    app.dataset.iosScaleFix = scale.toFixed(4);
    return true;
  }

  function cleanResetParam() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has(RESET_PARAM)) return;
      url.searchParams.delete(RESET_PARAM);
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  function hardNavigateToCleanViewport() {
    try {
      sessionStorage.setItem(REENTRY_KEY, '1');
      const url = new URL(location.href);
      url.searchParams.set(RESET_PARAM, String(Date.now()));
      location.replace(url.toString());
    } catch {
      location.reload();
    }
  }

  function waitForKeyboardToClose() {
    blurActiveField();
    lockViewport();

    return new Promise(resolve => {
      const vv = window.visualViewport;
      if (!vv) {
        setTimeout(() => { resetTop(); resolve(); }, 180);
        return;
      }

      let finished = false;
      let quiet = 0;
      const hard = setTimeout(finish, 1200);

      function cleanup() {
        clearTimeout(quiet);
        clearTimeout(hard);
        vv.removeEventListener('resize', changed);
        vv.removeEventListener('scroll', changed);
      }

      function finish() {
        if (finished) return;
        finished = true;
        cleanup();
        resetTop();
        resolve();
      }

      function check() {
        if (!keyboardLikelyOpen()) {
          clearTimeout(quiet);
          quiet = setTimeout(finish, 180);
        }
      }

      function changed() {
        requestAnimationFrame(check);
      }

      vv.addEventListener('resize', changed, { passive: true });
      vv.addEventListener('scroll', changed, { passive: true });
      check();
    });
  }

  function stopSessionPoll() {
    if (sessionPoll) clearInterval(sessionPoll);
    sessionPoll = 0;
  }

  function watchForSuccessfulLogin(previousSession) {
    stopSessionPoll();
    const started = Date.now();
    sessionPoll = setInterval(() => {
      let current = null;
      try { current = sessionStorage.getItem(GH_SESSION_KEY); } catch {}

      // saveSession() viene eseguita solo DOPO verifyTarget() riuscita e PRIMA
      // del caricamento completo della Dashboard: e' il punto ideale per creare
      // un documento pulito senza aspettare tutti i file del torneo.
      if (current && current !== previousSession) {
        stopSessionPoll();
        hardNavigateToCleanViewport();
        return;
      }

      if (Date.now() - started > 15000) stopSessionPoll();
    }, 40);
  }

  function finishAdminSettlement({ reset = false } = {}) {
    if (!adminSettling && !settleTimers.length && !vvCleanup) return;

    // Prima fermiamo QUALSIASI callback futura: una volta che l'utente inizia
    // a navigare, nessun timer o evento del Visual Viewport deve piu' poter
    // riportare la pagina a scrollTop=0.
    settleTimers.forEach(clearTimeout);
    settleTimers = [];
    if (vvCleanup) {
      vvCleanup();
      vvCleanup = null;
    }
    adminSettling = false;

    if (reset) resetTop();

    const scale = pageScale();
    if (scale <= 1.015) {
      clearCounterScale();
      unlockViewport();
    } else {
      // Manteniamo la rete di sicurezza della v39, ma senza listener permanenti
      // e soprattutto senza ulteriori reset dello scroll.
      lockViewport();
      applyCounterScale();
    }

    cleanResetParam();
    try { sessionStorage.removeItem(REENTRY_KEY); } catch {}
  }

  function settleAdmin() {
    clearSettling();
    adminSettling = true;
    lockViewport();
    blurActiveField();
    resetTop();

    const run = () => {
      if (!adminSettling) return;
      requestAnimationFrame(() => {
        if (!adminSettling) return;
        resetTop();
        applyCounterScale();
      });
    };

    // Finestra breve e finita: serve solo a stabilizzare il primo frame della
    // Dashboard dopo il reload pulito. In v39 arrivava fino a 2.8 s e poteva
    // scattare mentre l'utente aveva gia' iniziato a navigare.
    run();
    [50, 120, 220, 360, 550, 800].forEach(ms => {
      settleTimers.push(setTimeout(run, ms));
    });

    const vv = window.visualViewport;
    if (vv) {
      const onResize = () => run();
      // IMPORTANTE: non ascoltiamo visualViewport.scroll. Su Safari iOS viene
      // emesso anche durante il normale scroll della pagina e nella v39 causava
      // il ritorno improvviso in cima.
      vv.addEventListener('resize', onResize, { passive: true });
      vvCleanup = () => vv.removeEventListener('resize', onResize);
    }

    settleTimers.push(setTimeout(() => {
      finishAdminSettlement({ reset: true });
    }, 1050));
  }

  function clearSettling() {
    settleTimers.forEach(clearTimeout);
    settleTimers = [];
    if (vvCleanup) {
      vvCleanup();
      vvCleanup = null;
    }
    adminSettling = false;
  }

  // [rimosso] In precedenza qui c'era un listener 'focusout' che rilanciava
  // settleAdmin()/resetTop() ogni volta che un campo della Dashboard perdeva
  // il focus (uscita da un input, da una select, ecc.). Su richiesta, questo
  // comportamento e' stato eliminato: la stabilizzazione dello zoom resta
  // attiva solo nei due momenti in cui serve davvero, cioe' subito dopo il
  // login (Dashboard nata da un reload pulito) e dopo una rotazione dello
  // schermo. Scrivere in un campo di testo o scegliere un'opzione non
  // riportera' piu' la pagina in cima.

  // Appena l'utente tocca/interagisce con la Dashboard, la stabilizzazione
  // automatica termina subito. Da quel momento il suo scroll e' sovrano.
  function stopSettlingOnUserIntent(event) {
    if (!adminSettling || mode !== 'admin') return;
    if (event?.target?.closest?.('.login-card')) return;
    finishAdminSettlement({ reset: false });
  }

  document.addEventListener('touchstart', stopSettlingOnUserIntent, { capture: true, passive: true });
  document.addEventListener('pointerdown', stopSettlingOnUserIntent, { capture: true, passive: true });
  document.addEventListener('wheel', stopSettlingOnUserIntent, { capture: true, passive: true });

  // Evita l'autofocus JS del token. Il tap/autofill nativo continua a funzionare.
  if (typeof HTMLInputElement !== 'undefined') {
    const nativeFocus = HTMLInputElement.prototype.focus;
    HTMLInputElement.prototype.focus = function (...args) {
      const isLoginToken =
        this.type === 'password' &&
        typeof this.closest === 'function' &&
        !!this.closest('.login-card');
      if (isLoginToken) return;
      return nativeFocus.apply(this, args);
    };
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('.login-card .btn.gold');
    if (!button) return;

    if (button.dataset.viewportReady === '1') {
      delete button.dataset.viewportReady;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    button.dataset.viewportReady = '1';
    loginAttempt = true;
    let previousSession = null;
    try { previousSession = sessionStorage.getItem(GH_SESSION_KEY); } catch {}

    waitForKeyboardToClose().then(() => {
      resetTop();
      watchForSuccessfulLogin(previousSession);
      if (button.isConnected) button.click();
    });
  }, true);

  function inspectApp() {
    const loginVisible = !!app.querySelector('.login-card input[type="password"]');
    const adminVisible = !!app.querySelector('.topbar');
    const nextMode = loginVisible ? 'login' : adminVisible ? 'admin' : 'other';

    if (nextMode === mode) return;
    const previousMode = mode;
    mode = nextMode;

    if (nextMode === 'login') {
      clearSettling();
      clearCounterScale();
      lockViewport();
      resetTop();
      return;
    }

    if (nextMode === 'admin') {
      stopSessionPoll();
      if (previousMode !== 'admin') {
        settleAdmin();
        loginAttempt = false;
      }
      return;
    }

    // Durante il caricamento successivo al login NON sblocchiamo la scala.
    if (loginAttempt) lockViewport();
  }

  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(inspectApp).observe(app, {
      childList: true,
      subtree: true
    });
    inspectApp();
  }

  window.addEventListener('pageshow', () => {
    lockViewport();
    resetTop();
    setTimeout(inspectApp, 0);
  });

  window.addEventListener('orientationchange', () => {
    clearSettling();
    clearCounterScale();
    lockViewport();
    setTimeout(() => {
      resetTop();
      if (app.querySelector('.topbar')) settleAdmin();
    }, 320);
  });
})();
