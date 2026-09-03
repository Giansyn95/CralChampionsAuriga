import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('admin/index.html', 'utf8');
const version = html.match(/admin-pro-v(\d+)\.js/i)?.[1];
assert.ok(version, 'Admin Pro non referenziato da admin/index.html');
const source = fs.readFileSync(`admin/admin-pro-v${version}.js`, 'utf8');
const start = source.indexOf('function proRoundRobin(');
const end = source.indexOf('function proIsoDate', start);
assert.ok(start >= 0 && end > start, 'proRoundRobin non trovata');
const fnSource = source.slice(start, end).trim();
const proRoundRobin = new Function(`${fnSource}; return proRoundRobin;`)();

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

for (const teams of [
  ['A', 'B', 'C', 'D'],
  ['A', 'B', 'C', 'D', 'E']
]) {
  test(`round-robin: ${teams.length} squadre, ogni coppia si incontra una volta`, () => {
    const rounds = proRoundRobin(teams);
    const seen = new Set();
    const appearances = new Map(teams.map(t => [t, 0]));
    for (const round of rounds) {
      const inRound = new Set();
      for (const [home, away] of round) {
        assert.notEqual(home, away);
        assert.ok(!inRound.has(home), `${home} compare due volte nello stesso turno`);
        assert.ok(!inRound.has(away), `${away} compare due volte nello stesso turno`);
        inRound.add(home); inRound.add(away);
        const key = pairKey(home, away);
        assert.ok(!seen.has(key), `coppia duplicata ${key}`);
        seen.add(key);
        appearances.set(home, appearances.get(home) + 1);
        appearances.set(away, appearances.get(away) + 1);
      }
    }
    assert.equal(seen.size, teams.length * (teams.length - 1) / 2);
    for (const team of teams) assert.equal(appearances.get(team), teams.length - 1);
  });
}
