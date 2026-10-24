import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

test('original Cloud package exports and includes the observer without circular root import', async () => {
  const require = createRequire(new URL('../sdk/package.json', import.meta.url));
  const entry = require.resolve('@ynx/cloud-client/observe-ide-deployment');
  const module = await import(pathToFileURL(entry).href);
  assert.equal(typeof module.observeIDEDeployment, 'function');
  const pkg = JSON.parse(await readFile(new URL('../sdk/package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.files.includes('observe-ide-deployment.mjs'));
  assert.ok(pkg.files.includes('observe-ide-deployment.d.ts'));
  assert.equal(pkg.exports['./observe-ide-deployment'].types, './observe-ide-deployment.d.ts');
});
