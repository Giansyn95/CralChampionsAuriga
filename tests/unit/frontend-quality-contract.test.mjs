import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('tornei/2026-spring/index.html', 'utf8');

test('quality pass: bootstrap Fantacalcio separa mobile reattivo e desktop deferito', () => {
  assert.match(src, /function\s+primeFantacalcioOnIntent\s*\(/);
  assert.match(src, /const mobile=window\.matchMedia\('\(max-width:720px\)'\)\.matches/);
  assert.match(src, /requestAnimationFrame\(\(\)=>setTimeout\(run,120\)\)/);
  assert.match(src, /setTimeout\(queue,2600\)/);
  assert.match(src, /pointerenter',primeFantacalcioOnIntent/);
  assert.doesNotMatch(src, /fantacalcio_cache\.json"\s+as="fetch"/i);
  assert.doesNotMatch(src, /function\s+warmDesktopFantacalcio\s*\(/);
});

test('quality pass: navigazione mobile e controlli hanno touch target e focus coerenti', () => {
  assert.match(src, /--tap-target:44px/);
  assert.match(src, /scroll-snap-type:x proximity/);
  assert.match(src, /function\s+centerActiveTournamentTab\s*\(/);
  assert.match(src, /class="skip-link" href="#tabs"/);
  assert.match(src, /:focus-visible/);
});

test('quality pass: stato caricamento e tema espongono semantica accessibile', () => {
  assert.match(src, /id="status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(src, /color-scheme:light/);
  assert.match(src, /color-scheme:dark/);
});


test('quality pass: switch Classifiche mobile resta leggibile', () => {
  assert.match(src, /classifiche-switch-btn\{padding:10px 6px;font-size:11px;line-height:1\.15/);
});
