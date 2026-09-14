import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const registry=JSON.parse(fs.readFileSync('tornei.json','utf8'));
const norm=s=>String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'');

for(const torneo of registry.tornei||[]){
  const file=path.join(String(torneo.cartella||''),'data','fantacalcio','fantacalcio_cache.json');
  if(!fs.existsSync(file)) continue;

  test(`cache Fantacalcio ${torneo.id||torneo.cartella}: schema e risultati sono validi`,()=>{
    const payload=JSON.parse(fs.readFileSync(file,'utf8'));
    const data=payload?.data||payload;
    assert.equal(Number(data.schema),1,'schema cache inatteso');
    assert.ok(Array.isArray(data.results),'results deve essere un array');
    assert.ok(data.results.length>0,'la cache non deve essere vuota');
    assert.ok(Number.isFinite(Date.parse(data.generatedAt)),'generatedAt deve essere una data ISO valida');
    assert.ok(Number(data.rosterCount)>=0,'rosterCount non valido');
    assert.ok(Number(data.playerCount)>=0,'playerCount non valido');

    const keys=new Set();
    for(const row of data.results){
      assert.ok(Number.isFinite(Number(row.day)) && Number(row.day)>0,'giornata non valida');
      assert.ok(String(row.name||'').trim(),'partecipante mancante');
      assert.ok(Number.isFinite(Number(row.points)),'punti non numerici');
      const key=`${Number(row.day)}|${norm(row.name)}`;
      assert.ok(!keys.has(key),`risultato duplicato nella cache: ${key}`);
      keys.add(key);
    }
  });
}
