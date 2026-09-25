#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const financeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repoRoot=resolve(financeRoot,'../..');
const webRoot=resolve(financeRoot,'web');
const activePath=resolve(webRoot,'wallet-verifier-manifest.json');
const candidatePath=resolve(financeRoot,'evidence/wallet-verifier-manifest-workspace-2627b209-v8-20260925.json');
const sourceCheckpoint='2627b20938828b24dc1cefd8a334668033d7a07e';
const evmCandidatePath='../evidence/evm-read-runtime-verifier-candidate-workspace-2627b209-v5-20260925.json';
const evmCandidate={bytes:6059,sha256:'e6740a5312449f9e3d933892e61796dfc509d306e0fb1172bf0676e4f204673d'};
const priorHash='9cbc39d8b9e80345965d6e0b7768bd4c6582bbeff4ef0e8ba2a5224e3d2c46eb';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
execFileSync('git',['merge-base','--is-ancestor',sourceCheckpoint,'HEAD'],{cwd:repoRoot});
const activeBytes=readFileSync(activePath);
assert.equal(sha256(activeBytes),priorHash,'reviewed predecessor manifest changed');
const active=JSON.parse(activeBytes),next=structuredClone(active);
assert.equal(active.schemaVersion,'ynx.finance.wallet-web-verifier.v1');
const reviewedChanges=new Map([
  ['endpoint-authority-entry.js',{bytes:4788,sha256:'42889e39394794b89e9c90b7f4c4f6484a6c38a49a6e2f88ffe5a789ef9f9868'}],
  ['endpoint-authority-store.js',{bytes:3308,sha256:'946ea4f997396e0bd1f6c4eb8de5ab0249828c1d0b0c4a3bb6755293a5de4d29'}],
  ['wallet-auth.js',{bytes:182014,sha256:'c6419bddc26227bf884583a79fa508b33e9321ee45201812263f38c9b455b63c'}],
  ['index.html',{bytes:28681,sha256:'d974c4c2a4a5aabe7559db6885b34918c5fd83d10d974849d47d345fa86006da'}],
  ['app.js',{bytes:67341,sha256:'7ad2d2f7f5bdadd15a064fea8b43c886f6c70f0713106ddcdbb081b46821083a'}],
  ['finance-locale.js',{bytes:415516,sha256:'ba82b2669da3c49457ee812188abe340828fec194344636fe139860ed2f6445d'}],
  ['styles.css',{bytes:25427,sha256:'8010214f3b579eb343c4af225c9a881aa946bbefb9e3007b3eb7abdcd59c1855'}],
  ['product-catalog.js',{bytes:7281,sha256:'dc98fedb9734207a2688f0a5ce154a16b0be11240947a4910414bb212eed9088'}],
]);
const changed=[];
for(const [index,file] of next.files.entries()){
  assert.equal(file.path,active.files[index].path,'manifest order drifted');
  if(file.path===active.evmRead.candidatePath){
    file.path=evmCandidatePath;
    const bytes=readFileSync(resolve(webRoot,file.path));
    assert.deepEqual({bytes:bytes.length,sha256:sha256(bytes)},evmCandidate,'nested EVM candidate drifted');
    Object.assign(file,evmCandidate);changed.push(file.path);
    continue;
  }
  const bytes=readFileSync(resolve(webRoot,file.path));
  const observed={bytes:bytes.length,sha256:sha256(bytes)};
  const reviewed=reviewedChanges.get(file.path);
  if(reviewed){assert.deepEqual(observed,reviewed,`${file.path} differs from frozen candidate source`);Object.assign(file,reviewed);changed.push(file.path)}
  else assert.deepEqual(observed,{bytes:file.bytes,sha256:file.sha256},`${file.path} drifted outside reviewed set`);
}
assert.deepEqual(changed.sort(),[...reviewedChanges.keys(),evmCandidatePath].sort());
const require=createRequire(resolve(webRoot,'package.json'));
const {build,version}=require('esbuild');
assert.equal(version,active.build.esbuildVersion);
const options={absWorkingDir:webRoot,entryPoints:[resolve(webRoot,active.build.entry)],bundle:true,minify:true,platform:'browser',target:'es2022',write:false};
const first=Buffer.from((await build(options)).outputFiles[0].contents);
const second=Buffer.from((await build(options)).outputFiles[0].contents);
const committed=readFileSync(resolve(webRoot,active.build.bundle));
assert.deepEqual(first,second,'Wallet rebuilds differ');
assert.deepEqual(first,committed,'Wallet bundle differs from source');
assert.equal(first.length,reviewedChanges.get('wallet-auth.js').bytes);
assert.equal(sha256(first),reviewedChanges.get('wallet-auth.js').sha256);
Object.assign(next.sourceBundleRelation,{bytes:first.length,sha256:sha256(first)});
Object.assign(next.evmRead,{candidatePath:evmCandidatePath,candidateBytes:evmCandidate.bytes,candidateSha256:evmCandidate.sha256});
const body=Buffer.from(`${JSON.stringify(next,null,2)}\n`);
if(existsSync(candidatePath))assert.deepEqual(readFileSync(candidatePath),body,'candidate bytes changed');
else writeFileSync(candidatePath,body,{flag:'wx',mode:0o644});
console.log(JSON.stringify({status:'candidate-only-not-activated',sourceCheckpoint,changed,bytes:body.length,sha256:sha256(body),bundleBytes:first.length,bundleSha256:sha256(first),cleanBuilds:2}));
