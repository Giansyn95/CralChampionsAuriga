/*
 * CRAL Champions Admin - mobile/iOS stability v33
 *
 * V33 mantiene il viewport META stabile durante login e Admin. Su Safari iOS
 * cambiare maximum-scale/user-scalable subito dopo l'autofill puo' causare un
 * nuovo assestamento del visual viewport e lasciare la pagina leggermente
 * scrollata verso il basso. I campi mobile sono gia' >=16px via CSS, quindi il
 * cambio dinamico del viewport non e' necessario.
 *
 * Il reset verticale viene eseguito SOLO nella transizione LOGIN -> ADMIN e
 * segue gli eventi visualViewport per il breve periodo in cui Safari chiude
 * tastiera/autofill. I normali render dell'Admin non toccano scroll o focus.
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

  // Evita che Safari ripristini una vecchia posizione dopo la sostituzione del login.
  try { history.scrollRestoration = 'manual'; } catch {}
  if (meta && meta.getAttribute('content') !== STABLE_VIEWPORT) {
    meta.setAttribute('content', STABLE_VIEWPORT);
  }

  let mode = 'unknown';
  let settleTimer = 0;
  let settleTimers = [];
  let settleVV = null;
  let loginExitPending = false;

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

  function keepCurrentY() {
    const y = window.scrollY || document.scrollingElement?.scrollTop || 0;
    try { window.scrollTo(0, y); } catch {}
    if (document.scrollingElement) document.scrollingElement.scrollLeft = 0;
  }

  function blurActiveField() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, select, textarea')) {
      try { active.blur(); } catch {}
    }
  }

  function settleAdminAtTop() {
    clearSettle();
    blurActiveField();

    const doReset = () => {
      if (!app?.querySelector('.topbar')) return;
      resetTop();
      requestAnimationFrame(resetTop);
    };

    doReset();

    // Safari puo' assestare il visual viewport piu' volte dopo autofill/tastiera.
    const vv = window.visualViewport;
    if (vv) {
      const handler = () => {
        doReset();
        requestAnimationFrame(doReset);
      };
      vv.addEventListener('resize', handler, { passive: true });
      vv.addEventListener('scroll', handler, { passive: true });
      settleVV = { vv, handler };
    }

    // Finestra estesa: con repository piu' grandi (es. tante rose Fantacalcio)
    // il primo render puo' arrivare piu' tardi e Safari puo' correggere il
    // viewport anche qualche secondo dopo l'ultimo assestamento da tastiera.
    [50, 120, 250, 450, 750, 1100, 1600, 2200, 3000, 4000, 5200, 6500].forEach(ms => {
      settleTimers.push(setTimeout(doReset, ms));
    });
    settleTimer = setTimeout(clearSettle, 6800);
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
        timer = setTimeout(finish, 100);
      };

      if (vv) {
        vv.addEventListener('resize', onChange, { passive: true });
        vv.addEventListener('scroll', onChange, { passive: true });
      }
      timer = setTimeout(finish, 500);
    });
  }

  // Evita l'autofocus JS sul token; l'autofill nativo di Safari resta disponibile.
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

  // Prima di sostituire il login chiude tastiera/autofill e poi rilancia il click.
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

    const loginVisible = !!app.querySelector('.login-card');
    const adminVisible = !!app.querySelector('.topbar');
    const nextMode = loginVisible ? 'login' : adminVisible ? 'admin' : 'other';

    if (nextMode === mode) return;

    const previousMode = mode;
    mode = nextMode;

    if (nextMode === 'login') {
      clearSettle();
      loginExitPending = true;
      keepCurrentY();
      return;
    }

    if (nextMode === 'admin') {
      // Solo ingresso reale nell'Admin. Nessun reset durante render/cambio sezione.
      if (previousMode !== 'admin' && (loginExitPending || previousMode === 'login' || previousMode === 'other')) {
        loginExitPending = false;
        settleAdminAtTop();
      }
      return;
    }

    // Loading/intermedio: nessuna modifica allo scroll verticale.
  }

  if (app && typeof MutationObserver !== 'undefined') {
    new MutationObserver(inspectApp).observe(app, { childList: true, subtree: true });
    inspectApp();
  }

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      if (app?.querySelector('.topbar')) keepCurrentY();
    }, 200);
  });
})();
