import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault, isOriginalSelectedPQAccountPublicLease} from '../src/password-wallet-vault.mjs';
import {createOriginalNativePQCustody} from '../src/wallet-pq-native-custody.mjs';
import * as keySDK from '../../../packages/wallet-auth/src/pq-wallet-key-backup.js';
import * as backupSDK from '../../../packages/wallet-auth/src/pq-wallet-backup.js';
import * as contractSDK from '../../../packages/wallet-auth/src/pq-wallet-contract.js';
import {ynxAddressFromEVM} from '@ynx-chain/wallet-auth';
import {createOriginalDeviceIdentityDATA} from '@ynx-chain/wallet-auth/original-device-create-intent';
import {productPlatformBinding} from '../../../packages/wallet-auth/src/product-session-registry.js';
import registry from '../../../packages/wallet-auth/product-session-registry.json' with {type: 'json'};
import * as query from '../src/original-policy-supplier/device-query-selection.mjs';

const SDK = Object.freeze({...keySDK, ...backupSDK, ...contractSDK});
const PASSWORD = 'isolated-query-selection-fixture-password';
const NETWORK = 'a'.repeat(64);
const APP_FIELDS = ['productId', 'clientId', 'platform', 'applicationId', 'bundleId', 'packageId', 'origin', 'callback'];
const IDENTITY_FIELDS = ['networkId', 'canonicalOwner', 'account', 'productId', 'clientId', 'platform', 'applicationId', 'bundleId', 'packageId', 'origin', 'callback', 'deviceId'];
const encode = value => new TextEncoder().encode(value);
const application = (product = 'developer', platform = 'macos') => {
  const value = productPlatformBinding(registry, product, platform);
  return Object.fromEntries(APP_FIELDS.map(key => [key, value[key]]));
};

// Only fresh, temporary encrypted Vaults and SDK-generated test pairs. No real
// account, Native load, private payload read or keyopen is used by these tests.
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'ynx-device-query-selection-'));
  const filePath = path.join(directory, 'wallet-vault-v3.json');
  const lifecycle = new DesktopKeyLifecycle();
  lifecycle.setFocused(true);
  let armed = false, privateRestores = 0, nativeLoads = 0, nextSecret = 1;
  const pqSDK = Object.freeze({...SDK, restorePQWalletKeyHandle(...args) {
    if (armed) { privateRestores++; throw Error('QUERY_MUST_NOT_RESTORE_PRIVATE_KEYS'); }
    return SDK.restorePQWalletKeyHandle(...args);
  }});
  const custody = createOriginalNativePQCustody({load() { nativeLoads++; throw Error('QUERY_MUST_NOT_LOAD_NATIVE'); }});
  const vault = new PasswordWalletVault({filePath, authorization: lifecycle, pqSDK, nativePQCustody: custody,
    randomSecret: () => (nextSecret++).toString(16).padStart(64, '0')});
  lifecycle.authorizer = vault.authorizer();
  t.after(async () => { lifecycle.lock(); await fs.rm(directory, {recursive: true, force: true}); });
  await lifecycle.custody(guard => vault.setup({password: PASSWORD, confirmation: PASSWORD}, guard));
  await lifecycle.unlock({password: PASSWORD});
  const created = await lifecycle.run(() => vault.createAccount());
  lifecycle.setAccount(created.account);
  await lifecycle.unlock({password: PASSWORD});
  const handle = await SDK.createPQWalletKeyHandle({chainId: NETWORK, owner: created.account});
  try {
    const publicBinding = SDK.readPQWalletKeyPublic(handle);
    await lifecycle.run(() => vault.savePQKeys({handle, publicBinding, operationId: 'PUBLIC-query-selection-fixture'}));
  } finally { SDK.destroyPQWalletKeyHandle(handle); }
  armed = true;
  const selected = await lifecycle.run(() => vault.captureSelectedPQAccountPublic(NETWORK));
  t.after(() => selected.close());
  const app = application();
  const input = {networkId: NETWORK, canonicalOwner: created.account, account: ynxAddressFromEVM(created.account),
    ...app, deviceId: 'PUBLIC-query-original-device'};
  const view = createOriginalDeviceIdentityDATA(input);
  const stableBytes = encode(view.stableDeviceIdentity);
  const peer = query.captureOriginalDeviceQuerySelectionDATA(stableBytes, app, selected);
  t.after(() => peer.close());
  const before = await fs.readFile(filePath, 'utf8');
  return {directory, filePath, lifecycle, vault, selected, app, input, view, stableBytes, peer, before, account: created.account,
    counts: () => ({privateRestores, nativeLoads})};
}

