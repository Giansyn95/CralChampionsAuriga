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

test('Hall of Fame aggrega statistiche solo dai dataset passati e individua il primo campione',()=>{
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
  // La squadra campione dell'edizione più vecchia (2025), non più "chi ha vinto di più".
  assert.equal(data.firstChampion.name,'Team A');
  assert.equal(data.firstChampion.value,'2025');
  assert.equal(data.allTimeScorer.name,'Mario Rossi');
  assert.equal(data.allTimeScorer.value,15);
  assert.equal(data.allTimeMvp.name,'Mario Rossi');
  assert.equal(data.allTimeMvp.value,7);
  assert.equal(data.allTimeKeeper.name,'Paolo Verdi');
  assert.equal(data.allTimeKeeper.value,8);
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
  assert.equal(data.firstChampion.name,'Team A');
  assert.equal(data.allTimeScorer.name,'Mario Rossi');
  assert.equal(data.allTimeScorer.value,10);
  assert.equal(data.allTimeMvp.name,'Mario Rossi');
  assert.equal(data.allTimeMvp.value,7);
  assert.equal(data.allTimeKeeper.name,'Paolo Verdi');
  assert.equal(data.allTimeKeeper.value,5);
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
  assert.equal(data.firstChampion.name,'Team A');
  assert.equal(data.allTimeScorer,null);
  assert.equal(data.allTimeMvp,null);
  assert.equal(data.allTimeKeeper,null);
});

test('A parità di valore vince chi ha raggiunto il record per primo, non l\'ordine alfabetico',()=>{
  const data=hall.build([
    {
      // Edizione più vecchia: Zorro Bianchi segna 5 gol per primo.
      completed:true,
      tournament:{anno:'2024',stagione:'Primavera',ordine:20241},
      standings:[{Posizione:'1',Squadra:'Team A'}],
      scorers:[{Posizione:'1',Giocatore:'Zorro Bianchi',Gol:'5'}],
      mvps:[],
      keepers:[]
    },
    {
      // Edizione successiva: Ada Rossi eguaglia lo stesso totale (5 gol),
      // ma più tardi nel tempo. Alfabeticamente "Ada" batterebbe "Zorro",
      // ma deve vincere chi ci è arrivato prima: Zorro Bianchi.
      completed:true,
      tournament:{anno:'2025',stagione:'Primavera',ordine:20251},
      standings:[{Posizione:'1',Squadra:'Team B'}],
      scorers:[{Posizione:'1',Giocatore:'Ada Rossi',Gol:'5'}],
      mvps:[],
      keepers:[]
    }
  ]);
  assert.equal(data.allTimeScorer.name,'Zorro Bianchi');
  assert.equal(data.allTimeScorer.value,5);
});
