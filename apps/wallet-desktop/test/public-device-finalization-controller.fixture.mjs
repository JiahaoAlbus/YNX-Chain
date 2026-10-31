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

import {createProductSessionRequest} from '@ynx-chain/wallet-auth';
import {PUBLICFinalizationNative} from './public-device-finalization-native.fixture.mjs';
const {createOriginalDeviceFinalizationController}=await import('../src/original-device-finalization-controller.mjs');
async function setup(t, mode='normal') {
 const f=await fixture(t), events=[],b=productPlatformBinding(registry,'developer','macos');
 const terms=createOriginalDeviceCreateIntentDATA({...f.input,generation:'1',operationId:'PUBLIC-finalize-creation',nonce:'a'.repeat(64),issuedAt:'2020-01-01T00:00:00.000Z',expiresAt:'2020-01-01T00:00:30.000Z'});
 const review=Object.freeze({identityBinding:Object.freeze({...f.input}),originalCreationTerms19:terms.approvedTerms,originalGeneration:'1',originalCreationOperation:terms.terms.operationId,originalRegistrationOperation:null,dataOnly:true,SourceAdmission:false,NativeAdmission:false});
 const request=createProductSessionRequest(registry,{productId:'developer',platform:'macos',deviceId:f.input.deviceId,deviceAlgorithm:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',
  deviceRegistrationId:'00000000-0000-4000-8000-000000000002',deviceRegistrationRevision:'1',deviceRegistrationDigest:'e'.repeat(64),scopes:[b.scopes[0]],purpose:'PUBLIC finalization DATA',nonce:'n'.repeat(43),state:'s'.repeat(43)},new Date());
 let raw, commits=0, captured=0, pending=mode==='join-pending';
 const result=()=>Object.freeze({state:mode==='unknown'?'UNKNOWN':'FINALIZED_LOCAL_ASSOCIATION',originalGeneration:'1',originalCreationOperation:terms.terms.operationId,originalRegistrationOperation:null,
  localAssociationFinalized:true,SourceAdmission:false,newSession:false,connected:false,keyGenerated:false,registrationResent:false});
 const child=Object.freeze({assertCurrent(){events.push('child-current');},async recheck(){events.push('child-recheck');},commitOriginalRegisteredAssociation(...args){assert.equal(args.length,0);events.push('commit');commits++;raw=result();if(mode==='late-lock')f.lifecycle.lock();if(mode==='commit-false')throw false;return raw;},readOriginalOutcomeDATA(){if(!raw)throw Error('PUBLIC_NOT_ENTERED');events.push('read-outcome');return raw;},retire(){events.push('child-retire');if(mode==='retire-false')throw false;},async join(){events.push('child-join');if(pending)throw Object.assign(Error('PUBLIC pending'),{code:'PUBLIC_JOIN_PENDING'});},async close(){events.push('child-close');}});
 const source=Object.freeze({assertCurrent(){events.push('source-current');},readOriginalReviewDATA(){events.push('read-review');return mode==='wrong-review'?Object.freeze({...review,originalGeneration:'2'}):review;},captureOriginalFinalization(peer){captured++;assert.equal(finalization.isOriginalDeviceV4RegisteredFinalizationPeer(peer),true);assert.equal(finalization.isOriginalDeviceV4RegisteredFinalizationPeer(f.peer),false);events.push('capture');if(mode==='capture-partial')throw Object.assign(Error('PUBLIC capture'),{code:'PUBLIC_PARTIAL',partial:child,cause:0});return child;},retire(){events.push('source-retire');},async join(){events.push('source-join');},async close(){events.push('source-close');}});
 PUBLICFinalizationNative.image={acquireOriginalProductSessionDeviceV4RegisteredFinalizationSource(...args){assert.equal(args.length,0);events.push('acquire');return Object.freeze({owner:source,error:mode==='acquire-false'?false:mode==='acquire-zero'?0:null});}};
 const controller=createOriginalDeviceFinalizationController({vault:f.vault,networkId:NETWORK});
 return {...f,controller,events,request,review,source,child,commits:()=>commits,captured:()=>captured,release:()=>{pending=false;},run:()=>f.lifecycle.run(()=>controller.finalizeOriginal(request))};
}
test('normal controller consumes actual fixed zeroarg API and independent genuine Main peer, then drains child before parent',async t=>{
 const f=await setup(t),s=await f.run();assert.equal(s.phase,'original-local-association-retained');assert.equal(s.originalOutcomeRetained,true);assert.equal(s.outcome.localAssociationFinalized,true);
 assert.equal(s.SourceAdmission,false);assert.equal(s.newSession,false);assert.equal(s.connected,false);assert.equal(s.keyGenerated,false);assert.equal(s.registrationResent,false);
 assert.equal(f.commits(),1);assert(f.events.indexOf('child-close')<f.events.indexOf('source-close'));assert.deepEqual(f.counts(),{privateRestores:0,nativeLoads:0});
 await assert.rejects(f.run(),{code:'DEVICE_FINALIZATION_ORIGINAL_QUERY_ONLY'});assert.equal(f.commits(),1);
});
for(const mode of ['acquire-false','acquire-zero'])test('nonnull Native acquisition owner is drained before preserving '+mode+' error',async t=>{
 const f=await setup(t,mode);await assert.rejects(f.run(),error=>error===(mode==='acquire-false'?false:0));assert.equal(f.commits(),0);assert.equal(f.captured(),0);
 assert(f.events.includes('source-close'));assert.equal(f.controller.readStatusDATA().effectEntered,false);
});
test('Native capture partial is retained and drained before Source, without local effect',async t=>{
 const f=await setup(t,'capture-partial');await assert.rejects(f.run(),{code:'PUBLIC_PARTIAL'});assert.equal(f.commits(),0);
 assert(f.events.indexOf('child-close')<f.events.indexOf('source-close'));assert.equal(f.controller.readStatusDATA().cleanupUnresolved,false);
});
for(const mode of ['late-lock','commit-false','unknown'])test('original result survives '+mode+' and never re-enters local completion',async t=>{
 const f=await setup(t,mode);await assert.rejects(f.run());const s=f.controller.readStatusDATA();assert.equal(s.effectEntered,true);assert.equal(s.originalOutcomeRetained,true);assert.equal(s.outcome.localAssociationFinalized,true);assert.equal(s.SourceAdmission,false);
 await assert.rejects(f.run());assert.equal(f.commits(),1);assert(f.events.includes('source-close'));
});
test('pending child join blocks parent close while original effect/result remains held',async t=>{
 const f=await setup(t,'join-pending');await assert.rejects(f.run(),{code:'PUBLIC_JOIN_PENDING'});assert.equal(f.events.includes('source-close'),false);assert.equal(f.events.includes('child-close'),false);
 assert.equal(f.controller.readStatusDATA().cleanupUnresolved,true);f.release();await assert.rejects(f.controller.close(),{code:'PUBLIC_JOIN_PENDING'});assert.equal(f.controller.readStatusDATA().firstCauseCode,'PUBLIC_JOIN_PENDING');
 assert(f.events.indexOf('child-close')<f.events.indexOf('source-close'));assert.equal(f.commits(),1);
});
test('wrong original generation and an absent actual Native entry fail before local effect',async t=>{
 const f=await setup(t,'wrong-review');await assert.rejects(f.run());assert.equal(f.commits(),0);assert.equal(f.captured(),0);assert(f.events.includes('source-close'));
 const g=await setup(t);PUBLICFinalizationNative.image={};await assert.rejects(g.run(),{code:'DEVICE_FINALIZATION_NATIVE_SOURCE_NOT_SUPPLIED'});assert.equal(g.events.includes('acquire'),false);
});
test('renderer-style extra request terms and provider injection do not enter Native',async t=>{
 const f=await setup(t);await assert.rejects(f.controller.finalizeOriginal(f.request,{registered:true}),{code:'DEVICE_FINALIZATION_ORIGINAL_REQUEST_REQUIRED'});
 assert.throws(()=>createOriginalDeviceFinalizationController({vault:f.vault,networkId:NETWORK,source:f.source}));assert.equal(f.events.includes('acquire'),false);
});

test('cleanup falsy failure cannot return a stale success and remains sticky after physical drain',async t=>{
 const f=await setup(t,'retire-false');await assert.rejects(f.run(),error=>error===false);
 assert.equal(f.controller.readStatusDATA().originalOutcomeRetained,true);assert.equal(f.controller.readStatusDATA().cleanupFailureRetained,true);
 assert(f.events.includes('source-close'));await assert.rejects(f.controller.close(),error=>error===false);assert.equal(f.commits(),1);
});
