import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('index.html','utf8');
const match=html.match(/\/\* CRAL_HALL_ENGINE_START \*\/([\s\S]*?)\/\* CRAL_HALL_ENGINE_END \*\//);
assert.ok(match,'Motore CRALHallOfFame non trovato nella landing');
const hall=new Function(match[1]+'; return CRALHallOfFame;')();

test('parser Hall of Fame legge CSV separati da punto e virgola',()=>{
  const rows=hall.parseCsv('Posizione;Squadra;Giocatore;Gol\n1;Team A;Mario Rossi;7\n2;Team B;Luca Bianchi;5\n');
  assert.equal(rows.length,2);
  assert.equal(rows[0].Giocatore,'Mario Rossi');
  assert.equal(rows[0].Gol,'7');
});

test('Hall of Fame aggrega titoli e statistiche solo dai dataset passati',()=>{
  const data=hall.build([
    {
      completed:true,
      tournament:{anno:'2025',stagione:'Primavera',ordine:20251,url:'tornei/2025/'},
      standings:[{Posizione:'1',Squadra:'Team A'},{Posizione:'2',Squadra:'Team B'}],
      scorers:[{Posizione:'1',Giocatore:'Mario Rossi',Gol:'7'},{Posizione:'2',Giocatore:'Luca Bianchi',Gol:'5'}],
      mvps:[{Posizione:'1',Giocatore:'Mario Rossi',PuntiMVP:'4'}],
      keepers:[{Posizione:'1',Portiere:'Paolo Verdi',Punti:'3'}]
    },
    {
      completed:true,
      tournament:{anno:'2026',stagione:'Primavera',ordine:20261,url:'tornei/2026/'},
      standings:[{Posizione:'1',Squadra:'Team A'}],
      scorers:[{Posizione:'1',Giocatore:'Mario Rossi',Gol:'8'}],
      mvps:[{Posizione:'1',Giocatore:'Luca Bianchi',PuntiMVP:'6'},{Posizione:'2',Giocatore:'Mario Rossi',PuntiMVP:'3'}],
      keepers:[{Posizione:'1',Portiere:'Paolo Verdi',Punti:'5'}]
    }
  ]);
  assert.equal(data.editions,2);
  assert.deepEqual(data.mostTitles,{name:'Team A',value:2});
  assert.deepEqual(data.allTimeScorer,{name:'Mario Rossi',value:15});
  assert.deepEqual(data.allTimeMvp,{name:'Mario Rossi',value:7});
  assert.deepEqual(data.allTimeKeeper,{name:'Paolo Verdi',value:8});
  assert.equal(data.history[0].tournament.anno,'2026');
});

test('Hall of Fame esclude esplicitamente le edizioni non concluse',()=>{
  const data=hall.build([
    {
      completed:true,
      tournament:{anno:'2026',stagione:'Primavera',ordine:20261},
      standings:[{Posizione:'1',Squadra:'Team A'}],
      scorers:[{Posizione:'1',Giocatore:'Mario Rossi',Gol:'10'}],
      mvps:[{Posizione:'1',Giocatore:'Mario Rossi',PuntiMVP:'7'}],
      keepers:[{Posizione:'1',Portiere:'Paolo Verdi',Punti:'5'}]
    },
    {
      completed:false,
      tournament:{anno:'2026',stagione:'Autunno',ordine:20262},
      standings:[{Posizione:'1',Squadra:'Team B'}],
      scorers:[{Posizione:'1',Giocatore:'Luca Bianchi',Gol:'999'}],
      mvps:[{Posizione:'1',Giocatore:'Luca Bianchi',PuntiMVP:'999'}],
      keepers:[{Posizione:'1',Portiere:'Altro Portiere',Punti:'999'}]
    }
  ]);

  assert.equal(data.editions,1);
  assert.deepEqual(data.mostTitles,{name:'Team A',value:1});
  assert.deepEqual(data.allTimeScorer,{name:'Mario Rossi',value:10});
  assert.deepEqual(data.allTimeMvp,{name:'Mario Rossi',value:7});
  assert.deepEqual(data.allTimeKeeper,{name:'Paolo Verdi',value:5});
  assert.equal(data.history.length,1);
  assert.equal(data.history[0].tournament.stagione,'Primavera');
});

test('Hall of Fame tollera dataset storici parziali senza interrompere il rendering',()=>{
  const data=hall.build([
    {
      completed:true,
      tournament:{anno:'2025',stagione:'Primavera',ordine:20251},
      standings:[{Posizione:'1',Squadra:'Team A'}],
      scorers:[],
      mvps:null,
      keepers:undefined
    }
  ]);

  assert.equal(data.editions,1);
  assert.deepEqual(data.mostTitles,{name:'Team A',value:1});
  assert.equal(data.allTimeScorer,null);
  assert.equal(data.allTimeMvp,null);
  assert.equal(data.allTimeKeeper,null);
});
