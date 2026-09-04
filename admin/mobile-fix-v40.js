/*
 * CRAL Champions Admin - mobile/iOS stability v40
 *
 * Strategia v40:
 * 1) il viewport parte BLOCCATO a scala 1 gia' prima del focus del token;
 * 2) al click su "Verifica e accedi" chiudiamo tastiera/AutoFill;
 * 3) appena admin.js salva la sessione GitHub, facciamo una singola nuova
 *    navigazione dello stesso documento. La Dashboard nasce quindi in un
 *    documento pulito, senza ereditare lo zoom del campo password;
 * 4) sulla Dashboard verifichiamo visualViewport.scale. Se Safari conserva
 *    comunque una scala > 1, applichiamo un contro-zoom CSS temporaneo che
 *    neutralizza esattamente la scala residua;
 * 5) quando la scala e' tornata a 1, rimuoviamo il fallback e riabilitiamo il
 *    normale pinch-zoom;
 * 6) [fix] la stessa stabilizzazione (punti 4-5) viene rilanciata ad ogni
 *    perdita di focus di un campo della Dashboard (non solo al login), cosi'
 *    da correggere lo zoom residuo anche dopo campi come "Messaggio commit"
 *    o "Conferma produzione" nella pagina Pubblica.
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

  // Qualsiasi campo della Dashboard (non solo il login) puo' lasciare una
  // scala residua dopo la chiusura tastiera (es. "Messaggio commit" o
  // "Conferma produzione" nella pagina Pubblica). Rilanciamo la stessa
  // stabilizzazione usata all'ingresso in admin ogni volta che un campo
  // perde il focus, non solo alla transizione login -> admin.
  document.addEventListener('focusout', event => {
    if (mode !== 'admin') return;
    const el = event.target;
    if (el instanceof HTMLElement && el.matches('input, textarea, select')) {
      settleAdmin();
    }
  }, true);

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
