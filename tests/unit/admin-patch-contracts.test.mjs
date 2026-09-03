import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync('admin/admin.js', 'utf8');
const gh = fs.readFileSync('admin/gh.js', 'utf8');
const html = fs.readFileSync('admin/index.html', 'utf8');
const version = html.match(/admin-pro-v(\d+)\.js/i)?.[1];
assert.ok(version, 'admin/index.html non carica Admin Pro');
const pro = fs.readFileSync(`admin/admin-pro-v${version}.js`, 'utf8');

test('ordine bootstrap: mobile fix -> Admin Pro -> bootstrap originale', () => {
  const mobile = html.indexOf('mobile-fix-v40.js');
  const proIndex = html.indexOf(`admin-pro-v${version}.js`);
  const boot = html.indexOf('admin-boot-v30.js');
  assert.ok(mobile >= 0 && proIndex > mobile && boot > proIndex, 'Ordine script Admin non compatibile');
});

test('i marker testuali richiesti da Admin Pro esistono ancora nei sorgenti base', () => {
  assert.ok(admin.includes("  validateListoneRows, validateNewEvent, validateRosterAgainstListone\n} from './core.js';"), 'Import core.js cambiato: patch Admin Pro da aggiornare');
  assert.ok(admin.includes("  saveSession, loadSession, clearSession\n} from './gh.js';"), 'Import gh.js cambiato: patch Admin Pro da aggiornare');
  assert.ok(admin.includes('sessionCheck();'), 'Marker sessionCheck() non trovato');
  assert.ok(gh.includes("  changes.push({ path: 'tornei.json', content: updateTournamentRegistry(registryText, checked.value, newTournament, !!logoEntry) });"), 'Marker creazione torneo in gh.js non trovato');
});

test('Admin Pro mantiene i contratti critici Promote/Rollback/binari', () => {
  assert.match(pro, /const\s+removed\s*=\s*destFiles\.filter/);
  assert.match(pro, /removed\.forEach\([^\n]+delete\s*:\s*true/);
  assert.ok(pro.includes("'/git/blobs'"));
  assert.ok(pro.includes("encoding:'base64'"));
  assert.ok(pro.includes('currentRegistryText'));
  assert.ok(pro.includes('oldRegistryText'));
});
