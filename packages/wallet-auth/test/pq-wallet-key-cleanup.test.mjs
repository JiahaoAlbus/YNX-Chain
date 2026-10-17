import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// PUBLIC source-custody fault controls only. This loads the exact SDK module
// body with a failing provider import, not a signing engine or valid keys.
// Real provider/backup/signature evidence is recorded separately in Electron.
async function faultModule(mode) {
  let source = await readFile(new URL('../src/pq-wallet-key-backup.js', import.meta.url), 'utf8');
  const id = 'pq-cleanup-test-' + mode;
  const control = {destroyCalls: 0, keygenCalls: 0}; globalThis[id] = control;
  source = source.replace("import {keyGen, exportKeyMaterial, importKeyMaterial, destroyKey} from '@ynx/batch-v01-candidate';", `
    const control = globalThis[${JSON.stringify(id)}];
    const keyGen = () => {control.keygenCalls++; return {privateKey: {}, publicKey: {pkA: new Uint8Array(${mode === 'bad-public' ? 1 : 2592}), pkB: new Uint8Array(64)}};};
    const destroyKey = () => {control.destroyCalls++; throw ${mode === 'bad-public' ? 'false' : 'null'};};
    const exportKeyMaterial = () => {throw Error('UNUSED_PUBLIC_FAULT');};
    const importKeyMaterial = () => {throw Error('UNUSED_PUBLIC_FAULT');};
  `);
  source = source.replaceAll("'./pq-wallet-contract.js'", JSON.stringify(new URL('../src/pq-wallet-contract.js', import.meta.url).href));
  source = source.replaceAll("'./pq-wallet-backup.js'", JSON.stringify(new URL('../src/pq-wallet-backup.js', import.meta.url).href));
  return {sdk: await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')), control, id};
}
test('failed acquisition keeps public-format first cause when provider cleanup throws false', async () => {
  const {sdk, control, id} = await faultModule('bad-public');
  try {
    await assert.rejects(sdk.createPQWalletKeyHandle({chainId: 'ab'.repeat(32), owner: 'isolated-public-custody-test'}), {code: 'PQ_ENCODING_INVALID'});
    assert.equal(sdk.pqWalletKeyCleanupUnresolved(), true);
    assert.equal(control.destroyCalls, 1);
    await assert.rejects(sdk.createPQWalletKeyHandle({chainId: 'ab'.repeat(32), owner: 'isolated-public-custody-test'}), {code: 'PQ_KEY_CLEANUP_UNRESOLVED'});
    assert.equal(control.keygenCalls, 1);
  } finally { delete globalThis[id]; }
});
test('retirement preserves null cleanup cause and never repeats an UNKNOWN provider operation', async () => {
  const {sdk, control, id} = await faultModule('cleanup-null');
  try {
    const handle = await sdk.createPQWalletKeyHandle({chainId: 'ab'.repeat(32), owner: 'isolated-public-custody-test'});
    for (let i = 0; i < 2; i++) {
      let caught = false;
      try { sdk.destroyPQWalletKeyHandle(handle); } catch (cause) { caught = true; assert.equal(cause, null); }
      assert.equal(caught, true);
    }
    assert.equal(control.destroyCalls, 1);
    assert.throws(() => sdk.readPQWalletKeyPublic(handle), {code: 'PQ_KEY_HANDLE_UNAVAILABLE'});
    assert.deepEqual(sdk.readPQWalletKeyCleanupOutcome(handle), {retired: true, cleanupComplete: false, cleanupUnknown: true});
    assert.equal(sdk.pqWalletKeyCleanupUnresolved(), true);
  } finally { delete globalThis[id]; }
});
