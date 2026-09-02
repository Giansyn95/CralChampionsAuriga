/*
 * CRAL Champions Admin - iOS/mobile viewport fix v4
 *
 * La correzione v3 veniva applicata troppo tardi: quando Safari aveva gia
 * ingrandito il visual viewport sul campo token. In v4 il viewport viene
 * bloccato a scala 1 PER TUTTA LA DURATA DEL LOGIN, cioe prima che il token
 * possa ricevere il focus. Quando compare l'Admin il blocco viene rimosso.
 *
 * Inoltre il click su "Verifica e accedi" viene ritardato di pochi ms dopo
 * il blur, cosi la tastiera iOS ha il tempo di chiudersi prima che admin.js
 * sostituisca il DOM del login con la dashboard.
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
        /* Dopo il resize della tastiera aspettiamo un frame stabile. */
        requestAnimationFrame(() => setTimeout(finish, 70));
      };

      if (vv) {
        vv.addEventListener('resize', onViewportChange, { passive: true });
        vv.addEventListener('scroll', onViewportChange, { passive: true });
      }

      /* Fallback: sufficiente anche se visualViewport non invia eventi. */
      timer = setTimeout(finish, 420);
    });
  }

  /*
   * admin.js chiama token.focus() appena renderizza il login. Lo blocchiamo
   * solo per il password field del login; il tap manuale dell'utente continua
   * a funzionare normalmente.
   */
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

  /*
   * Intercettiamo il click PRIMA del listener registrato da admin.js.
   * Primo passaggio: blur + attesa chiusura tastiera.
   * Secondo passaggio (click sintetico con flag): lasciamo eseguire admin.js.
   */
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

    if (loginVisible) {
      /* Fondamentale: il blocco viene applicato PRIMA del focus del token. */
      setViewport(true);
      normalizePosition(false);
      return;
    }

    if (adminVisible) {
      blurActiveField();
      normalizePosition(true);

      /* Aspettiamo che Safari abbia chiuso definitivamente la tastiera. */
      setTimeout(() => {
        setViewport(false);
        normalizePosition(true);
      }, 500);
    }
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
