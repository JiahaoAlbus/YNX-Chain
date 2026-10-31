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
import * as finalization from '../src/original-policy-supplier/device-registered-finalization-selection.mjs';
import {createOriginalDeviceCreateIntentDATA} from '@ynx-chain/wallet-auth/original-device-create-intent';

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

function reviewFor(f, registration = null) {
  const original = createOriginalDeviceCreateIntentDATA({...f.input, generation:'18446744073709551615', operationId:'PUBLIC-original-creation', nonce:'1'.repeat(64),
    issuedAt:'2020-01-01T00:00:00.000Z', expiresAt:'2020-01-01T00:00:30.000Z'});
  return {identityBinding:{...f.input}, originalCreationTerms19:original.approvedTerms, originalGeneration:original.terms.generation,
    originalCreationOperation:original.terms.operationId, originalRegistrationOperation:registration, dataOnly:true, SourceAdmission:false, NativeAdmission:false};
}
test('finalization selection uses the genuine lease and preserves expired original creation terms without granting authority', async t => {
  const f=await fixture(t), review=reviewFor(f), peer=finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(review,f.selected,f.app);
  t.after(()=>peer.close());const data=finalization.readOriginalDeviceV4RegisteredFinalizationForNative(peer);
  assert.deepEqual(Object.keys(data).sort(),['identityBinding','originalCreationTerms19','originalGeneration','originalCreationOperation','originalRegistrationOperation'].sort());
  assert.equal(data.originalRegistrationOperation,null);assert.equal(data.originalCreationTerms19,review.originalCreationTerms19);
  assert.equal(data.originalGeneration,'18446744073709551615');assert.equal(Object.isFrozen(data.identityBinding),true);
  review.identityBinding.deviceId='mutated';review.originalGeneration='2';assert.equal(data.identityBinding.deviceId,f.input.deviceId);
  assert.equal(await f.lifecycle.run(()=>finalization.recheckOriginalDeviceV4RegisteredFinalization(peer)),undefined);
  assert.deepEqual(f.counts(),{privateRestores:0,nativeLoads:0});assert.equal(await fs.readFile(f.filePath,'utf8'),f.before);
  assert.deepEqual(Object.keys(peer).sort(),['close','retire']);
});
test('copied and query peers or forged leases cannot mint or read finalization provenance without getters', async t=>{
  const f=await fixture(t),review=reviewFor(f),peer=finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(review,f.selected,f.app);t.after(()=>peer.close());let touched=0;
  const trap=new Proxy({}, {get(){touched++;throw Error('trap');},ownKeys(){touched++;throw Error('trap');},getPrototypeOf(){touched++;throw Error('trap');}});
  for(const lease of [trap,{...f.selected},null])assert.throws(()=>finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(review,lease,f.app));
  for(const value of [trap,f.peer,{...peer},review,finalization.readOriginalDeviceV4RegisteredFinalizationForNative(peer),null]){
    assert.equal(finalization.isOriginalDeviceV4RegisteredFinalizationPeer(value),false);
    assert.throws(()=>finalization.readOriginalDeviceV4RegisteredFinalizationForNative(value));
  }
  assert.equal(touched,0);
});
test('exact original fields, flags, all identity fields, generation and creation operation must agree', async t=>{
  const f=await fixture(t),original=reviewFor(f);let touched=0;
  const getter={...original};Object.defineProperty(getter,'originalGeneration',{enumerable:true,get(){touched++;throw Error('getter');}});
  for(const value of [getter,{...original,registered:true},{...original,SourceAdmission:true},{...original,NativeAdmission:true},{...original,dataOnly:false},
    {...original,originalGeneration:'1'},{...original,originalCreationOperation:'PUBLIC-substitute'},{...original,originalCreationTerms19:original.originalCreationTerms19+'\n'},
    {...original,originalRegistrationOperation:''},{...original,originalRegistrationOperation:undefined},Object.fromEntries(Object.entries(original).filter(([k])=>k!=='originalRegistrationOperation'))])
    assert.throws(()=>finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(value,f.selected,f.app));
  for(const key of IDENTITY_FIELDS)assert.throws(()=>finalization.captureOriginalDeviceV4RegisteredFinalizationSelection({...original,identityBinding:{...original.identityBinding,[key]:'substitute'}},f.selected,f.app));
  assert.equal(touched,0);
  const peer=finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(reviewFor(f,'PUBLIC-registration-op'),f.selected,f.app);t.after(()=>peer.close());
  assert.equal(finalization.readOriginalDeviceV4RegisteredFinalizationForNative(peer).originalRegistrationOperation,'PUBLIC-registration-op');
});
test('lock and renewed unlock cannot revive finalization selection; retiring it leaves the caller lease alone', async t=>{
  const f=await fixture(t),peer=finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(reviewFor(f),f.selected,f.app);t.after(()=>peer.close());
  f.lifecycle.lock();assert.throws(()=>finalization.assertOriginalDeviceV4RegisteredFinalizationCurrent(peer));
  await f.lifecycle.unlock({password:PASSWORD});assert.throws(()=>finalization.readOriginalDeviceV4RegisteredFinalizationForNative(peer));
  const lease=await f.lifecycle.run(()=>f.vault.captureSelectedPQAccountPublic(NETWORK));t.after(()=>lease.close());
  const next=finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(reviewFor(f),lease,f.app);next.close();next.retire();
  assert.throws(()=>finalization.assertOriginalDeviceV4RegisteredFinalizationCurrent(next));assert.equal(lease.assertCurrent(),undefined);
});
test('failed genuine protected-file recheck preserves each falsy first cause permanently',async t=>{
  for(const cause of [false,0,'',null,undefined]){
    const f=await fixture(t);
    const peer=finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(reviewFor(f),f.selected,f.app);t.after(()=>peer.close());
    const saved=f.vault.files.assertCurrent;f.vault.files.assertCurrent=async()=>{throw cause;};
    try{await assert.rejects(f.lifecycle.run(()=>finalization.recheckOriginalDeviceV4RegisteredFinalization(peer)),e=>e===cause);}finally{f.vault.files.assertCurrent=saved;}
    let caught=false;try{finalization.readOriginalDeviceV4RegisteredFinalizationForNative(peer);}catch(e){caught=true;assert.equal(e,cause);}assert.equal(caught,true);
  }
});
test('Node24 fixed require sees the exact same finalization namespace and private peer',async t=>{
  const f=await fixture(t),peer=finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(reviewFor(f),f.selected,f.app);t.after(()=>peer.close());
  const required=createRequire(import.meta.url)('../src/original-policy-supplier/device-registered-finalization-selection.mjs');
  assert.equal(required,finalization);assert.equal(required.isOriginalDeviceV4RegisteredFinalizationPeer(peer),true);
  assert.equal(required.readOriginalDeviceV4RegisteredFinalizationForNative(peer),finalization.readOriginalDeviceV4RegisteredFinalizationForNative(peer));
});
test('independent Main application selection cannot be copied from a different valid Source app',async t=>{
  const f=await fixture(t),review=reviewFor(f);
  for(const app of [application('social'),application('developer','web'),{...f.app,callback:'ynxother://callback'},null])
    assert.throws(()=>finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(review,f.selected,app));
  const peer=finalization.captureOriginalDeviceV4RegisteredFinalizationSelection(review,f.selected,f.app);t.after(()=>peer.close());
  const second=await f.lifecycle.run(()=>f.vault.addAccountAndSelect());f.lifecycle.setAccount(second.account);
  await f.lifecycle.unlock({password:PASSWORD});assert.throws(()=>finalization.assertOriginalDeviceV4RegisteredFinalizationCurrent(peer));
  await f.lifecycle.run(()=>f.vault.selectAccount(f.account));f.lifecycle.setAccount(f.account);await f.lifecycle.unlock({password:PASSWORD});
  assert.throws(()=>finalization.readOriginalDeviceV4RegisteredFinalizationForNative(peer));
});