function assertRetired(peer) {
  assert.throws(() => query.readOriginalDeviceQuerySelectionDATA(peer));
  assert.throws(() => query.assertOriginalDeviceQuerySelectionCurrent(peer));
}

test('query selection uses a genuine public ASSET lease and returns only frozen stable identity plus exact twelve DATA fields', async t => {
  const f = await fixture(t);
  assert.equal(isOriginalSelectedPQAccountPublicLease(f.selected), true);
  assert.equal(query.isOriginalDeviceQuerySelectionPeer(f.peer), true);
  assert.equal(Object.isFrozen(f.peer), true);
  const data = query.readOriginalDeviceQuerySelectionDATA(f.peer);
  assert.deepEqual(Object.keys(data).sort(), ['identityBinding', 'queryOnly', 'stableDeviceIdentity']);
  assert.equal(data.queryOnly, true);
  assert.equal(data.stableDeviceIdentity, f.view.stableDeviceIdentity);
  assert.deepEqual(Object.keys(data.identityBinding).sort(), [...IDENTITY_FIELDS].sort());
  assert.deepEqual(data.identityBinding, f.input);
  assert.equal(Object.isFrozen(data), true);
  assert.equal(Object.isFrozen(data.identityBinding), true);
  assert.deepEqual(Object.keys(f.peer).sort(), ['close', 'retire']);
  assert.equal(query.assertOriginalDeviceQuerySelectionCurrent(f.peer), undefined);
  assert.equal(await f.lifecycle.run(() => query.recheckOriginalDeviceQuerySelection(f.peer)), undefined);
  for (const key of ['approve', 'prepare', 'complete', 'sign', 'publicBinding', 'pkA', 'pkB', 'handle', 'credential', 'approvedTerms', 'creationTerms', 'generation', 'operationId', 'nonce', 'issuedAt', 'expiresAt', 'SourceAdmission', 'NativeAdmission']) {
    assert.equal(key in data, false);
    assert.equal(key in data.identityBinding, false);
    assert.equal(key in f.peer, false);
  }
  f.stableBytes.fill(0);
  f.app.callback = 'mutated-after-capture';
  assert.equal(query.readOriginalDeviceQuerySelectionDATA(f.peer), data);
  assert.equal(data.identityBinding.callback, f.input.callback);
  assert.deepEqual(f.counts(), {privateRestores: 0, nativeLoads: 0});
  assert.equal(await fs.readFile(f.filePath, 'utf8'), f.before);
});

