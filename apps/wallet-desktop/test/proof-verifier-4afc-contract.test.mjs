import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,cpSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {originalPQ4afcVerifierReceipt} from '../src/wallet-pq-4afc-receipt.mjs';
import {createHash} from 'node:crypto';
import {ORIGINAL_4AFC_VERIFIER,verifyOriginal4afcCISupply,createOriginal4afcManifestBytes} from '../scripts/proof-verifier-4afc-contract.mjs';
import {pathToFileURL} from 'node:url';
import {assertSelectedProofVerifierForSDK} from '../scripts/proof-verifier-source-policy.mjs';
const root=process.env.WALLET_4AFC_CI_SUPPLY;
test('normal product consumer verifies actual original A signed4afc assets and refuses copied byte mutations without execution',{skip:!process.env.WALLET_4AFC_SIGNED_RESOURCES||!process.env.WALLET_4AFC_NORMAL_PRODUCT_SOURCE?'requires original A signed resources and physical SDK46 product':false},async()=>{
 const base=process.env.WALLET_4AFC_NORMAL_PRODUCT_SOURCE+'/apps/wallet-desktop/src/';
 for(const name of ['wallet-pq-verifier-assets.mjs','wallet-pq-4afc-receipt.mjs','wallet-pq-runtime-component.mjs'])assert.deepEqual(readFileSync(base+name),readFileSync(new URL('../src/'+name,import.meta.url)));
 const consumer=await import(pathToFileURL(base+'wallet-pq-verifier-assets.mjs'));
 const {originalPQVerifierReceipt:receipt}=await import(pathToFileURL(base+'wallet-pq-runtime-component.mjs'));
 assert.deepEqual(receipt,originalPQ4afcVerifierReceipt);
 assert.equal(consumer.supportsPackagedPQTypedFinality(receipt),true);
 assert.equal(consumer.packagedPQVerifierAssetPaths(receipt).length,4);
 const resources=process.env.WALLET_4AFC_SIGNED_RESOURCES;
 assert.equal((await consumer.verifyPackagedPQVerifierAssets(resources,receipt)).executable,path.join(resources,'consensus-proof-verifier/darwin-arm64/ynx-consensus-proof-verify'));
 for(const key of ['manifest','bundled','sourceFile'])assert.throws(()=>consumer.supportsPackagedPQTypedFinality({...receipt,[key]:{...receipt[key],sha256:'0'.repeat(64)}}));
 const temporary=realpathSync(mkdtempSync(path.join(tmpdir(),'wallet-4afc-assets-')));
 try{
  cpSync(path.join(resources,'consensus-proof-verifier'),path.join(temporary,'consensus-proof-verifier'),{recursive:true});
  for(const relative of consumer.packagedPQVerifierAssetPaths(receipt)){
   const file=path.join(temporary,'consensus-proof-verifier',relative),original=readFileSync(file),changed=Buffer.from(original);changed[0]^=1;
   writeFileSync(file,changed);await assert.rejects(()=>consumer.verifyPackagedPQVerifierAssets(temporary,receipt));writeFileSync(file,original);
  }
  await consumer.verifyPackagedPQVerifierAssets(temporary,receipt);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
test('normal original A signing contract binds exact4afc CI binary/SOURCE/selector without executing any verifier',{skip:!root?'requires frozen original4afc public CI files':false},()=>{
 const input={binaryBytes:readFileSync(root+'/ynx-consensus-proof-verify-darwin-arm64'),sourceBytes:readFileSync(root+'/SOURCE.json'),selectionSourceBytes:readFileSync(root+'/HOST_SELECTION_SOURCE_GIT_PINS.json')};const checked=verifyOriginal4afcCISupply(input);assert.equal(checked.rawCIExact,true);assert.equal(checked.artifactExecuted,false);assert.equal(checked.Root,false);
 for(const key of Object.keys(input)){const bad={...input,[key]:Buffer.from(input[key])};bad[key][0]^=1;assert.throws(()=>verifyOriginal4afcCISupply(bad));}
});
test('post-sign manifest computes actual supplied byte pins without accepting caller supplied hashes',()=>{
 const fake=Buffer.alloc(32);fake.writeUInt32LE(0xfeedfacf,0);fake.writeUInt32LE(0x0100000c,4);const raw=createOriginal4afcManifestBytes(fake),m=JSON.parse(raw);assert.equal(m.sourceCommit,ORIGINAL_4AFC_VERIFIER.sourceCommit);assert.equal(m.bundled.sha256,createHash('sha256').update(fake).digest('hex'));assert.equal(m.signingClass,'ADHOC_QA_NOT_CLEARED');assert.deepEqual(m.ciOriginal,ORIGINAL_4AFC_VERIFIER.ciOriginal);
 assert.throws(()=>createOriginal4afcManifestBytes(Buffer.from('not a Mach-O')));
});
test('identical actual Main asset consumer in normal whole-SDK product layout rejects self-admitted4afc manifest',{skip:!process.env.WALLET_4AFC_NORMAL_PRODUCT_SOURCE?'requires existing normal physical whole-SDK product layout, no loader/alias':false},async()=>{
 const file=process.env.WALLET_4AFC_NORMAL_PRODUCT_SOURCE+'/apps/wallet-desktop/src/wallet-pq-verifier-assets.mjs';assert.deepEqual(readFileSync(file),readFileSync(new URL('../src/wallet-pq-verifier-assets.mjs',import.meta.url)));
 const {supportsPackagedPQTypedFinality}=await import(pathToFileURL(file));const fake=Buffer.alloc(32);fake.writeUInt32LE(0xfeedfacf,0);fake.writeUInt32LE(0x0100000c,4);const raw=createOriginal4afcManifestBytes(fake),m=JSON.parse(raw),pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});assert.throws(()=>supportsPackagedPQTypedFinality({sourceCommit:m.sourceCommit,forkTree:m.forkTree,manifest:pin(raw),bundled:pin(fake),sourceFile:ORIGINAL_4AFC_VERIFIER.sourceFile}));
});
test('normal SDK46 Mac build cannot silently select old514e or Linux/unknown verifier while keeping old42 source policy',()=>{
 for(const receipt of [null,{}, {sourceCommit:'514e7763116b6bdaf0bbea5ba3b91c5269105cd0'},{sourceCommit:'0fe63a38691bc6681a578df161c557506532963b'}])assert.throws(()=>assertSelectedProofVerifierForSDK('1.3.0-pq.3.32-auth.46',receipt),/SDK46_4AFC_SIGNED_VERIFIER_REQUIRED/);
 assertSelectedProofVerifierForSDK('1.3.0-pq.3.32-auth.42',{sourceCommit:'514e7763116b6bdaf0bbea5ba3b91c5269105cd0'});assertSelectedProofVerifierForSDK('1.3.0-pq.3.32-auth.46',{sourceCommit:ORIGINAL_4AFC_VERIFIER.sourceCommit});
 const source=readFileSync(new URL('../scripts/build-mac.mjs',import.meta.url),'utf8');assert(source.indexOf('assertSelectedProofVerifierForSDK(matchedSDK.version')<source.indexOf('if(proofVerifierStage!==null)await verifyPackagedPQVerifierAssets'));
});
