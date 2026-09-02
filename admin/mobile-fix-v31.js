/*
 * CRAL Champions Admin - iOS/mobile viewport fix v31
 *
 * Correzione principale rispetto a mobile-fix v4/v13:
 * il MutationObserver non deve mai riportare la pagina a scrollY=0 ad ogni
 * modifica del DOM dell'Admin. admin.js ricostruisce spesso il contenuto di
 * <main> durante input/change/render; la vecchia inspectApp() interpretava
 * ogni mutation come un nuovo ingresso nell'Admin, faceva blur() del campo
 * attivo e normalizePosition(true), causando i salti verso l'alto su mobile.
 *
 * V31 esegue il reset verticale SOLO nella transizione LOGIN -> ADMIN.
 * Durante i normali render interni preserva scroll, focus e tastiera.
 */
(() => {
  'use strict';

  const isMobile = window.matchMedia(
    '(max-width: 820px), (hover: none) and (pointer: coarse)'
  ).matches;

  if (!isMobile) return;

  const BASE_VIEWPORT =
    'width=device-width, initial-scale=1, viewport-fit=cover';
  const LOGIN_VIEWPORT =
    'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

  const meta = document.querySelector('meta[name="viewport"]');
  const app = document.getElementById('app');
  let mode = 'unknown'; // unknown | login | admin | other
  let adminUnlockTimer = 0;

  function setViewport(loginLocked) {
    if (!meta) return;
    const next = loginLocked ? LOGIN_VIEWPORT : BASE_VIEWPORT;
    if (meta.getAttribute('content') !== next) meta.setAttribute('content', next);
  }

  function zeroX(resetTop = false) {
    const y = resetTop ? 0 : (window.scrollY || 0);
    try { window.scrollTo(0, y); } catch {}
    if (document.documentElement) document.documentElement.scrollLeft = 0;
    if (document.body) document.body.scrollLeft = 0;
  }

  function blurActiveField() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, select, textarea')) {
      active.blur();
    }
  }

  function normalizePosition(resetTop = false) {
    zeroX(resetTop);
    requestAnimationFrame(() => {
      zeroX(resetTop);
      requestAnimationFrame(() => zeroX(resetTop));
    });
    setTimeout(() => zeroX(resetTop), 80);
    setTimeout(() => zeroX(resetTop), 250);
  }

  function waitForKeyboardToClose() {
    blurActiveField();
    normalizePosition(false);

    return new Promise(resolve => {
      const vv = window.visualViewport;
      let finished = false;
      let timer = 0;

      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (vv) {
          vv.removeEventListener('resize', onViewportChange);
          vv.removeEventListener('scroll', onViewportChange);
        }
        normalizePosition(false);
        resolve();
      };

      const onViewportChange = () => {
        normalizePosition(false);
        requestAnimationFrame(() => setTimeout(finish, 70));
      };

      if (vv) {
        vv.addEventListener('resize', onViewportChange, { passive: true });
        vv.addEventListener('scroll', onViewportChange, { passive: true });
      }

      timer = setTimeout(finish, 420);
    });
  }

  /* Blocca soltanto l'autofocus programmatico sul token del login. */
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

  /* Chiude stabilmente la tastiera prima che il login venga sostituito. */
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
    waitForKeyboardToClose().then(() => {
      if (button.isConnected) button.click();
    });
  }, true);

  function inspectApp() {
    if (!app) return;

    const loginVisible = !!app.querySelector('.login-card');
    const adminVisible = !!app.querySelector('.topbar');
    const nextMode = loginVisible ? 'login' : adminVisible ? 'admin' : 'other';

    if (nextMode === mode) {
      // Fondamentale: i normali render dell'Admin NON devono toccare scroll/focus.
      return;
    }

    const previousMode = mode;
    mode = nextMode;

    if (nextMode === 'login') {
      clearTimeout(adminUnlockTimer);
      setViewport(true);
      // Mantieni la posizione verticale corrente; correggi soltanto eventuale drift orizzontale.
      normalizePosition(false);
      return;
    }

    if (nextMode === 'admin') {
      clearTimeout(adminUnlockTimer);

      // Reset in alto solo quando si entra davvero nell'Admin dal login/boot.
      // Mai durante render(), cambio sezione, input/change o aggiornamenti del DOM.
      if (previousMode !== 'admin') {
        blurActiveField();
        normalizePosition(true);
      }

      adminUnlockTimer = setTimeout(() => {
        setViewport(false);
        if (previousMode !== 'admin') normalizePosition(true);
      }, 500);
      return;
    }

    // Schermate intermedie/loading: non modificare lo scroll verticale.
    normalizePosition(false);
  }

  if (app && typeof MutationObserver !== 'undefined') {
    new MutationObserver(inspectApp).observe(app, {
      childList: true,
      subtree: true
    });
    inspectApp();
  }

  window.addEventListener('pageshow', () => {
    setTimeout(inspectApp, 0);
  });

  window.addEventListener('orientationchange', () => {
    setTimeout(() => normalizePosition(false), 200);
  });
})();
