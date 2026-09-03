/*
 * CRAL Champions Admin - mobile/iOS stability v38
 *
 * Obiettivo v38: dopo il login, Safari/iOS 26 puo lasciare il layout viewport
 * traslato verso l'alto anche con scrollTop=0. Invece di fidarci di
 * visualViewport.offsetTop, misuriamo la posizione REALE della topbar/app e
 * compensiamo l'intero #app con una translateY solo quando il documento e'
 * effettivamente disegnato sopra il bordo visibile.
 *
 * La correzione e' limitata alla fase di ingresso in Admin e non interferisce
 * con lo scroll normale successivo.
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

/* Riallineamento deterministico post-login per Safari/iOS. */
(() => {
  'use strict';

  const isMobile = window.matchMedia(
    '(max-width: 820px), (hover: none) and (pointer: coarse)'
  ).matches;
  if (!isMobile) return;

  const app = document.getElementById('app');
  const meta = document.querySelector('meta[name="viewport"]');
  if (!app) return;

  const STABLE_VIEWPORT =
    'width=device-width, initial-scale=1, viewport-fit=cover';
  const LOCKED_VIEWPORT =
    'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

  try { history.scrollRestoration = 'manual'; } catch {}
  if (meta) meta.setAttribute('content', STABLE_VIEWPORT);

  // Difesa aggiuntiva contro l'auto-zoom degli input su iOS.
  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 820px), (hover: none) and (pointer: coarse) {
      .login-card input,
      .login-card select,
      .login-card textarea { font-size: 16px !important; }
      html, body { max-width: 100%; overflow-x: hidden; }
      #app[data-ios-entry-fix] {
        transform-origin: top left;
        will-change: transform;
      }
    }
  `;
  document.head.appendChild(style);

  let mode = 'unknown';
  let loginExitPending = false;
  let settling = false;
  let appliedShift = 0;
  let settleTimers = [];
  let settleEndTimer = 0;
  let vvCleanup = null;
  let viewportUnlockTimer = 0;

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

  function resetTop() {
    const scroller = document.scrollingElement || document.documentElement;
    try { window.scrollTo({ left: 0, top: 0, behavior: 'auto' }); }
    catch { try { window.scrollTo(0, 0); } catch {} }

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
    if (active instanceof HTMLElement && active.matches('input, textarea, select')) {
      try { active.blur(); } catch {}
    }
  }

  function keyboardLikelyOpen() {
    const vv = window.visualViewport;
    if (!vv) return false;
    const innerH = Math.max(1, num(window.innerHeight));
    const height = Math.max(1, num(vv.height));
    return height < Math.min(innerH * 0.78, innerH - 140);
  }

  function lockViewport() {
    clearTimeout(viewportUnlockTimer);
    if (meta) meta.setAttribute('content', LOCKED_VIEWPORT);
  }

  function unlockViewport(delay = 0) {
    clearTimeout(viewportUnlockTimer);
    viewportUnlockTimer = setTimeout(() => {
      if (meta) meta.setAttribute('content', STABLE_VIEWPORT);
    }, Math.max(0, delay));
  }

  function clearShift() {
    appliedShift = 0;
    app.style.transform = '';
    delete app.dataset.iosEntryFix;
  }

  function rawVisualTop() {
    const topbar = app.querySelector('.topbar');
    if (!topbar) return 0;

    // getBoundingClientRect() include la translate gia applicata. La togliamo
    // matematicamente per ottenere la posizione prodotta da Safari.
    const topbarTop = num(topbar.getBoundingClientRect().top) - appliedShift;
    const appTop = num(app.getBoundingClientRect().top) - appliedShift;
    const bodyTop = num(document.body?.getBoundingClientRect?.().top);

    // In presenza del bug iOS 26 almeno una di queste coordinate diventa
    // negativa nonostante scrollTop sia zero.
    return Math.min(topbarTop, appTop, bodyTop);
  }

  function fallbackResidual() {
    // Fallback prudente: usato solo quando la geometria DOM non espone il bug.
    // Accettiamo esclusivamente residui piccoli, compatibili con il noto drift
    // iOS/Dynamic Island, evitando le sovracompensazioni delle versioni passate.
    const vv = window.visualViewport;
    if (!vv || rootScrollY() > 1) return 0;
    const residual = Math.max(
      0,
      num(vv.pageTop) - rootScrollY(),
      num(vv.offsetTop)
    );
    if (residual >= 1 && residual <= 40) return Math.round(residual);
    return 0;
  }

  function measureAndFix() {
    const topbar = app.querySelector('.topbar');
    if (!topbar) return;

    resetTop();

    // Non interpretiamo uno scroll reale dell'utente come bug viewport.
    if (rootScrollY() > 1) return;

    const rawTop = rawVisualTop();
    let shift = rawTop < -0.5 ? Math.ceil(-rawTop) : 0;

    if (!shift) shift = fallbackResidual();

    // Un drift post-keyboard tipico e' nell'ordine di 20-30px. Lasciamo
    // margine fino a 72px per device/configurazioni differenti, ma non oltre.
    shift = Math.max(0, Math.min(72, shift));

    if (shift === appliedShift) return;
    appliedShift = shift;

    if (shift > 0) {
      app.style.transform = `translate3d(0, ${shift}px, 0)`;
      app.dataset.iosEntryFix = String(shift);
    } else {
      clearShift();
    }
  }

  function stopSettling({ keepShift = true } = {}) {
    settleTimers.forEach(clearTimeout);
    settleTimers = [];
    clearTimeout(settleEndTimer);
    settleEndTimer = 0;
    if (vvCleanup) {
      vvCleanup();
      vvCleanup = null;
    }
    settling = false;
    unlockViewport(0);
    if (!keepShift) clearShift();
  }

  function settleAdminViewport() {
    stopSettling({ keepShift: false });
    settling = true;
    blurActiveField();
    lockViewport();
    resetTop();

    const run = () => requestAnimationFrame(() => {
      resetTop();
      measureAndFix();
    });

    run();

    // Safari puo aggiornare la geometria in piu' fasi dopo la chiusura della
    // tastiera; misuriamo il DOM reale lungo tutta la finestra di assestamento.
    [40, 90, 160, 260, 400, 650, 900, 1250, 1700, 2300, 3000].forEach(ms => {
      settleTimers.push(setTimeout(run, ms));
    });

    const vv = window.visualViewport;
    if (vv) {
      const onViewportChange = () => {
        if (settling) run();
      };
      vv.addEventListener('resize', onViewportChange, { passive: true });
      vv.addEventListener('scroll', onViewportChange, { passive: true });
      vvCleanup = () => {
        vv.removeEventListener('resize', onViewportChange);
        vv.removeEventListener('scroll', onViewportChange);
      };
    }

    // Manteniamo la scala bloccata finche' la Dashboard non e' stabilizzata.
    // Poi riabilitiamo il pinch dell'utente, lasciando l'eventuale compensazione
    // geometrica necessaria al bug WebKit.
    unlockViewport(1400);
    settleEndTimer = setTimeout(() => stopSettling({ keepShift: true }), 3400);
  }

  function waitForKeyboardToClose() {
    blurActiveField();
    lockViewport();

    return new Promise(resolve => {
      const vv = window.visualViewport;
      if (!vv) {
        setTimeout(resolve, 120);
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
        resetTop();
        resolve();
      };
      const check = () => {
        if (!keyboardLikelyOpen()) {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, 160);
        }
      };
      const onChange = () => requestAnimationFrame(check);

      vv.addEventListener('resize', onChange, { passive: true });
      vv.addEventListener('scroll', onChange, { passive: true });
      check();
      hardTimer = setTimeout(finish, 1100);
    });
  }

  // admin.js prova a focalizzare automaticamente il token: su iOS non serve e
  // puo aprire/zoomare il viewport prima ancora di un'azione dell'utente.
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

  // Prima di eseguire davvero il login chiudiamo tastiera/AutoFill e teniamo
  // il viewport a scala 1. Al secondo click sintetico lasciamo passare admin.js.
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
      if (button.isConnected) button.click();
    });
  }, true);

  function inspectApp() {
    const loginVisible = !!app.querySelector('.login-card input[type="password"]');
    const adminVisible = !!app.querySelector('.topbar');
    const nextMode = loginVisible ? 'login' : adminVisible ? 'admin' : 'other';

    if (nextMode === mode) {
      if (nextMode === 'admin' && settling) measureAndFix();
      return;
    }

    const previousMode = mode;
    mode = nextMode;

    if (nextMode === 'login') {
      stopSettling({ keepShift: false });
      loginExitPending = true;
      unlockViewport(0);
      return;
    }

    if (nextMode === 'admin') {
      // Lo facciamo anche quando la sessione viene ripristinata al caricamento:
      // una Dashboard appena montata deve sempre partire correttamente in alto.
      if (previousMode !== 'admin') {
        loginExitPending = false;
        settleAdminViewport();
      }
    }
  }

  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(inspectApp).observe(app, {
      childList: true,
      subtree: true
    });
    inspectApp();
  }

  window.addEventListener('orientationchange', () => {
    stopSettling({ keepShift: false });
    setTimeout(() => {
      resetTop();
      if (app.querySelector('.topbar')) settleAdminViewport();
    }, 320);
  });
})();
