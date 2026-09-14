import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gh = fs.readFileSync('admin/gh.js', 'utf8');
const admin = fs.readFileSync('admin/admin.js', 'utf8');

test('nuovo torneo eredita Crea la tua rosa dal template in modo atomico', () => {
  for (const name of ['crea-rosa.html', 'crea-rosa.css', 'crea-rosa.js']) {
    assert.ok(gh.includes(`'${name}'`), `Asset ${name} non gestito nella creazione torneo`);
    assert.ok(gh.includes('rosterBuilderFound.forEach'), 'Copia atomica asset builder non trovata');
  }
  assert.ok(gh.includes('Template Crea la tua rosa incompleto'), 'Manca protezione contro template builder parziali');
  assert.ok(admin.includes('Crea la tua rosa'), 'UI Admin non documenta la copia del builder');
});


test('il nuovo torneo non abilita Fantacalcio nel manifest iniziale solo perche copia il builder', () => {
  const tournamentSource = fs.readFileSync('admin/tournament.js', 'utf8');
  const dataFilesBlock = tournamentSource.slice(0, tournamentSource.indexOf('function csvEscape'));
  assert.ok(!/fantacalcio\//i.test(dataFilesBlock), 'Il manifest iniziale non deve contenere dati Fantacalcio fittizi');
});
