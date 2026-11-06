// Review-only protected bundle staging. Does not change the normal release or deploy.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [sourceArgument, targetArgument, ...extra] = process.argv.slice(2);
if (!sourceArgument || !targetArgument || extra.length) throw Error('Usage: node prepare-prodam-bundle.mjs <reviewed assets directory> <new target directory>');
const source = await realpath(resolve(sourceArgument));
const requestedTarget = resolve(targetArgument), parent = await realpath(dirname(requestedTarget));
const target = join(parent, basename(requestedTarget));
const overlap = (a,b) => { const r = relative(a,b); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep)); };
if (overlap(source,target) || overlap(target,source)) throw Error('Source and target must be separate');
const manifest = JSON.parse(await readFile(join(here,'prodam-review-manifest.json'),'utf8'));
if (manifest.source_commit !== 'd7b9f435dbf2493342233e2ea81b375d64fc8e1a') throw Error('Unexpected source commit');
const files = [];
async function collect(dir, prefix='') {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const name = prefix ? prefix+'/'+entry.name : entry.name;
    if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').some(part=>!part || part==='.' || part==='..')) throw Error('Invalid asset path');
    const file = join(dir,entry.name), st = await lstat(file);
    if (st.isSymbolicLink()) throw Error('Symlink in source: '+name);
    if (st.isDirectory()) await collect(file,name);
    else if (st.isFile()) files.push(name);
    else throw Error('Unexpected asset entry: '+name);
  }
}
await collect(source);
const expected = Object.keys(manifest.assets || {}).sort();
if (expected.length !== 21 || JSON.stringify(files.sort()) !== JSON.stringify(expected)) throw Error('Source asset set differs from pinned manifest');
const validated = [];
for (const name of files) {
  const bytes = await readFile(join(source,...name.split('/')));
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.assets[name]) throw Error('Asset checksum mismatch: '+name);
  validated.push([name,bytes]);
}
// Never merge with, overwrite or remove an existing output directory.
await mkdir(target);
for (const [name,bytes] of validated) {
  const file = join(target,...name.split('/'));
  await mkdir(dirname(file),{recursive:true});
  await writeFile(file,bytes,{flag:'wx'});
}
console.log(`Prepared ${validated.length} verified assets for a protected bundle; no deployment performed.`);
