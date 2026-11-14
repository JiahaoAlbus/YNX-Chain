import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Execute the production startup module with PUBLIC stand-ins for its two
// dependencies. Never import a configured SDK or manufacture authority.
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'ynx-startup-fallback-'));
  try {
    await copyFile(new URL('./wallet-admission-startup.mjs', import.meta.url), join(root, 'startup.mjs'));
    await writeFile(join(root, 'identity-sdk-loader.mjs'), `export let supplier; export function set(value){supplier=value;} export async function loadBundledIdentitySDK(){return supplier;}`);
    await writeFile(join(root, 'wallet-admission-delivery.mjs'), `export let delivery; export function set(value){delivery=value;} export async function openOriginalParentDelivery(){return delivery;}`);
    const loader = await import(pathToFileURL(join(root, 'identity-sdk-loader.mjs')));
    const parent = await import(pathToFileURL(join(root, 'wallet-admission-delivery.mjs')));
    const startup = await import(pathToFileURL(join(root, 'startup.mjs')));
    await run({ loader, parent, startup });
  } finally { await rm(root, { recursive: true, force: true }); }
}
for (const asynchronous of [false, true]) test(`fallback ${asynchronous ? 'async rejection' : 'sync throw'} preserves local startup and original refusal`, () => fixture(async ({ loader, startup }) => {
  const first = Object.assign(new Error('PUBLIC original refusal'), { code: 'WALLET_SERVICE_ADMISSION_DENIED' });
  let calls = 0;
  loader.set({ openOriginalIDEServiceAdmissionSupplier(entry) {
    calls++; assert.equal(entry, 'file:///PUBLIC/Resources/server.mjs');
    if (asynchronous) return Promise.reject(first);
    throw first;
  } });
  const result = await startup.openBundledWalletAdmission('file:///PUBLIC/Resources/server.mjs');
  let localStarted = false;
  const startLocal = admission => { assert.throws(() => admission.assertCurrent(), error => error === first); localStarted = true; };
  startLocal(result);
  result.close(); result.close();
  assert.deepEqual(await result.finishCleanup(), { complete: true });
  assert.equal(calls, 1); assert.equal(localStarted, true);
}));
test('fallback success retains exact supplier object', () => fixture(async ({ loader, startup }) => {
  const admission = Object.freeze({ assertCurrent() { throw Error('PUBLIC no activation'); } });
  loader.set({ openOriginalIDEServiceAdmissionSupplier: async () => admission });
  assert.equal(await startup.openBundledWalletAdmission('file:///PUBLIC/server.mjs'), admission);
}));
test('acquired cleanup-only delivery is neither replaced nor closed by startup', () => fixture(async ({ loader, parent, startup }) => {
  let closes = 0;
  const delivery = { assertCurrent() { throw Error('PUBLIC retained refusal'); }, close() { closes++; } };
  parent.set(delivery);
  loader.set({ openOriginalIDEServiceAdmissionSupplier() { throw Error('must not reacquire'); } });
  assert.equal(await startup.openBundledWalletAdmission('file:///PUBLIC/server.mjs'), delivery);
  assert.equal(closes, 0);
}));
