import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {preparePackagedPQVerifierInvocation,createPackagedPQFinalityVerifier,preparePackagedPQHostInvocation,createPackagedPQHostProducer} from '../src/wallet-pq-verifier-assets.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),pin=b=>({bytes:b.length,sha256:sha(b)}),commit='0345970c7c616c24ebf3e494e9a8d9628ff8ae40',tree='9777a6f8544fe5f9d41b546c6a34b3e3e02ab54e';
const source=readFileSync(new URL('./fixtures/proof-verifier-source-0345970.json',import.meta.url));assert.equal(source.length,1938);assert.equal(sha(source),'140cd07e512486ef812522cc9fcd20e53023256bf55c6290c4b10203d48bf027');
async function fixture(t){
 const parent=await fs.realpath(tmpdir()),root=await fs.mkdtemp(path.join(parent,'ynx-fixed-verifier-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const assets=path.join(root,'consensus-proof-verifier'),executable=path.join(assets,'darwin-arm64/ynx-consensus-proof-verify');await fs.mkdir(path.dirname(executable),{recursive:true,mode:0o700});
 // PUBLIC header stand-in only, NEVER executed or claimed to be the CI binary.
 const binary=Buffer.alloc(64);binary.writeUInt32LE(0xfeedfacf,0);binary.writeUInt32LE(0x0100000c,4);const bundled=pin(binary),manifest={schema:'YNX-WALLET-PACKAGED-PROOF-VERIFIER/v1',sourceCommit:commit,forkTree:tree,platform:'darwin',architecture:'arm64',binaryPath:'darwin-arm64/ynx-consensus-proof-verify',ciOriginal:{bytes:34423202,sha256:'e4011728d2c64d80c886f7648977e9812ca08932ad2d2d09e2e1a492612c3ca2'},bundled,sourceFile:{path:'SOURCE.json',...pin(source)},signingClass:'PUBLIC stand-in, NOT signed or qualified'};
 const manifestBytes=Buffer.from(JSON.stringify(manifest)+'\n'),receipt={sourceCommit:commit,forkTree:tree,manifest:pin(manifestBytes),bundled,sourceFile:pin(source)},contextPath=path.join(root,'original-context.json'),context=Buffer.from('{"PUBLIC":"not original Host trust"}');
 await fs.writeFile(executable,binary,{mode:0o755});await fs.writeFile(path.join(assets,'SOURCE.json'),source,{mode:0o644});await fs.writeFile(path.join(assets,'manifest.json'),manifestBytes,{mode:0o644});await fs.writeFile(contextPath,context,{mode:0o600});
 return {root,assets,executable,binary,manifest,receipt,input:{contextPath,contextSha256:sha(context),stdin:'{"PUBLIC":"proof DATA"}'}};
}
test('fixed resource locations distinguish independent signed-bundle pins from original CI bytes without executing a process',async t=>{
 const f=await fixture(t),prepared=await preparePackagedPQVerifierInvocation(f.root,f.receipt,f.input);assert.equal(prepared.executable,f.executable);assert.equal(prepared.contextPath,f.input.contextPath);assert.equal(prepared.stdin,f.input.stdin);assert.equal(Object.isFrozen(prepared),true);assert.notEqual(f.receipt.bundled.sha256,f.manifest.ciOriginal.sha256);assert.deepEqual(Object.keys(prepared),['executable','contextPath','contextSha256','stdin']);
});
test('incoming self-manifest cannot replace an absent independent receipt or silently rewrite its bundle/source pin',async t=>{
 const f=await fixture(t);await assert.rejects(preparePackagedPQVerifierInvocation(f.root,null,f.input),{code:'PQ_FINALITY_ASSET_RECEIPT_NOT_SUPPLIED'});const changed=Buffer.from(f.binary);changed[32]=1;await fs.writeFile(f.executable,changed);f.manifest.bundled=pin(changed);await fs.writeFile(path.join(f.assets,'manifest.json'),JSON.stringify(f.manifest));await assert.rejects(preparePackagedPQVerifierInvocation(f.root,f.receipt,f.input));
});
test('symlink, hardlink, writable or nonexecutable binary cannot pass normal asset checks',async t=>{
 for(const mode of ['symlink','hardlink','writable','no-exec']){const f=await fixture(t);if(mode==='symlink'){await fs.rename(f.executable,f.executable+'.original');await fs.symlink(f.executable+'.original',f.executable);}if(mode==='hardlink')await fs.link(f.executable,f.executable+'.alias');if(mode==='writable')await fs.chmod(f.executable,0o777);if(mode==='no-exec')await fs.chmod(f.executable,0o644);await assert.rejects(preparePackagedPQVerifierInvocation(f.root,f.receipt,f.input),undefined,mode);}
});
test('different SOURCE and original context bytes fail before any invocation can be returned',async t=>{
 for(const field of ['source','context']){const f=await fixture(t);await fs.writeFile(field==='source'?path.join(f.assets,'SOURCE.json'):f.input.contextPath,Buffer.from('altered public DATA'));await assert.rejects(preparePackagedPQVerifierInvocation(f.root,f.receipt,f.input));}
});
test('target architecture, exact original component/source and whole manifest identity cannot be substituted',async t=>{
 for(const change of [{sourceCommit:'0'.repeat(40)},{forkTree:'0'.repeat(40)}]){const f=await fixture(t);await assert.rejects(preparePackagedPQVerifierInvocation(f.root,{...f.receipt,...change},f.input),{code:'PQ_FINALITY_ASSET_INVALID'});}
 const f=await fixture(t);const foreign=Buffer.from(f.binary);foreign.writeUInt32LE(0x01000007,4);await fs.writeFile(f.executable,foreign);f.manifest.bundled=pin(foreign);const text=Buffer.from(JSON.stringify(f.manifest));await fs.writeFile(path.join(f.assets,'manifest.json'),text);await assert.rejects(preparePackagedPQVerifierInvocation(f.root,{...f.receipt,bundled:pin(foreign),manifest:pin(text)},f.input),{code:'PQ_FINALITY_ASSET_ARCHITECTURE'});
});
test('caller input mutation during filesystem waits cannot retarget the already captured invocation',async t=>{
 const f=await fixture(t),expected={...f.input},work=preparePackagedPQVerifierInvocation(f.root,f.receipt,f.input);f.input.contextPath='/PUBLIC/foreign';f.input.contextSha256='0'.repeat(64);f.input.stdin='changed';f.receipt.bundled.sha256='0'.repeat(64);const prepared=await work;assert.equal(prepared.contextPath,expected.contextPath);assert.equal(prepared.contextSha256,expected.contextSha256);assert.equal(prepared.stdin,expected.stdin);
});
test('normal factory refuses an unpackaged caller with no process or alternate PATH/ENV fallback',async()=>{
 const caller=createPackagedPQFinalityVerifier({app:{isPackaged:false},independentReceipt:null});assert.equal(Object.isFrozen(caller),true);assert.equal(Object.hasOwn(caller,'prepare'),false);assert.equal(Object.hasOwn(caller,'spawn'),false);assert.throws(()=>{caller.spawn=()=>{throw Error('foreign spawn');};},TypeError);await assert.rejects(caller.run({}),e=>e.code==='PQ_FINALITY_VERIFIER_NOT_STARTED'&&e.cause.code==='PQ_FINALITY_PACKAGED_VERIFIER_UNAVAILABLE');assert.equal(caller.snapshot().lifecycle.started,false);await caller.join();caller.assertSafeToClose();
});
test('normal factory retains detached independent resource identity before any invocation',async t=>{
 const f=await fixture(t),expected=JSON.parse(JSON.stringify(f.receipt)),caller=createPackagedPQFinalityVerifier({app:{isPackaged:false},independentReceipt:f.receipt});
 f.receipt.bundled.sha256='0'.repeat(64);f.receipt.manifest.bytes=1;
 assert.deepEqual(caller.identity(),expected);assert.equal(Object.isFrozen(caller.identity()),true);assert.equal(Object.isFrozen(caller.identity().bundled),true);
});
test('old034 proof component cannot acquire Host mode, even with valid independent proof assets',async t=>{
 const f=await fixture(t);
 assert.throws(()=>createPackagedPQHostProducer({app:{isPackaged:false},independentReceipt:f.receipt}),{code:'PQ_HOST_COMPONENT_UNAVAILABLE'});
 await assert.rejects(preparePackagedPQHostInvocation(f.root,f.receipt,{sourcePath:f.input.contextPath,sourceSha256:f.input.contextSha256,stdin:'{}'}),{code:'PQ_HOST_COMPONENT_UNAVAILABLE'});
});
test('591 identity cannot self-admit substituted bundle, manifest or SOURCE pins',()=>{
 const receipt={sourceCommit:'59185090aab3e4eaa6f8c9a0b29e975a2917e8b1',forkTree:'f694a8c86f7ed65e19d1ce08c690d5d8fe84fd42',manifest:{bytes:729,sha256:'b574373a4304c682b73442c1cd8087562ff04be515a0fb4deba88f50104d098e'},bundled:{bytes:34310208,sha256:'a7e47ea79b3e4bdd40014c8c02aafbad7b37a69c9c15c7f45a9fd0c51d44479d'},sourceFile:{bytes:1938,sha256:'8775709d35a0f2734c09a51bd4db7f446922faa34b9ca37924335dadddef61ce'}};
 for(const key of ['manifest','bundled','sourceFile']){
  const altered=structuredClone(receipt);altered[key].sha256='0'.repeat(64);
  assert.throws(()=>createPackagedPQHostProducer({app:{isPackaged:false},independentReceipt:altered}),{code:'PQ_FINALITY_ASSET_INVALID'});
 }
 const producer=createPackagedPQHostProducer({app:{isPackaged:false},independentReceipt:receipt});
 assert.equal(Object.isFrozen(producer),true);assert.equal(Object.hasOwn(producer,'spawn'),false);assert.equal(Object.hasOwn(producer,'prepare'),false);
 receipt.bundled.bytes=1;assert.equal(producer.identity().bundled.bytes,34310208);
});
test('normal Host factory refuses unpackaged execution without process or alternate fallback',async()=>{
 const caller=createPackagedPQHostProducer({app:{isPackaged:false}});
 await assert.rejects(caller.run({}),e=>e.code==='PQ_FINALITY_VERIFIER_NOT_STARTED'&&e.cause.code==='PQ_FINALITY_PACKAGED_VERIFIER_UNAVAILABLE');
 assert.equal(caller.snapshot().lifecycle.started,false);await caller.join();caller.assertSafeToClose();
});
