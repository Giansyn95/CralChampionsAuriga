/*
 * CRAL Champions Admin - sticky brand logo fix + mobile/iOS stability v35
 *
 * FIX LOGO:
 * renderLogin() ricrea completamente #app quando cambia Ambiente. Prima che
 * il nuovo logo asincrono sia pronto, il markup riparte dal fallback "CR".
 * Questo observer conserva l'ultimo logo valido e lo rimette nel nuovo
 * .brand-mark nello stesso ciclo di rendering, evitando il flash del fallback.
 * Il src viene conservato anche in sessionStorage per coprire il refresh della
 * pagina nella stessa scheda.
 */
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
/*
 * CRAL Champions Admin - mobile/iOS stability v36
 *
 * Mantiene i fix precedenti (blur del token, reset scroll e reset zoom) e
 * aggiunge un hardening specifico per Safari/iOS dopo autofill/tastiera.
 *
 * Su alcune versioni recenti di WebKit il Visual Viewport puo' rimanere
 * traslato verso il basso anche quando window.scrollY/document.scrollTop sono
 * gia' tornati a 0. In quel caso scrollTo(0, 0) da solo non basta e la topbar
 * dell'Admin appare tagliata in alto. Durante la sola transizione LOGIN ->
 * ADMIN compensiamo temporaneamente il residuo visualViewport.offsetTop/pageTop
 * sulla topbar, e lo rimuoviamo non appena Safari riallinea il viewport.
 */
