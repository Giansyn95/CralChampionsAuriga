/*
 * CRAL Champions Admin - iOS login zoom fix
 *
 * admin.js mette automaticamente a fuoco il campo token appena apre il login.
 * Su Safari mobile un focus programmato puo lasciare il visual viewport ingrandito
 * anche dopo il passaggio alla dashboard. Qui blocchiamo esclusivamente quel focus
 * via JavaScript sui dispositivi touch/mobile. Il tap manuale sul campo continua
 * a funzionare normalmente.
 */
(() => {
  'use strict';

  const mobileLike = window.matchMedia(
    '(max-width: 820px), (hover: none) and (pointer: coarse)'
  ).matches;

  if (!mobileLike || typeof HTMLInputElement === 'undefined') return;

  const nativeFocus = HTMLInputElement.prototype.focus;

  HTMLInputElement.prototype.focus = function (...args) {
    const isLoginToken =
      this.type === 'password' &&
      typeof this.closest === 'function' &&
      this.closest('.login-card');

    if (isLoginToken) return;
    return nativeFocus.apply(this, args);
  };

  const blurActiveLoginField = () => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!active.closest?.('.login-card')) return;
    if (!active.matches('input, select, textarea')) return;
    active.blur();
  };

  /* Chiude esplicitamente il focus prima che il login venga sostituito. */
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target.closest?.('.login-card .btn')) {
        blurActiveLoginField();
      }
    },
    true
  );

  /* Stesso comportamento quando si invia il token con Invio. */
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && document.activeElement?.closest?.('.login-card')) {
        blurActiveLoginField();
      }
    },
    true
  );
})();
