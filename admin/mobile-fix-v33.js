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
 * CRAL Champions Admin - mobile/iOS stability v34
 *
 * V34 aggiunge, oltre al reset dello scroll verticale gia' presente in v33,
 * anche il reset dello ZOOM: su Safari iOS il focus (anche autofill) su un
 * campo di testo puo' lasciare la pagina "pinch-zoomata" oltre lo schermo
 * (contenuto che sborda a destra) e Safari non la rizooma automaticamente
 * dopo il blur. La tecnica standard per forzare lo zoom a tornare a 1 e'
 * alternare per un istante il meta viewport verso maximum-scale=1/
 * user-scalable=no e poi ripristinare il content stabile (che lascia comunque
 * l'utente libero di pinch-zoomare manualmente in seguito).
 *
 * Il reset (scroll + zoom) viene eseguito SOLO nella transizione LOGIN ->
 * ADMIN e segue gli eventi visualViewport per il periodo in cui Safari chiude
 * tastiera/autofill. I normali render dell'Admin non toccano scroll o zoom.
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
  function resetZoom() {
    if (!meta) return;
    meta.setAttribute('content', FORCE_ZOOM_RESET_VIEWPORT);
    requestAnimationFrame(() => {
      meta.setAttribute('content', STABLE_VIEWPORT);
    });
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
      resetZoom();
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
    // il primo render puo' arrivare piu' tardi e Safari puo' correggere zoom/
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
