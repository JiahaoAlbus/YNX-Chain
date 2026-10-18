import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// PUBLIC module fixtures test the real IDE startup import/call graph only.
// No Native module, credential, signer, Source or actual authority is supplied.
const entry = 'file:///Applications/YNX%20Developer.app/Contents/Resources/server.mjs';
async function fixture(mode, run) {
  const root = await mkdtemp(join(tmpdir(), 'ynx-identity-startup-'));
  const desktop = join(root, 'apps/developer/desktop'), sdk = join(root, 'packages/wallet-auth');
  try {
    await mkdir(desktop, { recursive: true });
    for (const name of ['wallet-admission-startup.mjs', 'wallet-admission-delivery.mjs', 'wallet-identity-v2-caller.mjs', 'private-payload-pump.mjs'])
      await copyFile(fileURLToPath(new URL(name, import.meta.url)), join(desktop, name));
    for (const name of ['src', 'scripts', 'native']) await mkdir(join(sdk, name), { recursive: true });
    await writeFile(join(sdk, 'package.json'), '{"type":"module"}');
    await writeFile(join(sdk, 'scripts/ynx-ide-service-admission-supplier.mjs'), `
      export let legacyAcquisitions=0;
      export function acquireOriginalIDEAdmissionParentDelivery(){legacyAcquisitions++;return null;}
      export function openOriginalIDEServiceAdmissionSupplier(){return {assertCurrent(){throw Object.assign(Error('not supplied'),{code:'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED'});}};}
    `);
    const construct = `
      export const calls=[]; export const original=Error('PUBLIC_ORIGINAL');
      const owner={assertReady(){calls.push(['assertReady']);${mode === 'partial' ? 'throw original;' : ''}},current(){calls.push(['current']);},
        copyRequestOriginal(){return 'PUBLIC_NATIVE_ORIGINAL';},completeProof(){},result(){},
        retire(){calls.push(['retire']);},join(){calls.push(['join']);},close(){calls.push(['close']);},
        status(){return Object.freeze({phase:'partial',ready:false,unknown:false,retired:false,cleanupComplete:false,disposed:false,firstCauseCode:null});}};
      const construct=(...args)=>{calls.push(['construct',...args]);return owner;};
      const binding={receiveOriginalIDEIdentity:construct,recoverOriginalIDEIdentity:construct,acquireOriginalIDEProtectedKeyCall:construct};
      ${mode === 'absent' ? '' : `export async function acquireOriginalIDENativeAuthBinding(...args){calls.push(['acquire',...args]);${mode === 'null' ? 'return null;' : mode === 'throw' ? 'throw original;' : mode === 'undefined-throw' ? 'throw undefined;' : 'return binding;'}}`}
    `;
    await writeFile(join(sdk, 'src/original-ide-admission-parent-delivery.js'), construct);
    await writeFile(join(sdk, 'native/original-auth-identity-v2-contract.mjs'), ['absent', 'null', 'throw', 'undefined-throw'].includes(mode)
      ? `throw Error('REQUEST_GRAPH_MUST_NOT_BE_LOADED');`
      : `export const AUTH_IDENTITY_PURPOSES={receive:'AUTH-IDENTITY-RECEIVE',recover:'AUTH-IDENTITY-RECOVER',keyCall:'AUTH-PROTECTED-KEY-CALL'};export function parseOriginalAuthIdentityRequest(raw){if(raw!=='PUBLIC_NATIVE_ORIGINAL')throw Error('changed');return {purpose:AUTH_IDENTITY_PURPOSES.receive};}export function encodeOriginalAuthIdentityRequest(){return new Uint8Array([69]);}`);
    const startup = await import(pathToFileURL(join(desktop, 'wallet-admission-startup.mjs')));
    const original = await import(pathToFileURL(join(sdk, 'src/original-ide-admission-parent-delivery.js')));
    const supplier = await import(pathToFileURL(join(sdk, 'scripts/ynx-ide-service-admission-supplier.mjs')));
    await run(startup, original, supplier);
  } finally { await rm(root, { recursive: true, force: true }); }
}
for (const mode of ['absent', 'null']) test('normal startup ' + mode + ' getter is unavailable without loading request graph or using legacy parent', () => fixture(mode, async (startup, original, supplier) => {
  await assert.rejects(startup.openBundledWalletIdentityCaller(entry), { code: 'IDE_IDENTITY_NATIVE_UNAVAILABLE' });
  assert.deepEqual(original.calls, mode === 'null' ? [['acquire', entry]] : []);
  assert.equal(supplier.legacyAcquisitions, 0);
}));
for (const mode of ['throw', 'undefined-throw']) test('normal startup preserves exact original acquisition failure ' + mode, () => fixture(mode, async (startup, original) => {
  let rejected = false;
  try { await startup.openBundledWalletIdentityCaller(entry); }
  catch (error) { rejected = true; assert.equal(error, mode === 'throw' ? original.original : undefined); }
  assert.equal(rejected, true); assert.deepEqual(original.calls, [['acquire', entry]]);
}));
test('normal startup returns retainable caller before constructing or asserting Native; late partial remains cleanable', () => fixture('partial', async (startup, original, supplier) => {
  const caller = await startup.openBundledWalletIdentityCaller(entry);
  assert.deepEqual(original.calls, [['acquire', entry]]);
  assert.throws(() => caller.begin('receive'), error => error === original.original);
  caller.retire(); caller.join(); caller.close();
  assert.deepEqual(original.calls, [['acquire', entry], ['construct', entry], ['assertReady'], ['retire'], ['join'], ['close']]);
  assert.equal(supplier.legacyAcquisitions, 0);
}));
test('normal legacy null admission keeps local-development refusal and does not select identity operations', () => fixture('null', async (startup, original, supplier) => {
  const admission = await startup.openBundledWalletAdmission(entry);
  assert.throws(() => admission.assertCurrent(), { code: 'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED' });
  assert.deepEqual(original.calls, []);
  assert.equal(supplier.legacyAcquisitions, 1);
}));
