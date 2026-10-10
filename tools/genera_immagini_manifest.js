#!/usr/bin/env node
'use strict';

/*
  Genera tornei/<edizione>/immagini/manifest.json per ogni edizione.

  Perche esiste:
  - GitHub Pages non permette di elencare una cartella, e il sito non deve
    provare nomi a caso (centinaia di 404). Il manifest elenca i file
    REALMENTE presenti: basta caricare una foto in immagini/squadre/,
    immagini/giocatori/ o immagini/giocatori/thumb/ e comparira da sola,
    senza modificare nessun elenco nel codice.

  Contenuto:
    { "versione": 1, "squadre": [...], "giocatori": [...], "giocatoriThumb": [...] }
  con i nomi file esatti (estensione inclusa), ordinati.

  E deterministico: se non cambia nulla il file non viene riscritto.

  Uso:  node tools/genera_immagini_manifest.js
*/

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const VERSIONE = 1;
const IMG_RE = /\.(webp|png|jpe?g|avif|gif)$/i;

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && IMG_RE.test(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function main() {
  const base = path.join(root, 'tornei');
  if (!fs.existsSync(base)) { console.log('Cartella tornei/ non trovata: niente da fare.'); return; }

  const editions = fs.readdirSync(base, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(base, e.name, 'index.html')))
    .map(e => e.name)
    .sort();

  let written = 0;
  for (const name of editions) {
    const img = path.join(base, name, 'immagini');
    const manifest = {
      versione: VERSIONE,
      squadre: listImages(path.join(img, 'squadre')),
      giocatori: listImages(path.join(img, 'giocatori')),
      giocatoriThumb: listImages(path.join(img, 'giocatori', 'thumb'))
    };
    const text = JSON.stringify(manifest, null, 1) + '\n';
    const file = path.join(img, 'manifest.json');
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) {
      console.log(`${rel} gia aggiornato.`);
      continue;
    }
    fs.mkdirSync(img, { recursive: true });
    fs.writeFileSync(file, text);
    written++;
    console.log(`${rel} aggiornato: ${manifest.squadre.length} squadre, ${manifest.giocatori.length} giocatori, ${manifest.giocatoriThumb.length} thumb.`);
  }
  console.log(`Edizioni controllate: ${editions.length}, manifest scritti: ${written}.`);
}

main();