test('query rejects fake, copied, JSON and proxied peers/leases without consulting their getters or traps', async t => {
  const f = await fixture(t);
  let touches = 0;
  const getter = Object.defineProperties({}, Object.fromEntries(['readPublic', 'assertCurrent', 'recheck', 'close'].map(key => [key, {get() { touches++; throw Error('UNTRUSTED_GETTER'); }, enumerable: true}])));
  const proxy = value => new Proxy(value, {get() { touches++; throw Error('UNTRUSTED_PROXY'); }, ownKeys() { touches++; throw Error('UNTRUSTED_KEYS'); }, getPrototypeOf() { touches++; throw Error('UNTRUSTED_PROTO'); }});
  for (const selected of [{...f.selected}, JSON.parse(JSON.stringify(f.selected)), getter, proxy(f.selected), proxy({}), null]) {
    assert.equal(isOriginalSelectedPQAccountPublicLease(selected), false);
    assert.throws(() => query.captureOriginalDeviceQuerySelectionDATA(f.stableBytes, f.app, selected), {code: 'AUTH_DEVICE_QUERY_SELECTED_ACCOUNT_REQUIRED'});
  }
  for (const peer of [{...f.peer}, JSON.parse(JSON.stringify(f.peer)), query.readOriginalDeviceQuerySelectionDATA(f.peer), getter, proxy(f.peer), proxy({}), null, undefined, 1]) {
    assert.equal(query.isOriginalDeviceQuerySelectionPeer(peer), false);
    assert.throws(() => query.readOriginalDeviceQuerySelectionDATA(peer), {code: 'AUTH_DEVICE_QUERY_ORIGINAL_SELECTION_REQUIRED'});
    assert.throws(() => query.assertOriginalDeviceQuerySelectionCurrent(peer), {code: 'AUTH_DEVICE_QUERY_ORIGINAL_SELECTION_REQUIRED'});
    await assert.rejects(query.recheckOriginalDeviceQuerySelection(peer), {code: 'AUTH_DEVICE_QUERY_ORIGINAL_SELECTION_REQUIRED'});
  }
  assert.equal(touches, 0);
  query.assertOriginalDeviceQuerySelectionCurrent(f.peer);
});

test('sole SDK rejects noncanonical bytes, creation fields and a mismatched or accessor/proxied application tuple without getters', async t => {
  const f = await fixture(t);
  const parsed = JSON.parse(f.view.stableDeviceIdentity);
  const invalidBytes = [encode(f.view.stableDeviceIdentity + '\n'), encode(JSON.stringify({...parsed, generation: '1'})),
    encode(JSON.stringify({...parsed, domain: 'YNX-PRODUCT-DEVICE-CREATE/v1'})), encode(JSON.stringify({...parsed, version: '2'})),
    encode('\ufeff' + f.view.stableDeviceIdentity), new Uint8Array([0xff]), new Proxy(f.stableBytes, {})];
  for (const bytes of invalidBytes) assert.throws(() => query.captureOriginalDeviceQuerySelectionDATA(bytes, f.app, f.selected));
  let getters = 0;
  const accessor = {...f.app};
  Object.defineProperty(accessor, 'callback', {enumerable: true, get() { getters++; throw Error('APP_GETTER'); }});
  const proxied = new Proxy(f.app, {get() { getters++; throw Error('APP_PROXY'); }, ownKeys() { getters++; throw Error('APP_KEYS'); }});
  for (const app of [accessor, proxied, {...f.app, nonce: 'not-query'}, {...f.app, callback: 'ynxother://wallet-auth/callback'},
    {...f.app, productId: 'social'}, {...f.app, clientId: 'ynx-other-v1'}, {...f.app, applicationId: 'com.other.app'},
    {...f.app, origin: 'https://other.invalid'}, {...f.app, bundleId: 'com.other.bundle'}, {...f.app, packageId: 'com.other.package'}]) {
    assert.throws(() => query.captureOriginalDeviceQuerySelectionDATA(f.stableBytes, app, f.selected));
  }
  assert.equal(getters, 0);
  query.assertOriginalDeviceQuerySelectionCurrent(f.peer);
});

test('canonical owner/network must match the genuine lease and Registry-valid app tuples remain distinct DATA', async t => {
  const f = await fixture(t);
  for (const delta of [{networkId: 'b'.repeat(64)}, {canonicalOwner: '0x' + '4'.repeat(40), account: ynxAddressFromEVM('0x' + '4'.repeat(40))}]) {
    const view = createOriginalDeviceIdentityDATA({...f.input, ...delta});
    assert.throws(() => query.captureOriginalDeviceQuerySelectionDATA(encode(view.stableDeviceIdentity), f.app, f.selected), {code: 'AUTH_DEVICE_QUERY_SELECTED_ACCOUNT_CHANGED'});
  }
  const web = application('developer', 'web');
  const webView = createOriginalDeviceIdentityDATA({...f.input, ...web});
  // The stable six fields do not carry platform. The independent Registry tuple
  // completes all twelve fields; a valid alternative is represented distinctly.
  const webPeer = query.captureOriginalDeviceQuerySelectionDATA(encode(webView.stableDeviceIdentity), web, f.selected);
  t.after(() => webPeer.close());
  const macData = query.readOriginalDeviceQuerySelectionDATA(f.peer);
  const webData = query.readOriginalDeviceQuerySelectionDATA(webPeer);
  assert.equal(webData.stableDeviceIdentity, macData.stableDeviceIdentity);
  assert.equal(webData.identityBinding.platform, 'web');
  assert.equal(macData.identityBinding.platform, 'macos');
  assert.notDeepEqual(webData.identityBinding, macData.identityBinding);
  assert.throws(() => query.captureOriginalDeviceQuerySelectionDATA(f.stableBytes, application('social'), f.selected));
});