(() => {
  'use strict';

  const isMobile = window.matchMedia(
    '(max-width: 820px), (hover: none) and (pointer: coarse)'
  ).matches;
  if (!isMobile) return;

  const app = document.getElementById('app');
  const meta = document.querySelector('meta[name="viewport"]');
  const STABLE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
  const FORCE_ZOOM_RESET_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

  try { history.scrollRestoration = 'manual'; } catch {}
  if (meta && meta.getAttribute('content') !== STABLE_VIEWPORT) {
    meta.setAttribute('content', STABLE_VIEWPORT);
  }

  let mode = 'unknown';
  let settleTimer = 0;
  let settleTimers = [];
  let settleVV = null;
  let loginExitPending = false;
  let settlingAdmin = false;
  let compensatedTopbar = null;
  let compensatedTopbarMargin = '';

  function rootScrollY() {
    return Math.max(
      0,
      Number(window.scrollY || 0),
      Number(document.scrollingElement?.scrollTop || 0),
      Number(document.documentElement?.scrollTop || 0),
      Number(document.body?.scrollTop || 0)
    );
  }

  function restoreViewportCompensation() {
    if (!compensatedTopbar) return;
    if (compensatedTopbar.isConnected) {
      compensatedTopbar.style.marginTop = compensatedTopbarMargin;
    }
    compensatedTopbar = null;
    compensatedTopbarMargin = '';
  }

  function residualVisualTop() {
    const vv = window.visualViewport;
    if (!vv) return 0;

    const layoutY = rootScrollY();
    const offsetTop = Number(vv.offsetTop || 0);
    const pageResidual = Math.max(0, Number(vv.pageTop || 0) - layoutY);
    const residual = Math.max(offsetTop, pageResidual);

    // Valori sub-pixel sono normali. Limitiamo inoltre la compensazione a un
    // residuo plausibile da toolbar/viewport, non all'altezza della tastiera.
    if (!Number.isFinite(residual) || residual < 1) return 0;
    return Math.min(Math.ceil(residual), 120);
  }

  function applyViewportCompensation() {
    const topbar = app?.querySelector('.topbar');
    if (!topbar) {
      restoreViewportCompensation();
      return;
    }

    // La compensazione serve solo quando il layout documentale e' davvero al
    // top. Se l'utente ha iniziato a scrollare non interferiamo con lui.
    if (rootScrollY() > 1) {
      restoreViewportCompensation();
      return;
    }

    const residual = residualVisualTop();
    if (!residual) {
      restoreViewportCompensation();
      return;
    }

    if (compensatedTopbar !== topbar) {
      restoreViewportCompensation();
      compensatedTopbar = topbar;
      compensatedTopbarMargin = topbar.style.marginTop || '';
    }
    topbar.style.marginTop = `${residual}px`;
  }

  function clearSettle() {
    clearTimeout(settleTimer);
    settleTimers.forEach(clearTimeout);
    settleTimers = [];
    if (settleVV) {
      const vv = settleVV.vv;
      vv.removeEventListener('resize', settleVV.handler);
      vv.removeEventListener('scroll', settleVV.handler);
      settleVV = null;
    }
    settlingAdmin = false;

    // Se WebKit si e' riallineato togliamo subito la compensazione. Se invece
    // persiste ancora un offset, la lasciamo visibile e i listener globali qui
    // sotto la rimuoveranno appena il Visual Viewport torna normale.
    if (!residualVisualTop()) restoreViewportCompensation();
  }

  function resetTop() {
    const scroller = document.scrollingElement || document.documentElement;

    // Il piccolo nudge 1 -> 0 aiuta WebKit a invalidare una vecchia posizione
    // del layout viewport dopo il dismiss della tastiera/autofill.
    try { window.scrollTo(0, 1); } catch {}
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

  function resetZoom() {
    if (!meta) return;
    meta.setAttribute('content', FORCE_ZOOM_RESET_VIEWPORT);
    requestAnimationFrame(() => {
      meta.setAttribute('content', STABLE_VIEWPORT);
    });
  }

  function keepCurrentY() {
    const y = rootScrollY();
    try { window.scrollTo(0, y); } catch {}
    if (document.scrollingElement) document.scrollingElement.scrollLeft = 0;
  }

  function blurActiveField() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, select, textarea')) {
      try { active.blur(); } catch {}
    }
  }

  function postLoginResetStep() {
    if (!app?.querySelector('.topbar')) return;
    resetZoom();
    resetTop();
    applyViewportCompensation();
    requestAnimationFrame(() => {
      resetTop();
      applyViewportCompensation();
    });
  }

  function settleAdminAtTop() {
    clearSettle();
    settlingAdmin = true;
    blurActiveField();
    postLoginResetStep();

    const vv = window.visualViewport;
    if (vv) {
      const handler = () => {
        postLoginResetStep();
        requestAnimationFrame(postLoginResetStep);
      };
      vv.addEventListener('resize', handler, { passive: true });
      vv.addEventListener('scroll', handler, { passive: true });
      settleVV = { vv, handler };
    }

    // Copriamo sia il caricamento asincrono del repository sia i riassestamenti
    // tardivi di Safari dopo Password AutoFill/tastiera.
    [40, 100, 180, 300, 500, 800, 1200, 1800, 2600, 3600, 4800, 6200, 7800].forEach(ms => {
      settleTimers.push(setTimeout(postLoginResetStep, ms));
    });
    settleTimer = setTimeout(clearSettle, 8200);
  }

  function waitForKeyboardToClose() {
    blurActiveField();
    return new Promise(resolve => {
      const vv = window.visualViewport;
      let done = false;
      let timer = 0;

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (vv) {
          vv.removeEventListener('resize', onChange);
          vv.removeEventListener('scroll', onChange);
        }
        resolve();
      };

      const onChange = () => {
        clearTimeout(timer);
        timer = setTimeout(finish, 140);
      };

      if (vv) {
        vv.addEventListener('resize', onChange, { passive: true });
        vv.addEventListener('scroll', onChange, { passive: true });
      }
      timer = setTimeout(finish, 650);
    });
  }

  // Evita l'autofocus JS sul token; Password AutoFill nativo di Safari resta
  // disponibile e non puo' lasciare un focus programmato subito dopo il render.
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

  // Prima di sostituire il login chiudiamo tastiera/autofill. Solo dopo
  // rilanciamo il click originale del pulsante di accesso.
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
      if (button.isConnected) button.click();
    });
  }, true);

  function inspectApp() {
    if (!app) return;

    // Il loader usa anch'esso .login-card: consideriamo vero login solo quello
    // che contiene il campo password. Evita falsi cambi di stato durante il
    // caricamento asincrono dell'Admin.
    const loginVisible = !!app.querySelector('.login-card input[type="password"]');
    const adminVisible = !!app.querySelector('.topbar');
    const nextMode = loginVisible ? 'login' : adminVisible ? 'admin' : 'other';

    if (nextMode === mode) {
      // Admin Pro puo' completare il proprio layout con ulteriori mutazioni DOM.
      // Finche' siamo nella breve fase post-login, riallineiamo anche dopo tali
      // mutazioni senza cambiare il comportamento dei render normali successivi.
      if (nextMode === 'admin' && settlingAdmin) {
        requestAnimationFrame(postLoginResetStep);
      }
      return;
    }

    const previousMode = mode;
    mode = nextMode;

    if (nextMode === 'login') {
      clearSettle();
      restoreViewportCompensation();
      loginExitPending = true;
      keepCurrentY();
      return;
    }

    if (nextMode === 'admin') {
      if (previousMode !== 'admin' && (loginExitPending || previousMode === 'login' || previousMode === 'other')) {
        loginExitPending = false;
        settleAdminAtTop();
      }
      return;
    }
  }

  if (app && typeof MutationObserver !== 'undefined') {
    new MutationObserver(inspectApp).observe(app, { childList: true, subtree: true });
    inspectApp();
  }

  // Listener leggero permanente: serve solo a togliere la compensazione se
  // Safari corregge il Visual Viewport dopo la finestra di settle.
  if (window.visualViewport) {
    const refreshResidual = () => {
      if (!compensatedTopbar) return;
      applyViewportCompensation();
    };
    window.visualViewport.addEventListener('resize', refreshResidual, { passive: true });
    window.visualViewport.addEventListener('scroll', refreshResidual, { passive: true });
  }

  window.addEventListener('scroll', () => {
    if (rootScrollY() > 1) restoreViewportCompensation();
  }, { passive: true });

  window.addEventListener('orientationchange', () => {
    restoreViewportCompensation();
    setTimeout(() => {
      if (app?.querySelector('.topbar')) keepCurrentY();
    }, 200);
  });
})();
