import test from 'node:test';
import assert from 'node:assert/strict';
import {originalPQHostSelectionVerifierReceipt as receipt} from '../src/wallet-pq-host-selection-receipt.mjs';
import {originalPQVerifierReceipt,legacyPQVerifierReceipt591} from '../src/wallet-pq-verifier-receipt.mjs';
import {createPackagedPQHostSelector,packagedPQVerifierAssetPaths,preparePackagedPQHostSelectionInvocation} from '../src/wallet-pq-verifier-assets.mjs';
import * as fs from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {originalPQVerifierReceipt as runtimeReceipt} from '../src/wallet-pq-runtime-component.mjs';

test('selector adds only the independently pinned fourth file; old profile paths stay unchanged',()=>{
 const old=['SOURCE.json','manifest.json','darwin-arm64/ynx-consensus-proof-verify'];
 assert.deepEqual(packagedPQVerifierAssetPaths(originalPQVerifierReceipt),old);
 assert.deepEqual(packagedPQVerifierAssetPaths(legacyPQVerifierReceipt591),old);
 assert.deepEqual(packagedPQVerifierAssetPaths(receipt),[...old,'HOST_SELECTION_SOURCE_GIT_PINS.json']);
 for(const key of ['manifest','bundled','sourceFile']){
  const altered=structuredClone(receipt);altered[key].sha256='0'.repeat(64);
  assert.throws(()=>packagedPQVerifierAssetPaths(altered),{code:'PQ_FINALITY_ASSET_INVALID'});
 }
});
test('legacy signed components cannot acquire selector mode',async()=>{
 for(const old of [originalPQVerifierReceipt,legacyPQVerifierReceipt591]){
  assert.throws(()=>createPackagedPQHostSelector({app:{isPackaged:false},independentReceipt:old}),{code:'PQ_HOST_SELECTION_COMPONENT_UNAVAILABLE'});
  await assert.rejects(preparePackagedPQHostSelectionInvocation('/PUBLIC',old,{}),{code:'PQ_HOST_SELECTION_COMPONENT_UNAVAILABLE'});
 }
});
test('normal selector freezes independent identity and refuses unpackaged execution without spawning',async()=>{
 const input=structuredClone(receipt),caller=createPackagedPQHostSelector({app:{isPackaged:false},independentReceipt:input});
 input.bundled.sha256='0'.repeat(64);
 assert.deepEqual(caller.identity(),receipt);
 assert(Object.isFrozen(caller.identity().bundled));
 assert.equal(Object.hasOwn(caller,'spawn'),false);
 assert.equal(Object.hasOwn(caller,'prepare'),false);
 await assert.rejects(caller.run({}),e=>e.code==='PQ_FINALITY_VERIFIER_NOT_STARTED'&&e.cause.code==='PQ_FINALITY_PACKAGED_VERIFIER_UNAVAILABLE');
 assert.equal(caller.snapshot().lifecycle.started,false);
 await caller.join();caller.assertSafeToClose();
});
test('catalog request rejects missing independent pins, unknown fields and oversized stdin before reading assets',async()=>{
 const base={catalogPath:'/PUBLIC/private/catalog.json',catalogSha256:'1'.repeat(64),stdin:'{}'};
 for(const change of [{catalogSha256:'0'.repeat(64)},{catalogSha256:''},{stdin:'x'.repeat(4097)},{stdin:'\ud800'},{catalogPath:'/PUBLIC/../catalog.json'},{sourcePath:'/PUBLIC/foreign'}]){
  await assert.rejects(preparePackagedPQHostSelectionInvocation('/PUBLIC',receipt,{...base,...change}));
 }
});
test('normal Main and Mac build entrypoints share one fixed component; missing catalog fails before selector construction',async()=>{
 assert.equal(runtimeReceipt,receipt);
 const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
 for(const file of ['../src/main.mjs','../scripts/build-mac.mjs','../scripts/after-pack.mjs']){
  const source=await fs.readFile(new URL(file,import.meta.url),'utf8');
  assert.match(source,/import \{originalPQVerifierReceipt\} from ['"](?:\.\/|\.\.\/src\/)wallet-pq-runtime-component\.mjs['"]/);
 }
 const context={app:{},originalPQVerifierReceipt:runtimeReceipt};let factories=0;
 for(const name of ['createPackagedPQFinalityVerifier','createPackagedPQHostProducer','createPackagedPQHostSelector'])context[name]=args=>{assert.equal(args.independentReceipt,receipt);factories++;return Object.freeze({PUBLIC:true});};
 const declarations=main.split('\n').filter(line=>/^const (createOriginalPQ(FinalityVerifier|HostProducer|HostSelector)|readOriginalPQHostSourceCatalog)=/.test(line)).join('\n');
 runInNewContext(declarations+'\nthis.calls=[createOriginalPQFinalityVerifier,createOriginalPQHostProducer,createOriginalPQHostSelector];this.catalog=readOriginalPQHostSourceCatalog;',context);
 for(const create of context.calls)create();assert.equal(factories,3);
 assert.throws(()=>context.catalog(),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'});assert.equal(factories,3);
 assert.match(main,/createSelection:\(original,binding\)=>createPQHostSelectionCapture\(\{original,binding,evidence:originalPQFinalityEvidence,sourceCatalog:readOriginalPQHostSourceCatalog\(\),selector:createOriginalPQHostSelector\(\)\}\)/);
 assert.doesNotMatch(main,/selectSource:selectOriginalPQHostSource/);
});
