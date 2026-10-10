import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
const generator = path.join(repo, 'tools', 'genera_immagini_manifest.js');
const edition = fs.readFileSync('tornei/2026-spring/index.html', 'utf8');

function makeSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cral-img-'));
  const ed = path.join(dir, 'tornei', '2027-test');
  const put = (rel, text = 'x') => {
    const f = path.join(ed, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  put('index.html', '<!doctype html>');
  put('immagini/squadre/alpha.webp');
  put('immagini/squadre/Beta Team.png');
  put('immagini/giocatori/rossimario.webp');
  put('immagini/giocatori/verdiluca.jpg');
  put('immagini/giocatori/thumb/bianchipaolo.webp');
  put('immagini/giocatori/leggimi.txt');
  fs.mkdirSync(path.join(dir, 'tornei', 'senza-index', 'immagini'), { recursive: true });
  return { dir, ed };
}
const run = cwd => execFileSync('node', [generator], { cwd, encoding: 'utf8' });

test('manifest immagini: elenca solo le immagini presenti, per ogni edizione con index.html', () => {
  const { dir, ed } = makeSite();
  run(dir);
  const m = JSON.parse(fs.readFileSync(path.join(ed, 'immagini', 'manifest.json'), 'utf8'));
  assert.equal(m.versione, 1);
  assert.deepEqual(m.squadre, ['alpha.webp', 'Beta Team.png']);
  assert.deepEqual(m.giocatori, ['rossimario.webp', 'verdiluca.jpg']);
  assert.deepEqual(m.giocatoriThumb, ['bianchipaolo.webp']);
  assert.ok(!fs.existsSync(path.join(dir, 'tornei', 'senza-index', 'immagini', 'manifest.json')), 'cartelle senza index.html ignorate');
});

test('manifest immagini: e deterministico e si aggiorna quando arriva una nuova foto', () => {
  const { dir, ed } = makeSite();
  run(dir);
  const file = path.join(ed, 'immagini', 'manifest.json');
  const first = fs.readFileSync(file, 'utf8');
  assert.match(run(dir), /manifest scritti: 0/);
  assert.equal(fs.readFileSync(file, 'utf8'), first);

  fs.writeFileSync(path.join(ed, 'immagini', 'giocatori', 'neriandrea.webp'), 'x');
  run(dir);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).giocatori.includes('neriandrea.webp'));
});

test('frontend edizione: usa il manifest ma mantiene gli elenchi statici (compatibili con il pannello admin)', () => {
  assert.match(edition, /fetchWithTimeout\('immagini\/manifest\.json'/);
  assert.match(edition, /await imageManifestReady/);
  assert.match(edition, /const fromManifest=manifestImageCandidatesFor\(type,key\)/);
  assert.match(edition, /const\s+STATIC_PLAYER_IMAGE_KEYS\s*=\s*new Set\(\[/);
  assert.match(edition, /const\s+STATIC_TEAM_IMAGE_KEYS\s*=\s*new Set\(\[/);
});