test('query requires genuine recheck inside lifecycle.run and an out-of-scope attempt permanently retires only that peer', async t => {
  const f = await fixture(t);
  await assert.rejects(query.recheckOriginalDeviceQuerySelection(f.peer));
  assertRetired(f.peer);
  assert.equal(f.selected.assertCurrent(), undefined);
  await assert.rejects(f.lifecycle.run(() => query.recheckOriginalDeviceQuerySelection(f.peer)));
  const next = query.captureOriginalDeviceQuerySelectionDATA(f.stableBytes, f.app, f.selected);
  t.after(() => next.close());
  assert.equal(await f.lifecycle.run(() => query.recheckOriginalDeviceQuerySelection(next)), undefined);
  next.close(); next.close(); next.retire();
  assertRetired(next);
  assert.equal(f.selected.assertCurrent(), undefined);
});

test('lock, focus loss, renewed unlock and close cannot revive query peers after unlock or recapture', async t => {
  const f = await fixture(t);
  for (const change of ['lock', 'focus', 'renew', 'close', 'selected-close']) {
    const selected = await f.lifecycle.run(() => f.vault.captureSelectedPQAccountPublic(NETWORK));
    t.after(() => selected.close());
    const peer = query.captureOriginalDeviceQuerySelectionDATA(f.stableBytes, f.app, selected);
    t.after(() => peer.close());
    if (change === 'lock') f.lifecycle.lock();
    if (change === 'focus') f.lifecycle.setFocused(false);
    if (change === 'renew') await f.lifecycle.unlock({password: PASSWORD});
    if (change === 'close') peer.close();
    if (change === 'selected-close') selected.close();
    assertRetired(peer);
    f.lifecycle.setFocused(true);
    await f.lifecycle.unlock({password: PASSWORD});
    assertRetired(peer);
    await assert.rejects(f.lifecycle.run(() => query.recheckOriginalDeviceQuerySelection(peer)));
  }
});

test('a genuine Vault account switch and return permanently invalidate the held query selection', async t => {
  const f = await fixture(t);
  const second = await f.lifecycle.run(() => f.vault.addAccountAndSelect());
  assert.notEqual(second.account, f.account);
  f.lifecycle.setAccount(second.account);
  await f.lifecycle.unlock({password: PASSWORD});
  assertRetired(f.peer);
  await f.lifecycle.run(() => f.vault.selectAccount(f.account));
  f.lifecycle.setAccount(f.account);
  await f.lifecycle.unlock({password: PASSWORD});
  assertRetired(f.peer);
  assert.equal(f.lifecycle.status().account, f.account);
});

test('genuine file recheck detects changed encrypted Vault and remains retired after original bytes are restored', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.filePath, f.before + '\n', {mode: 0o600});
  await assert.rejects(f.lifecycle.run(() => query.recheckOriginalDeviceQuerySelection(f.peer)));
  await fs.writeFile(f.filePath, f.before, {mode: 0o600});
  assertRetired(f.peer);
  await assert.rejects(f.lifecycle.run(() => query.recheckOriginalDeviceQuerySelection(f.peer)));
  assert.deepEqual(f.counts(), {privateRestores: 0, nativeLoads: 0});
});

