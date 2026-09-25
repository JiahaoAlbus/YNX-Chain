#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const financeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const webRoot=resolve(financeRoot,'web');
const priorPath=resolve(webRoot,'wallet-verifier-manifest.json');
const candidatePath=resolve(financeRoot,'evidence/wallet-verifier-manifest-test-market-preview-6d7ebb4d-v1-20260925.json');
const priorSha256='9cbc39d8b9e80345965d6e0b7768bd4c6582bbeff4ef0e8ba2a5224e3d2c46eb';
const reviewedChanges=new Map([
  ['finance-locale.js',{bytes:38181,sha256:'a09bbc90aeed1d45feb857b820ddf986887c3daedc0e199ceda5314dbb1f7ee4'}],
  ['product-catalog.js',{bytes:7281,sha256:'dc98fedb9734207a2688f0a5ce154a16b0be11240947a4910414bb212eed9088'}],
]);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const originalBytes=readFileSync(priorPath);
assert.equal(sha256(originalBytes),priorSha256,'active verifier manifest changed after review');
const original=JSON.parse(originalBytes.toString('utf8'));
assert.equal(original.schemaVersion,'ynx.finance.wallet-web-verifier.v1');
assert.deepEqual([...reviewedChanges.keys()].sort(),['finance-locale.js','product-catalog.js']);
const next=structuredClone(original);
let unchanged=0;
for(const item of next.files){
  const bytes=readFileSync(resolve(webRoot,item.path));
  const observed={bytes:bytes.length,sha256:sha256(bytes)};
  const reviewed=reviewedChanges.get(item.path);
  if(reviewed){
    assert.deepEqual(observed,reviewed,`${item.path} differs from the independently reviewed source`);
    item.bytes=reviewed.bytes;
    item.sha256=reviewed.sha256;
  }else{
    assert.equal(item.bytes,observed.bytes,`${item.path} bytes drifted`);
    assert.equal(item.sha256,observed.sha256,`${item.path} SHA-256 drifted`);
    unchanged++;
  }
}
assert.equal(next.files.length,original.files.length);
assert.equal(unchanged,original.files.length-reviewedChanges.size);
assert.deepEqual({...next,files:original.files},original,'non-file verifier contract drifted');
for(const [index,item] of next.files.entries()){
  if(!reviewedChanges.has(item.path))assert.deepEqual(item,original.files[index],`${item.path} entry changed`);
}

const require=createRequire(resolve(webRoot,'package.json'));
const {build,version}=require('esbuild');
assert.equal(version,original.build.esbuildVersion,'reviewed build tool drifted');
const options={absWorkingDir:webRoot,entryPoints:[resolve(webRoot,original.build.entry)],bundle:true,minify:true,platform:'browser',target:'es2022',write:false};
const first=Buffer.from((await build(options)).outputFiles[0].contents);
const second=Buffer.from((await build(options)).outputFiles[0].contents);
const committed=readFileSync(resolve(webRoot,original.build.bundle));
assert.deepEqual(first,second,'Wallet bundle rebuild is nondeterministic');
assert.deepEqual(first,committed,'Wallet bundle changed without review');
assert.equal(first.length,original.sourceBundleRelation.bytes);
assert.equal(sha256(first),original.sourceBundleRelation.sha256);

const candidateBytes=Buffer.from(`${JSON.stringify(next,null,2)}\n`);
if(existsSync(candidatePath))assert.deepEqual(readFileSync(candidatePath),candidateBytes,'versioned candidate differs');
else writeFileSync(candidatePath,candidateBytes,{flag:'wx',mode:0o644});
console.log(JSON.stringify({status:'candidate-only-not-activated',path:'apps/finance/evidence/wallet-verifier-manifest-test-market-preview-6d7ebb4d-v1-20260925.json',bytes:candidateBytes.length,sha256:sha256(candidateBytes),reviewedChangedFiles:[...reviewedChanges.keys()],unchangedEntries:unchanged,walletBundleSha256:sha256(first),cleanBuildCount:2}));
