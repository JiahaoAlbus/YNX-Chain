import test from 'node:test';
import assert from 'node:assert/strict';
import {supportsPackagedPQTypedFinality,createPackagedPQFinalityVerifier,createPackagedPQHostProducer} from '../src/wallet-pq-verifier-assets.mjs';
import {originalPQVerifierReceipt as receipt,legacyPQVerifierReceipt591} from '../src/wallet-pq-verifier-receipt.mjs';
test('only the exact independent fbec post-sign component has typed DATA capability; legacy591 is unchanged',()=>{
 assert.equal(supportsPackagedPQTypedFinality(receipt),true);
 assert.equal(supportsPackagedPQTypedFinality(legacyPQVerifierReceipt591),false);
 assert.equal(supportsPackagedPQTypedFinality(null),false);
 for(const mode of [createPackagedPQFinalityVerifier,createPackagedPQHostProducer]){
  const caller=mode({app:{isPackaged:false},independentReceipt:receipt});
  assert.deepEqual(caller.identity(),receipt);assert.equal(Object.isFrozen(caller.identity().bundled),true);
  assert.equal(Object.hasOwn(caller,'spawn'),false);assert.equal(Object.hasOwn(caller,'prepare'),false);
 }
});
test('a manifest, CI raw binary, prior signed binary or changed SOURCE cannot self-admit as the fbec component',()=>{
 for(const key of ['manifest','bundled','sourceFile'])for(const field of ['bytes','sha256']){
  const changed=structuredClone(receipt);changed[key][field]=field==='bytes'?changed[key][field]+1:'0'.repeat(64);
  assert.throws(()=>supportsPackagedPQTypedFinality(changed),{code:'PQ_FINALITY_ASSET_INVALID'});
  assert.throws(()=>createPackagedPQHostProducer({app:{isPackaged:false},independentReceipt:changed}),{code:'PQ_FINALITY_ASSET_INVALID'});
 }
 for(const bundled of [{bytes:34663250,sha256:'e9bd43f234b8e1639de82414d2a71cc07147fba99d7fda0a6f3389270146535a'},legacyPQVerifierReceipt591.bundled])assert.throws(()=>supportsPackagedPQTypedFinality({...receipt,bundled}),{code:'PQ_FINALITY_ASSET_INVALID'});
 assert.throws(()=>supportsPackagedPQTypedFinality({...receipt,typed:true}),{code:'PQ_FINALITY_ASSET_INVALID'});
 assert.throws(()=>supportsPackagedPQTypedFinality({...receipt,forkTree:'0'.repeat(40)}),{code:'PQ_FINALITY_ASSET_INVALID'});
});
test('fixed fbec factories detach receipt inputs and refuse unpackaged execution without any process',async()=>{
 for(const factory of [createPackagedPQFinalityVerifier,createPackagedPQHostProducer]){
  const input=structuredClone(receipt),caller=factory({app:{isPackaged:false},independentReceipt:input});
  input.bundled.sha256='0'.repeat(64);assert.deepEqual(caller.identity(),receipt);
  await assert.rejects(caller.run({}),e=>e.code==='PQ_FINALITY_VERIFIER_NOT_STARTED'&&e.cause.code==='PQ_FINALITY_PACKAGED_VERIFIER_UNAVAILABLE');
  assert.equal(caller.snapshot().lifecycle.started,false);await caller.join();caller.assertSafeToClose();
 }
});
