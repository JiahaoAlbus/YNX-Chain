import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('BTC/TRON runtime dependency closure cannot be pruned as development-only', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const roots = ['bitcoinjs-lib', 'tiny-secp256k1', 'ecpair', 'tronweb'], seen = new Set();
  function resolve(from, name) {
    let current = from;
    while (current) {const candidate = current + '/node_modules/' + name; if (lock.packages[candidate]) return candidate; const index = current.lastIndexOf('/node_modules/'); current = index >= 0 ? current.slice(0, index) : '';}
    return 'node_modules/' + name;
  }
  function visit(key) {
    if (seen.has(key)) return; seen.add(key); const entry = lock.packages[key]; assert.ok(entry, 'Missing runtime dependency ' + key); assert.notEqual(entry.dev, true, 'Production prune would remove ' + key);
    for (const name of Object.keys(entry.dependencies ?? {})) visit(resolve(key, name));
  }
  for (const name of roots) {assert.equal(pkg.dependencies[name], lock.packages[''].dependencies[name]); assert.ok(pkg.dependencies[name]); assert.equal(pkg.devDependencies[name], undefined); visit('node_modules/' + name);}
  assert.ok(seen.size > 20, 'Test must cover transitive runtime dependency graph');
});
