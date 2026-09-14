import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const roots = ['admin', 'tools'];
const files = [];
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(root, entry.name));
  }
}
if (fs.existsSync('sw.js')) files.push('sw.js');

let failures = 0;

function checkScriptSource(src, filename) {
  try {
    if (/^\s*(import|export)\s/m.test(src)) {
      // I moduli ESM vengono eseguiti direttamente da Node nei relativi test.
      // Qui controlliamo gli script classici con vm.Script.
      return;
    }
    new vm.Script(src, { filename });
    console.log(`OK  ${filename}`);
  } catch (error) {
    failures++;
    console.error(`ERR ${filename}\n${error.stack || error}`);
  }
}

for (const file of files) {
  checkScriptSource(fs.readFileSync(file, 'utf8'), file);
}

// Gran parte del frontend vive volutamente inline negli HTML. Un errore di sintassi
// in quei blocchi fermerebbe l'intera applicazione ma in passato non veniva visto
// dal syntax-check. Compiliamo quindi ogni <script> inline dei due entry point.
const htmlFiles = ['index.html'];
if (fs.existsSync('tornei.json')) {
  try {
    const registry = JSON.parse(fs.readFileSync('tornei.json', 'utf8'));
    for (const torneo of registry.tornei || []) {
      const html = path.join(String(torneo.cartella || ''), 'index.html');
      if (html && fs.existsSync(html)) htmlFiles.push(html);
    }
  } catch (error) {
    failures++;
    console.error(`ERR tornei.json\n${error.stack || error}`);
  }
}

for (const file of [...new Set(htmlFiles)]) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let index = 0;
  while ((match = re.exec(html))) {
    index++;
    checkScriptSource(match[1], `${file}#inline-script-${index}`);
  }
}

if (failures) process.exit(1);
