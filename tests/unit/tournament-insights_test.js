import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('tornei/2026-spring/index.html','utf8');
const match=html.match(/\/\* CRAL_INSIGHTS_ENGINE_START \*\/([\s\S]*?)\/\* CRAL_INSIGHTS_ENGINE_END \*\//);
assert.ok(match,'Motore CRALInsights non trovato nell\'index del torneo');
const insights=new Function(match[1]+'; return CRALInsights;')();
const {buildTournamentRecords,buildTeamInsights,buildPlayerAchievements,consecutiveRoundStreak}=insights;

test('record torneo: gol, goleada, attacco/difesa e streak sono derivati dai risultati',()=>{
  const records=buildTournamentRecords({
    matches:[
      {round:1,home:'A',away:'B',homeGoals:4,awayGoals:2},
      {round:2,home:'C',away:'A',homeGoals:1,awayGoals:3},
      {round:3,home:'A',away:'C',homeGoals:5,awayGoals:0},
      {round:4,home:'B',away:'A',homeGoals:2,awayGoals:2}
    ],
    standings:[
      {position:1,team:'A',goalsFor:14,goalsAgainst:5},
      {position:2,team:'B',goalsFor:6,goalsAgainst:8},
      {position:3,team:'C',goalsFor:3,goalsAgainst:10}
    ],
    scorers:[
      {position:1,name:'Mario Rossi',team:'A',goals:8},
      {position:2,name:'Luca Bianchi',team:'B',goals:5}
    ]
  });
  assert.equal(records.totalGoals,19);
  assert.equal(records.playedMatches,4);
  assert.equal(records.highestScoringMatch.home,'A');
  assert.equal(records.highestScoringMatch.away,'B');
  assert.equal(records.biggestWin.home,'A');
  assert.equal(records.biggestWin.away,'C');
  assert.deepEqual(records.bestAttack,{team:'A',value:14});
  assert.deepEqual(records.bestDefense,{team:'A',value:5});
  assert.deepEqual(records.longestWinningStreak,{team:'A',value:3});
  assert.deepEqual(records.longestUnbeatenStreak,{team:'A',value:4});
  assert.equal(records.topScorer.name,'Mario Rossi');
});


test('DNA squadra: medie, strisce, rivalita e vittoria piu larga sono derivati dalle partite',()=>{
  const dna=buildTeamInsights({
    team:'A', gf:12, ga:6,
    matches:[
      {giornataNum:1,home:'A',away:'B',score:'4-1'},
      {giornataNum:2,home:'C',away:'A',score:'2-2'},
      {giornataNum:3,home:'B',away:'A',score:'0-3'},
      {giornataNum:4,home:'A',away:'C',score:'3-3'}
    ]
  });
  assert.equal(dna.played,4);
  assert.equal(dna.avgFor,3);
  assert.equal(dna.avgAgainst,1.5);
  assert.equal(dna.bestUnbeatenStreak,4);
  assert.equal(dna.bestWinningStreak,1);
  assert.equal(dna.favoriteOpponent.opponent,'B');
  assert.equal(dna.favoriteOpponent.points,6);
  assert.equal(dna.nemesis.opponent,'C');
  assert.equal(dna.nemesis.points,2);
  assert.equal(dna.bestWin.opponent,'B');
  assert.equal(dna.bestWin.gf-dna.bestWin.ga,3);
});

test('achievement: vengono sbloccati solo da dati reali del giocatore',()=>{
  const achievements=buildPlayerAchievements({
    goals:12,
    appearances:8,
    teamMatches:8,
    scorerRank:1,
    mvpRank:2,
    mvpPoints:8,
    mvpAwards:3,
    goalEntries:[
      {round:2,value:1},{round:3,value:3},{round:4,value:2},{round:5,value:1}
    ],
    restRounds:[],
    tournamentComplete:true,
    teamChampion:true
  });
  const byId=Object.fromEntries(achievements.map(x=>[x.id,x]));
  ['champion','top-scorer','double-digits','hat-trick','on-fire','mvp-serial','always-there'].forEach(id=>assert.ok(byId[id],id));
  // Gerarchia di importanza per ruolo: oro = leadership/titolo, argento =
  // eccellenza ricorrente non al vertice, bronzo = exploit puntuali/presenza.
  assert.equal(byId.champion.level,'gold');
  assert.equal(byId['top-scorer'].level,'gold');
  assert.equal(byId['on-fire'].level,'gold');
  assert.equal(byId['double-digits'].level,'silver');
  assert.equal(byId['mvp-serial'].level,'silver');
  assert.equal(byId['hat-trick'].level,'bronze');
  assert.equal(byId['always-there'].level,'bronze');
});

test('achievement on-fire: la serie tiene conto dei turni di riposo della squadra',()=>{
  // Il giocatore segna alle giornate 2 e 4, la sua squadra riposa alla 3
  // (torneo a squadre dispari): deve comunque sbloccare "on fire" (streak 3
  // sarebbe richiesto solo se combinato con un\'altra giornata a segno).
  const achievements=buildPlayerAchievements({
    goals:3,
    goalEntries:[{round:1,value:1},{round:2,value:1},{round:4,value:1}],
    restRounds:[3]
  });
  const onFire=achievements.find(a=>a.id==='on-fire');
  assert.ok(onFire,'la serie 1-2-(riposo)-4 deve valere come 3 giornate consecutive');
  assert.match(onFire.description,/3 giornate consecutive/);
});

test('achievement multigol: titolo e descrizione cambiano con il numero di reti',()=>{
  const withMax=(max)=>buildPlayerAchievements({
    goals:max,
    goalEntries:[{round:1,value:max}]
  }).find(a=>a.id==='hat-trick');

  const tripletta=withMax(3);
  assert.equal(tripletta.title,'Tripletta');
  assert.equal(tripletta.description,'3 gol nella stessa giornata');

  const poker=withMax(4);
  assert.equal(poker.title,'Poker');
  assert.equal(poker.description,'4 gol nella stessa giornata');

  const cinquina=withMax(5);
  assert.equal(cinquina.title,'Cinquina');
  assert.equal(cinquina.description,'5 gol nella stessa giornata');

  const oltre=withMax(6);
  assert.equal(oltre.title,'6 gol in una giornata');
  // Titolo e descrizione non devono ripetere lo stesso numero due volte.
  assert.equal(oltre.description,'Prestazione da record in una singola giornata');
});

test('streak goal richiede giornate consecutive e ignora duplicati',()=>{
  assert.equal(consecutiveRoundStreak([1,2,2,3,6]),3);
  assert.equal(consecutiveRoundStreak([1,3,5]),1);
});

test('streak goal non si interrompe se il buco e\' un turno di riposo della squadra',()=>{
  // Squadra dispari: la squadra del giocatore riposa alla giornata 3.
  // Ha segnato alla 2 e alla 4: e\' comunque una serie di 2 giornate
  // consecutive giocate, non deve azzerarsi.
  assert.equal(consecutiveRoundStreak([2,4],[3]),2);
  // Due riposi di fila (torneo con piu' squadre dispari/calendario irregolare).
  assert.equal(consecutiveRoundStreak([2,5],[3,4]),2);
  // Se il buco NON e' un riposo (il giocatore ha semplicemente saltato una
  // giornata senza segnare), la serie deve comunque interrompersi.
  assert.equal(consecutiveRoundStreak([2,4],[]),1);
  assert.equal(consecutiveRoundStreak([2,4],[5]),1);
  // Riposo che copre solo parte del buco: non basta a "ponticellare".
  assert.equal(consecutiveRoundStreak([2,5],[3]),1);
  // Una serie piu' lunga con un riposo nel mezzo resta un\'unica striscia.
  assert.equal(consecutiveRoundStreak([1,2,4,5],[3]),4);
  // Accetta anche un Set oltre che un array.
  assert.equal(consecutiveRoundStreak([2,4],new Set([3])),2);
});

test('insights degradano in modo sicuro con dataset vuoti o incompleti',()=>{
  const records=buildTournamentRecords({matches:[],standings:[],scorers:[]});
  assert.equal(records.playedMatches,0);
  assert.equal(records.totalGoals,0);
  assert.equal(records.highestScoringMatch,null);
  assert.equal(records.biggestWin,null);
  assert.equal(records.bestAttack,null);
  assert.equal(records.bestDefense,null);
  assert.equal(records.topScorer,null);

  const dna=buildTeamInsights({team:'A',matches:[]});
  assert.equal(dna.played,0);
  assert.equal(dna.avgFor,0);
  assert.equal(dna.avgAgainst,0);
  assert.equal(dna.favoriteOpponent,null);
  assert.equal(dna.nemesis,null);
  assert.equal(dna.bestWin,null);

  const achievements=buildPlayerAchievements({});
  assert.ok(Array.isArray(achievements));
  assert.equal(achievements.length,0);
});
