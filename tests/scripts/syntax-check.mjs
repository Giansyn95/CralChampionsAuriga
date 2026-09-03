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
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  try {
    if (/^\s*(import|export)\s/m.test(src)) {
      // new SourceTextModule is not available in all Node builds without flags.
      // Use a conservative syntax check by invoking Node itself in CI for modules.
      continue;
    }
    new vm.Script(src, { filename: file });
    console.log(`OK  ${file}`);
  } catch (error) {
    failures++;
    console.error(`ERR ${file}\n${error.stack || error}`);
  }
}
if (failures) process.exit(1);
