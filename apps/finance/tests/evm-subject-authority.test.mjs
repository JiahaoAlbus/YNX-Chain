import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';

const script = new URL('../scripts/evm-subject-authority.mjs', import.meta.url);
const bundle = new URL('../scripts/evm-subject-authority.bundle.mjs', import.meta.url);

test('Finance EVM-only subject bridge is a byte-reproducible Wallet/Auth root consumer', async () => {
  const options = {
    absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)),
    entryPoints: [fileURLToPath(script)], bundle: true, platform: 'node', target: 'node22', format: 'esm', write: false,
  };
  const [first, second, frozen] = await Promise.all([build(options), build(options), readFile(bundle)]);
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), Buffer.from(second.outputFiles[0].contents));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), frozen);
  assert.equal(frozen.includes(Buffer.from("from '@ynx-chain/wallet-auth'")), false);
});
