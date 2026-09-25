#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const financeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const webRoot=resolve(financeRoot,'web');
const sourcePath=resolve(financeRoot,'evidence/wallet-verifier-manifest-workspace-2627b209-v8-20260925.json');
const output=resolve(financeRoot,'evidence/wallet-verifier-manifest-workspace-2627b209-v9-20260925.json');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const priorBytes=readFileSync(sourcePath);
assert.equal(sha256(priorBytes),'fc61b774e045dc5cc0d72ac04eea2f89c3df904da697c9d37830c72b78da2fae');
const prior=JSON.parse(priorBytes),next=structuredClone(prior);
const verifiedPath='verify-evm-read-candidate.mjs';
const reviewed={bytes:7076,sha256:'139829bbabbb84988a06084880ad983fda19186abef2dc28b583ee96af3d1758'};
const entry=next.files.find(file=>file.path===verifiedPath);
assert.ok(entry);
const verifier=readFileSync(resolve(webRoot,verifiedPath));
assert.deepEqual({bytes:verifier.length,sha256:sha256(verifier)},reviewed);
Object.assign(entry,reviewed);
for(const file of next.files){
  const bytes=readFileSync(resolve(webRoot,file.path));
  assert.deepEqual({bytes:bytes.length,sha256:sha256(bytes)},{bytes:file.bytes,sha256:file.sha256},file.path);
}
const require=createRequire(resolve(webRoot,'package.json'));
const {build,version}=require('esbuild');
assert.equal(version,next.build.esbuildVersion);
const options={absWorkingDir:webRoot,entryPoints:[resolve(webRoot,next.build.entry)],bundle:true,minify:true,platform:'browser',target:'es2022',write:false};
const first=Buffer.from((await build(options)).outputFiles[0].contents),second=Buffer.from((await build(options)).outputFiles[0].contents);
assert.deepEqual(first,second);
assert.deepEqual(first,readFileSync(resolve(webRoot,next.build.bundle)));
assert.equal(first.length,next.sourceBundleRelation.bytes);
assert.equal(sha256(first),next.sourceBundleRelation.sha256);
const body=Buffer.from(`${JSON.stringify(next,null,2)}\n`);
if(existsSync(output))assert.deepEqual(readFileSync(output),body);
else writeFileSync(output,body,{flag:'wx',mode:0o644});
console.log(JSON.stringify({status:'reviewed-candidate-not-activated',path:'apps/finance/evidence/wallet-verifier-manifest-workspace-2627b209-v9-20260925.json',bytes:body.length,sha256:sha256(body),delta:[verifiedPath],verifier:reviewed,walletBuilds:2}));
