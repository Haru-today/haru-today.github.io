// Creates a new review-only asset directory from pinned Git blobs.
// This does not modify the normal release bundle or configure a deployment.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [sourceArgument, outputArgument, ...extra] = process.argv.slice(2);
if (!sourceArgument || !outputArgument || extra.length) {
  throw Error('Usage: node prepare-prodam-review.mjs <PRODAM Git checkout> <new output directory>');
}
const source = await realpath(resolve(sourceArgument));
const output = resolve(outputArgument);
const manifest = JSON.parse(await readFile(join(here, 'prodam-review-manifest.json'), 'utf8'));
if (!/^[0-9a-f]{40}$/.test(manifest.source_commit) || !manifest.assets || Array.isArray(manifest.assets)) throw Error('Invalid review manifest');
const entries = Object.entries(manifest.assets);
if (!entries.length || !manifest.assets['index.html']) throw Error('Incomplete review manifest');
const verified = [];
for (const [file, expected] of entries) {
  if (!/^[A-Za-z0-9._/-]+$/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..') || !/^[0-9a-f]{64}$/.test(expected)) throw Error('Invalid review asset');
  const bytes = execFileSync('git', ['-c', `safe.directory=${source.replaceAll('\\', '/')}`, 'show', `${manifest.source_commit}:dist/${file}`], { cwd: source, maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('Pinned review asset mismatch: ' + file);
  verified.push([file, bytes]);
}
// mkdir without recursive rejects existing output; nothing is deleted or overwritten.
await mkdir(output);
for (const [file, bytes] of verified) {
  const target = join(output, ...file.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
}
console.log(`Prepared ${verified.length} pinned PRODAM assets for local review; no deployment performed.`);
