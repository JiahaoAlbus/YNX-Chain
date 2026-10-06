import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = new URL('../vendor/wallet-auth-c5/', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
test('accepted c5 direct-import closure preserves every supplied source byte and existing dependency lock', async () => {
  const raw = await readFile(new URL('SOURCE_CLOSURE.json', source));
  assert.equal(digest(raw), '4c7196b1d2156d13565e528fd7fd623a2fd4c61c91602fef81e2b50d79df5d9c');
  const closure = JSON.parse(raw);
  for (const entry of closure.files) {
    assert.match(entry.path, /^packages\/wallet-auth\//);
    assert.ok(!entry.path.includes('..'));
    const bytes = await readFile(new URL(entry.path.slice('packages/wallet-auth/'.length), source));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(digest(bytes), entry.sha256, entry.path);
  }
  const supplied = JSON.parse(await readFile(new URL('package-lock.json', source)));
  const retained = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
  for (const name of ['@noble/curves', '@noble/hashes']) {
    const key = `node_modules/${name}`;
    assert.equal(retained.packages[key].version, supplied.packages[key].version);
    assert.equal(retained.packages[key].integrity, supplied.packages[key].integrity);
  }
});
