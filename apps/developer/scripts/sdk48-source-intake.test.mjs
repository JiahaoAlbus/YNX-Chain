import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareCanonicalSDK48Source} from './sdk48-source-selection.mjs';
import {validateSDK48RuntimeProjection} from './sdk48-canonical-manifest.mjs';
const b=fileURLToPath(new URL('../../../',import.meta.url));
const p='/Volumes/西部数据/YNX-large-work/wallet-auth-owned-ci-20261026/sdk48-existing-business-read/';
const raw=await readFile(p+'SDK48_EXISTING_BUSINESS_READ_RUNTIME_HANDOFF.json');
assert.equal(raw.length,18068);assert.equal(createHash('sha256').update(raw).digest('hex'),'6253966324bd0f64c68ef6f4f35c26f608ff95ce711f1657683b74845fe98b26');
const h=JSON.parse(raw);
const refs=[h.normalPrefix.inventory,h.runtime.product.selection,h.runtime.product.finitePolicy,h.runtime.product.projectionReceipt,h.runtime.Auth,h.runtime.union,h.runtime.product.Auth,h.runtime.product.union];
const values=await Promise.all(refs.map(async pin=>{const raw=await readFile(pin.path);assert.equal(raw.length,pin.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),pin.sha256);return JSON.parse(raw);}));
const names=['inventory','selection','policy','receipt','fullAuth','fullUnion','productAuth','productUnion'];
const projection=Object.fromEntries(names.map((n,i)=>[n,values[i]]));
test('SDK48 full and finite product runtime use the exact new supplier inputs',()=>{
 assert.deepEqual(validateSDK48RuntimeProjection(projection),{NativeAdmission:false,SourceAdmission:false});
 const changed=structuredClone(projection);changed.receipt.commit='5763b31b0e8d595bf2ed2cae2d4adf7fc5cdcadf';
 assert.throws(()=>validateSDK48RuntimeProjection(changed),/receipt differs/);
});
test('SDK48 rejects projection escape and omitted finite source',()=>{
 const changed=structuredClone(projection);changed.productAuth.files[0].sha256='0'.repeat(64);
 assert.throws(()=>validateSDK48RuntimeProjection(changed),/escaped exact source/);
 const missing=structuredClone(projection);missing.selection.files.pop();assert.throws(()=>validateSDK48RuntimeProjection(missing),/counts differ/);
});
test('SDK48 source-only record cannot inherit SDK47 components or permission',async()=>{
 const c=JSON.parse(await readFile(b+'apps/developer/scripts/canonical-sdk48-inputs.json'));
 assert.equal(c.sdkVersion,'1.3.0-pq.3.32-auth.48');assert.equal(c.sdkCommit,h.sourceCommit);assert.equal(c.sdkTree,h.repositoryRootTree);
 assert.equal(c.nativeComponent,null);assert.equal(c.helperComponent,null);assert.equal(c.requiredBuild.normalPlans,null);assert.equal(c.nativeBuildQualification,null);
 assert.equal(c.files.length,415);assert.equal(c.productProjection.files.length,400);assert.equal(c.dependencies.length,9177);
 assert.equal(c.nativeBuildInputs.length,115);assert.equal(c.requiredBuild.helperInputs.length,107);assert.equal(c.productProjection.NativeAdmission,false);assert.equal(c.productProjection.SourceAdmission,false);
});
test('SDK48 seven formal CAS deltas match retained SDK47 and new selected bytes',async()=>{
 const raw=await readFile(p+'SDK48_FORMAL_SOURCE_ROLES_CAS_ADDENDUM.json');
 assert.equal(raw.length,9815);assert.equal(createHash('sha256').update(raw).digest('hex'),'1c7bb9e2cc0adc555aad673be97fb387d2de66a8ef9097c7cb4b48c5c35c96c6');
 const rows=JSON.parse(raw).canonicalPackageCAS;assert.equal(rows.length,7);
 const prior='/Volumes/西部数据/YNX-large-work/ide-wallet-contract-consumer-20261024/ide-sdk47-native-read-successor-20261026/selection/';
 for(const row of rows)for(const [path,pin]of [[prior+row.sourceSlot,row.expectedOld],[b+'../selection/'+row.sourceSlot,row.replacement]]){
  const raw=await readFile(path);assert.equal(raw.length,pin.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),pin.sha256);
 }
});
test('SDK48 intake refuses mislabeled supplier before any output allocation',async()=>{
 await assert.rejects(prepareCanonicalSDK48Source({handoff:p+'SDK48_FORMAL_SOURCE_ROLES_CAS_ADDENDUM.json'}),/Original SDK48 role bytes differ/);
});
