/*
 * CRAL Champions Admin - iOS/mobile viewport fix v3
 *
 * Safari iOS puo mantenere il visual viewport ingrandito e/o spostato
 * orizzontalmente dopo il focus del campo token. Il risultato e una dashboard
 * apparentemente "zoomata" fino al pinch-out manuale.
 *
 * Questa patch:
 * - blocca soltanto l'autofocus JS del token su mobile;
 * - chiude il focus prima dell'accesso;
 * - riporta scroll/offset orizzontale a zero;
 * - al passaggio login -> admin forza per pochi istanti scala 1 e poi
 *   ripristina il normale pinch-to-zoom.
 */
(() => {
  'use strict';

  const mobileLike = window.matchMedia(
    '(max-width: 820px), (hover: none) and (pointer: coarse)'
  ).matches;

  if (!mobileLike) return;

  const NORMAL_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
  const LOCKED_VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

  const viewportMeta = () => document.querySelector('meta[name="viewport"]');

  function zeroHorizontalOffset(resetTop = false) {
    const y = resetTop ? 0 : (window.scrollY || 0);
    try { window.scrollTo(0, y); } catch {}

    if (document.documentElement) document.documentElement.scrollLeft = 0;
    if (document.body) document.body.scrollLeft = 0;
  }

  function blurLoginField() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!active.closest?.('.login-card')) return;
    if (!active.matches('input, select, textarea')) return;
    active.blur();
  }

  let resetTimer = 0;
  let restoreTimer = 0;

  function normalizeViewport({ resetTop = true } = {}) {
    const meta = viewportMeta();
    if (!meta) return;

    clearTimeout(resetTimer);
    clearTimeout(restoreTimer);

    blurLoginField();

    /*
     * Impostare temporaneamente min/max scale a 1 fa rientrare Safari dal
     * visual viewport rimasto zoomato dopo la tastiera. Il vincolo viene poi
     * rimosso, quindi il pinch-to-zoom torna disponibile normalmente.
     */
    meta.setAttribute('content', LOCKED_VIEWPORT);
    zeroHorizontalOffset(resetTop);

    requestAnimationFrame(() => {
      zeroHorizontalOffset(resetTop);
      requestAnimationFrame(() => zeroHorizontalOffset(resetTop));
    });

    resetTimer = window.setTimeout(() => zeroHorizontalOffset(resetTop), 80);

    restoreTimer = window.setTimeout(() => {
      meta.setAttribute('content', NORMAL_VIEWPORT);
      zeroHorizontalOffset(resetTop);
      requestAnimationFrame(() => zeroHorizontalOffset(resetTop));
      window.setTimeout(() => zeroHorizontalOffset(resetTop), 250);
    }, 320);
  }

  /* admin.js esegue token.focus() appena mostra il login: su mobile non serve. */
  if (typeof HTMLInputElement !== 'undefined') {
    const nativeFocus = HTMLInputElement.prototype.focus;

    HTMLInputElement.prototype.focus = function (...args) {
      const isLoginToken =
        this.type === 'password' &&
        typeof this.closest === 'function' &&
        this.closest('.login-card');

      if (isLoginToken) return;
      return nativeFocus.apply(this, args);
    };
  }

  /* Prima del tap su "Verifica e accedi" chiudiamo tastiera/focus e offset. */
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.target.closest?.('.login-card .btn')) return;
      blurLoginField();
      zeroHorizontalOffset(false);
    },
    true
  );

  /* Anche quando il token viene inviato con Invio. */
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter') return;
      if (!document.activeElement?.closest?.('.login-card')) return;
      blurLoginField();
      zeroHorizontalOffset(false);
    },
    true
  );

  /*
   * Il rendering dell'Admin e asincrono. Osserviamo #app e normalizziamo una
   * sola volta quando compare la topbar, cioe dopo che la dashboard e gia nel DOM.
   * Se si torna al login (Esci/token scaduto), la normalizzazione viene riarmata.
   */
  const app = document.getElementById('app');
  if (app && typeof MutationObserver !== 'undefined') {
    let adminNormalized = false;

    const inspect = () => {
      const loginVisible = !!app.querySelector('.login-card');
      const adminVisible = !!app.querySelector('.topbar');

      if (loginVisible) {
        adminNormalized = false;
        return;
      }

      if (adminVisible && !adminNormalized) {
        adminNormalized = true;
        normalizeViewport({ resetTop: true });
      }
    };

    new MutationObserver(inspect).observe(app, { childList: true, subtree: true });
    inspect();
  }

  /* Utile anche tornando alla scheda con Safari che ha conservato un offset. */
  window.addEventListener('pageshow', () => {
    window.setTimeout(() => {
      if (document.querySelector('.topbar')) normalizeViewport({ resetTop: false });
    }, 0);
  });
})();
