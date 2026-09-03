/*
 * CRAL Champions Admin - sticky brand logo + mobile/iOS stability v37
 *
 * v37 corregge il riallineamento Safari/iOS dopo tastiera/Password AutoFill.
 * La v36 usava visualViewport.offsetTop in valore assoluto: su Safari quel
 * valore puo includere anche l'offset normale della UI del browser e quindi
 * sovracompensare (grande fascia vuota sopra la topbar).
 *
 * Qui salviamo invece una baseline del Visual Viewport quando il login e'
 * stabile e compensiamo SOLO la differenza residua post-tastiera. La
 * compensazione viene applicata all'intera app, non alla sola topbar, e viene
 * rimossa automaticamente appena Safari torna alla baseline o l'utente
 * inizia a interagire/zoomare.
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

/* Riallineamento viewport Safari/iOS. */
(() => {
  'use strict';

  const isMobile = window.matchMedia(
    '(max-width: 820px), (hover: none) and (pointer: coarse)'
  ).matches;
  if (!isMobile) return;

  const app = document.getElementById('app');
  const meta = document.querySelector('meta[name="viewport"]');
  if (!app) return;

  const STABLE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
  const LOCKED_VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

  try { history.scrollRestoration = 'manual'; } catch {}
  if (meta && meta.getAttribute('content') !== STABLE_VIEWPORT) {
    meta.setAttribute('content', STABLE_VIEWPORT);
  }

  let mode = 'unknown';
  let loginExitPending = false;
  let settlingAdmin = false;
  let baseline = null;
  let settleTimer = 0;
  let settleTimers = [];
  let settleVV = null;
  let baselineTimers = [];
  let correctionPx = 0;
  let originalAppPaddingTop = app.style.paddingTop || '';

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function rootScrollY() {
    return Math.max(
      0,
      num(window.scrollY),
      num(document.scrollingElement?.scrollTop),
      num(document.documentElement?.scrollTop),
      num(document.body?.scrollTop)
    );
  }

  function viewportMetrics() {
    const vv = window.visualViewport;
    const innerH = Math.max(1, num(window.innerHeight));
    if (!vv) {
      return {
        innerH,
        height: innerH,
        gap: 0,
        offsetTop: 0,
        pageResidual: 0,
        scale: 1
      };
    }

    const height = Math.max(1, num(vv.height));
    const layoutY = rootScrollY();
    return {
      innerH,
      height,
      gap: Math.max(0, innerH - height),
      offsetTop: Math.max(0, num(vv.offsetTop)),
      pageResidual: Math.max(0, num(vv.pageTop) - layoutY),
      scale: Math.max(0.01, num(vv.scale) || 1)
    };
  }

  function keyboardLikelyOpen(m = viewportMetrics()) {
    if (!window.visualViewport) return false;
    // Una tastiera aperta riduce normalmente il viewport di molto piu' del
    // residuo 15-30 px osservato nel bug WebKit post-dismiss.
    return m.height < Math.min(m.innerH * 0.78, m.innerH - 140);
  }

  function baselineCandidate() {
    const m = viewportMetrics();
    if (keyboardLikelyOpen(m)) return null;
    if (Math.abs(m.scale - 1) > 0.025) return null;
    return m;
  }

  function captureBaseline(force = false) {
    const m = baselineCandidate();
    if (!m) return false;

    // Durante il login aggiorniamo la baseline soltanto quando non c'e' un
    // campo attivo. In questo modo non memorizziamo per errore lo stato della
    // tastiera o del pannello Password AutoFill.
    const active = document.activeElement;
    const editing = active instanceof HTMLElement && active.matches('input, textarea, select');
    if (!force && editing) return false;

    baseline = {
      gap: m.gap,
      offsetTop: m.offsetTop,
      pageResidual: m.pageResidual,
      height: m.height,
      innerH: m.innerH
    };
    return true;
  }

  // Prima baseline: lo script viene eseguito prima del bootstrap, quindi in
  // condizioni normali la tastiera non e' ancora aperta.
  captureBaseline(true);

  function clearBaselineTimers() {
    baselineTimers.forEach(clearTimeout);
    baselineTimers = [];
  }

  function scheduleBaselineRefresh() {
    clearBaselineTimers();
    [0, 80, 220, 500].forEach(ms => {
      baselineTimers.push(setTimeout(() => {
        if (mode === 'login') captureBaseline(false);
      }, ms));
    });
  }

  function resetTop() {
    const scroller = document.scrollingElement || document.documentElement;
    try { window.scrollTo({ left: 0, top: 0, behavior: 'auto' }); } catch {
      try { window.scrollTo(0, 0); } catch {}
    }
    if (scroller) {
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
    }
    if (document.documentElement) {
      document.documentElement.scrollTop = 0;
      document.documentElement.scrollLeft = 0;
    }
    if (document.body) {
      document.body.scrollTop = 0;
      document.body.scrollLeft = 0;
    }
  }

  function blurActiveField() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, select, textarea')) {
      try { active.blur(); } catch {}
    }
  }

  function viewportKick() {
    if (!meta) return;
    // Un brevissimo lock a scala 1 forza WebKit a rivalutare il layout viewport
    // (lo stesso tipo di riallineamento che spesso si ottiene con un pinch),
    // ma ripristiniamo subito lo zoom utente per non compromettere accessibilita'.
    meta.setAttribute('content', LOCKED_VIEWPORT);
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        meta.setAttribute('content', STABLE_VIEWPORT);
      });
    });
  }

  function desiredCorrection() {
    if (!baseline || !window.visualViewport) return 0;
    const m = viewportMetrics();

    // Non combattiamo mai un pinch reale dell'utente.
    if (Math.abs(m.scale - 1) > 0.025) return 0;
    if (keyboardLikelyOpen(m)) return correctionPx;

    // Usiamo solo DELTA rispetto allo stato sano registrato prima della
    // tastiera. E' il punto chiave rispetto alla v36.
    const dGap = Math.max(0, m.gap - baseline.gap);
    const dOffset = Math.max(0, m.offsetTop - baseline.offsetTop);
    const dPage = Math.max(0, m.pageResidual - baseline.pageResidual);

    // I bug WebKit osservati lasciano tipicamente un residuo nell'ordine di
    // poche decine di pixel. Oltre 56 px e' quasi certamente browser chrome,
    // toolbar o una metrica transitoria: non va trasformata in spazio vuoto.
    let px = Math.max(dGap, dOffset, dPage);
    if (!Number.isFinite(px) || px < 1) return 0;
    px = Math.min(56, Math.round(px));
    return px;
  }

  function applyCorrection() {
    if (!app.querySelector('.topbar')) {
      clearCorrection();
      return;
    }

    const px = desiredCorrection();
    if (px === correctionPx) return;
    correctionPx = px;

    if (px > 0) {
      app.style.paddingTop = `${px}px`;
      app.dataset.iosViewportFix = String(px);
    } else {
      app.style.paddingTop = originalAppPaddingTop;
      delete app.dataset.iosViewportFix;
    }
  }

  function clearCorrection() {
    if (!correctionPx && !app.dataset.iosViewportFix) return;
    correctionPx = 0;
    app.style.paddingTop = originalAppPaddingTop;
    delete app.dataset.iosViewportFix;
  }

  function postLoginResetStep(withKick = false) {
    if (!app.querySelector('.topbar')) return;
    resetTop();
    if (withKick) viewportKick();
    applyCorrection();
    requestAnimationFrame(() => {
      resetTop();
      applyCorrection();
    });
  }

  function clearSettle() {
    clearTimeout(settleTimer);
    settleTimers.forEach(clearTimeout);
    settleTimers = [];
    if (settleVV) {
      settleVV.vv.removeEventListener('resize', settleVV.handler);
      settleVV.vv.removeEventListener('scroll', settleVV.handler);
      settleVV = null;
    }
    settlingAdmin = false;
    applyCorrection();
  }

  function settleAdminAtTop() {
    clearSettle();
    settlingAdmin = true;
    blurActiveField();
    resetTop();

    // Il kick viene eseguito poche volte, non a ogni MutationObserver/resize.
    postLoginResetStep(true);

    const vv = window.visualViewport;
    if (vv) {
      const handler = () => {
        requestAnimationFrame(() => postLoginResetStep(false));
      };
      vv.addEventListener('resize', handler, { passive: true });
      vv.addEventListener('scroll', handler, { passive: true });
      settleVV = { vv, handler };
    }

    [60, 140, 260, 450, 750, 1200, 1800, 2600, 3600, 4800].forEach((ms, i) => {
      settleTimers.push(setTimeout(() => postLoginResetStep(i === 2 || i === 5), ms));
    });
    settleTimer = setTimeout(clearSettle, 5600);
  }

  function waitForKeyboardToClose() {
    blurActiveField();
    return new Promise(resolve => {
      const vv = window.visualViewport;
      if (!vv) {
        setTimeout(resolve, 80);
        return;
      }

      let done = false;
      let quietTimer = 0;
      let hardTimer = 0;

      const cleanup = () => {
        vv.removeEventListener('resize', onChange);
        vv.removeEventListener('scroll', onChange);
        clearTimeout(quietTimer);
        clearTimeout(hardTimer);
      };
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };
      const check = () => {
        const m = viewportMetrics();
        if (!keyboardLikelyOpen(m)) {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, 120);
        }
      };
      const onChange = () => requestAnimationFrame(check);

      vv.addEventListener('resize', onChange, { passive: true });
      vv.addEventListener('scroll', onChange, { passive: true });
      check();
      hardTimer = setTimeout(finish, 900);
    });
  }

  // Evita l'autofocus JS sul token; Password AutoFill nativo resta disponibile.
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

  // Chiudiamo tastiera/autofill prima che il login venga sostituito dal loader.
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
    loginExitPending = true;

    waitForKeyboardToClose().then(() => {
      resetTop();
      viewportKick();
      if (button.isConnected) button.click();
    });
  }, true);

  function inspectApp() {
    const loginVisible = !!app.querySelector('.login-card input[type="password"]');
    const adminVisible = !!app.querySelector('.topbar');
    const nextMode = loginVisible ? 'login' : adminVisible ? 'admin' : 'other';

    if (nextMode === mode) {
      if (nextMode === 'admin' && settlingAdmin) {
        requestAnimationFrame(() => postLoginResetStep(false));
      }
      return;
    }

    const previousMode = mode;
    mode = nextMode;

    if (nextMode === 'login') {
      clearSettle();
      clearCorrection();
      loginExitPending = true;
      scheduleBaselineRefresh();
      return;
    }

    if (nextMode === 'admin') {
      clearBaselineTimers();
      if (previousMode !== 'admin' && (loginExitPending || previousMode === 'login' || previousMode === 'other')) {
        loginExitPending = false;
        settleAdminAtTop();
      }
    }
  }

  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(inspectApp).observe(app, { childList: true, subtree: true });
    inspectApp();
  }

  if (window.visualViewport) {
    const refresh = () => {
      if (!app.querySelector('.topbar')) return;
      requestAnimationFrame(() => {
        // Se l'utente ha fatto pinch manualmente, non sovrascriviamo il suo zoom.
        if (Math.abs(viewportMetrics().scale - 1) > 0.025) {
          clearCorrection();
          return;
        }
        if (correctionPx || settlingAdmin) applyCorrection();
      });
    };
    window.visualViewport.addEventListener('resize', refresh, { passive: true });
    window.visualViewport.addEventListener('scroll', refresh, { passive: true });
  }

  window.addEventListener('scroll', () => {
    // Non forziamo scrollTop durante l'uso normale. La piccola compensazione puo'
    // restare finche' Safari mantiene il residuo e sparira' da sola al resize.
    if (!settlingAdmin && correctionPx) applyCorrection();
  }, { passive: true });

  window.addEventListener('orientationchange', () => {
    clearCorrection();
    baseline = null;
    setTimeout(() => {
      resetTop();
      if (mode === 'login') {
        captureBaseline(true);
        scheduleBaselineRefresh();
      } else if (mode === 'admin') {
        viewportKick();
        applyCorrection();
      }
    }, 300);
  });
})();