test('a close or real lifecycle lock during genuine file recheck cannot return a current query peer', async t => {
  const f = await fixture(t);
  const realAssertCurrent = f.vault.files.assertCurrent.bind(f.vault.files);
  for (const action of ['close', 'lock']) {
    const peer = query.captureOriginalDeviceQuerySelectionDATA(f.stableBytes, f.app, f.selected);
    t.after(() => peer.close());
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    // Pause only after the original protected-file assertion has really run;
    // the private-brand selected lease and all of its functions stay genuine.
    f.vault.files.assertCurrent = async (...args) => {
      await realAssertCurrent(...args);
      entered.resolve();
      await release.promise;
    };
    const pending = f.lifecycle.run(() => query.recheckOriginalDeviceQuerySelection(peer));
    const refused = assert.rejects(pending);
    try {
      await entered.promise;
      if (action === 'close') peer.close(); else f.lifecycle.lock();
    } finally {
      release.resolve();
      f.vault.files.assertCurrent = realAssertCurrent;
    }
    await refused;
    assertRetired(peer);
    if (action === 'close') query.assertOriginalDeviceQuerySelectionCurrent(f.peer);
  }
  await f.lifecycle.unlock({password: PASSWORD});
  assertRetired(f.peer);
  assert.deepEqual(f.counts(), {privateRestores: 0, nativeLoads: 0});
});

test('query has no creation thirty-second expiry but rejects observed clock rollback permanently', async t => {
  const f = await fixture(t);
  const start = Date.now();
  t.mock.timers.enable({apis: ['Date'], now: start});
  query.assertOriginalDeviceQuerySelectionCurrent(f.peer);
  t.mock.timers.setTime(start + 30001);
  query.assertOriginalDeviceQuerySelectionCurrent(f.peer);
  assert.equal(await f.lifecycle.run(() => query.recheckOriginalDeviceQuerySelection(f.peer)), undefined);
  t.mock.timers.setTime(start + 30000);
  assert.throws(() => query.assertOriginalDeviceQuerySelectionCurrent(f.peer), {code: 'AUTH_DEVICE_QUERY_CLOCK_ROLLBACK'});
  t.mock.timers.setTime(start + 30002);
  assertRetired(f.peer);
});

test('Node 24 createRequire captures the same ESM namespace, functions and opaque query peer', async t => {
  const f = await fixture(t);
  const required = createRequire(import.meta.url)('../src/original-policy-supplier/device-query-selection.mjs');
  assert.equal(required, query);
  assert.equal(required.readOriginalDeviceQuerySelectionDATA, query.readOriginalDeviceQuerySelectionDATA);
  assert.equal(required.isOriginalDeviceQuerySelectionPeer(f.peer), true);
  assert.equal(required.readOriginalDeviceQuerySelectionDATA(f.peer), query.readOriginalDeviceQuerySelectionDATA(f.peer));
  assert.equal(required.assertOriginalDeviceQuerySelectionCurrent(f.peer), undefined);
  assert.equal(await f.lifecycle.run(() => required.recheckOriginalDeviceQuerySelection(f.peer)), undefined);
  const requirePeer = required.captureOriginalDeviceQuerySelectionDATA(f.stableBytes, f.app, f.selected);
  t.after(() => requirePeer.close());
  assert.equal(query.isOriginalDeviceQuerySelectionPeer(requirePeer), true);
  assert.deepEqual(query.readOriginalDeviceQuerySelectionDATA(requirePeer), query.readOriginalDeviceQuerySelectionDATA(f.peer));
});

test('query selection keeps exact falsy first causes from original protected-file recheck',async t=>{
 for(const cause of [false,0,'',null,undefined]){
  const f=await fixture(t),saved=f.vault.files.assertCurrent;f.vault.files.assertCurrent=async()=>{throw cause;};
  try{await assert.rejects(f.lifecycle.run(()=>query.recheckOriginalDeviceQuerySelection(f.peer)),e=>e===cause);}finally{f.vault.files.assertCurrent=saved;}
  let observed=false;try{query.readOriginalDeviceQuerySelectionDATA(f.peer);}catch(e){observed=true;assert.equal(e,cause);}assert.equal(observed,true);
 }
});
