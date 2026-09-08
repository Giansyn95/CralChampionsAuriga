import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const coreSource = fs.readFileSync(path.join(root, 'admin/core.js'), 'utf8');
const core = await import(`data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`);
const { canonicalPlayerIdentity, aggregateAwards } = core;

const players = [
  { team: 'BOT & BALL', nome: 'Giovanni', cognome: 'Camposeo', fullName: 'Giovanni Camposeo', displayName: 'Camposeo Giovanni' },
  { team: 'Auriga Juniors', nome: 'Nicola', cognome: 'De Toma', fullName: 'Nicola De Toma', displayName: 'De Toma Nicola' },
];

function summaryFile(text) {
  return { rel: 'riepilogo_giornate.csv', text, active: true };
}

function modelWithSummary(text) {
  return { players, fileList: [summaryFile(text)] };
}

test('identità canonica usa Cognome Nome dalla rosa anche se arriva Nome Cognome', () => {
  assert.deepEqual(
    canonicalPlayerIdentity({ players }, 'Giovanni Camposeo', 'BOT & BALL').name,
    'Camposeo Giovanni'
  );
  assert.deepEqual(
    canonicalPlayerIdentity({ players }, 'Nicola De Toma', 'Auriga Juniors').name,
    'De Toma Nicola'
  );
});

test('classifica marcatori accorpa Nome Cognome e Cognome Nome sulla stessa riga', () => {
  const csv = [
    'Sezione;Giornata;Squadra;Giocatore;Goal',
    'Marcatore;1;BOT & BALL;Camposeo Giovanni;1',
    'Marcatore;2;BOT & BALL;Giovanni Camposeo;2',
    'Marcatore;1;Auriga Juniors;De Toma Nicola;9',
    'Marcatore;2;Auriga Juniors;Nicola De Toma;2',
  ].join('\n');
  const model = modelWithSummary(csv);
  const awards = aggregateAwards(model, { rel: 'riepilogo_giornate.csv', content: csv });

  assert.deepEqual(
    awards.scorer.map(x => ({ name: x.name, team: x.team, value: x.value })),
    [
      { name: 'Camposeo Giovanni', team: 'BOT & BALL', value: 3 },
      { name: 'De Toma Nicola', team: 'Auriga Juniors', value: 11 },
    ]
  );
});

test('MVP e portieri usano la stessa identità canonica', () => {
  const csv = [
    'Sezione;Giornata;Squadra;Giocatore;PuntiMVP;PuntiPortiere',
    'MVP;1;BOT & BALL;Camposeo Giovanni;1;',
    'MVP;2;BOT & BALL;Giovanni Camposeo;2;',
    'Miglior portiere;1;Auriga Juniors;De Toma Nicola;;1',
    'Miglior portiere;2;Auriga Juniors;Nicola De Toma;;2',
  ].join('\n');
  const model = modelWithSummary(csv);
  const awards = aggregateAwards(model, { rel: 'riepilogo_giornate.csv', content: csv });

  assert.deepEqual(awards.mvp.map(x => [x.name, x.value]), [['Camposeo Giovanni', 3]]);
  assert.deepEqual(awards.keeper.map(x => [x.name, x.value]), [['De Toma Nicola', 3]]);
});
