import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyComposedRuntime, composedTreeDigest } from '../../../services/codeoss-service/src/composed-runtime.mjs';
const developer = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), owned = join(developer, '.ynx-developer-candidates') + '/';
const [input, destination] = process.argv.slice(2), source = await realpath(input), brand = join(developer, 'native/ynx-brand');
assert.equal(process.platform, 'darwin'); assert.ok(source.startsWith(owned) && destination?.startsWith(owned) && destination === resolve(destination) && source !== destination);
try { await lstat(destination); throw Error('Preserve the existing candidate; choose a new path.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const oldPin = JSON.parse(await readFile(source + '.pin.json', 'utf8')), manifest = await verifyComposedRuntime(source, oldPin);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(root, relative = '', rows = {}) {
  for (const name of (await readdir(join(root, relative))).sort()) {
    const path = relative ? relative + '/' + name : name, full = join(root, path), stat = await lstat(full);
    assert.ok(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()));
    if (stat.isDirectory()) await files(root, path, rows);
    else rows[path] = { sha256: sha(await readFile(full)), mode: stat.mode & 0o777 };
  }
  return rows;
}
const newBrand = await files(brand), oldBrand = await files(join(source, 'plugins/ynx.ynx-developer-brand'));
assert.deepEqual(Object.keys(newBrand), Object.keys(oldBrand));
const changed = Object.keys(newBrand).filter(path => JSON.stringify(newBrand[path]) !== JSON.stringify(oldBrand[path]));
assert.deepEqual(changed.sort(), ['klein-light.json', 'package.json']);
const before = await files(source), availableKiB = Number(execFileSync('/bin/df', ['-Pk', developer], { encoding: 'utf8' }).trim().split('\n').at(-1).split(/\s+/)[3]);
const brandKiB = Number(execFileSync('/usr/bin/du', ['-sk', brand], { encoding: 'utf8' }).trim().split(/\s+/)[0]);
const guard = { availableKiB, requiredKiB: brandKiB + 163840, brandKiB, metadataAndMarginKiB: 163840, strategy: 'APFS clone, no ordinary-copy fallback', passed: availableKiB >= brandKiB + 163840 };
await writeFile(destination + '.clone-resource.json', JSON.stringify(guard, null, 2), { flag: 'wx' }); assert.ok(guard.passed);
// Clone current verified bytes. A failed clone remains available for review;
// never retry as a full copy under a clone-sized resource budget.
execFileSync('/bin/cp', ['-cR', source, destination]);
await verifyComposedRuntime(destination, oldPin);
for (const path of changed) await copyFile(join(brand, path), join(destination, 'plugins/ynx.ynx-developer-brand', path));
const after = await files(destination), allowed = new Set(changed.map(path => 'plugins/ynx.ynx-developer-brand/' + path));
assert.deepEqual(Object.keys(before), Object.keys(after));
for (const path of Object.keys(before)) if (!allowed.has(path)) assert.deepEqual(after[path], before[path]);
assert.equal(await composedTreeDigest(source), oldPin.treeSha256);
const metadata = JSON.parse(await readFile(join(brand, 'package.json'), 'utf8')); assert.equal(metadata.publisher, 'ynx'); assert.equal(metadata.name, 'ynx-developer-brand');
manifest.ynxBrandVersion = metadata.version; manifest.treeSha256 = await composedTreeDigest(destination);
const bytes = JSON.stringify(manifest, null, 2) + '\n'; await writeFile(join(destination, 'YNX-COMPOSED-RUNTIME.json'), bytes);
const pin = { ...oldPin, treeSha256: manifest.treeSha256, manifestSha256: sha(bytes) };
await writeFile(destination + '.pin.json', JSON.stringify(pin, null, 2) + '\n', { flag: 'wx' }); await verifyComposedRuntime(destination, pin); await verifyComposedRuntime(source, oldPin);
await writeFile(destination + '.clone-receipt.json', JSON.stringify({ source, oldPin, pin, guard, changedFiles: [...allowed], allOtherFilesUnchanged: true, sourceCandidateUnchanged: true, brandSourceFiles: newBrand }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ destination, pin, brandVersion: metadata.version, guard }));
