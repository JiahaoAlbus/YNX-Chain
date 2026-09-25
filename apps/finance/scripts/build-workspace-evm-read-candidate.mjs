#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(resolve(root,'apps/finance/web/package.json'));
const {build,version}=require('esbuild');
const source='2627b20938828b24dc1cefd8a334668033d7a07e';
const tree='321cf666466f7f6a903758810d57d9c8aa398f70';
const priorPath='apps/finance/evidence/evm-read-runtime-verifier-candidate-final-ui-01130b50-v4-20260925.json';
const output='apps/finance/evidence/evm-read-runtime-verifier-candidate-workspace-2627b209-v5-20260925.json';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=path=>readFileSync(resolve(root,path));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
assert.equal(git('rev-parse',`${source}^{tree}`),tree);
assert.equal(version,'0.25.9');
const priorBytes=read(priorPath);
assert.equal(sha256(priorBytes),'9568598e9a098b2cfdf7bf6b133db25a28cc4006079f65d25d2349c052cc4286');
const prior=JSON.parse(priorBytes);
const activeManifestSha256='9cbc39d8b9e80345965d6e0b7768bd4c6582bbeff4ef0e8ba2a5224e3d2c46eb';
assert.equal(sha256(read('apps/finance/web/wallet-verifier-manifest.json')),activeManifestSha256);
const changed=new Map([
  ['apps/finance/web/index.html',{bytes:28681,sha256:'d974c4c2a4a5aabe7559db6885b34918c5fd83d10d974849d47d345fa86006da'}],
  ['apps/finance/scripts/finance-nonregressive-runtime.mjs',{bytes:3181,sha256:'1cd69c32854af88b0b2aa8c0653f1a7868f369b2cecaffc0cdabbd608338322e'}],
  ['internal/finance/server.go',{bytes:39000,sha256:'cb1ed129b313afb6a05c76efc5ad80f2c86728ef500409a811f888f28f7cd675'}],
]);
const exactInputs=prior.exactInputs.map(input=>{
  const bytes=read(input.path),signed=execFileSync('git',['show',`${source}:${input.path}`],{cwd:root});
  assert.deepEqual(bytes,signed,`${input.path} differs from frozen owner source`);
  const observed={bytes:bytes.length,sha256:sha256(bytes)},reviewed=changed.get(input.path);
  assert.deepEqual(observed,reviewed??{bytes:input.bytes,sha256:input.sha256},`${input.path} differs from reviewed input`);
  return {path:input.path,...observed};
});
assert.deepEqual(exactInputs.filter((item,index)=>item.sha256!==prior.exactInputs[index].sha256).map(item=>item.path).sort(),[...changed.keys()].sort());
for(const relation of prior.sourceBundleRelations){
  const browser=relation.kind==='browser';
  const options={absWorkingDir:root,entryPoints:[resolve(root,relation.entry)],bundle:true,write:false,metafile:true,...(browser?{minify:true,platform:'browser',target:'es2022'}:{platform:'node',target:'node22',format:'esm'})};
  const first=await build(options),second=await build(options),frozen=read(relation.bundle);
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents),Buffer.from(second.outputFiles[0].contents));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents),frozen,relation.bundle);
  assert.equal(frozen.length,relation.bundleBytes);
  assert.equal(sha256(frozen),relation.bundleSha256);
  const paths=Object.keys(first.metafile.inputs).sort();
  assert.equal(sha256(paths.map(path=>`${path}\0${sha256(read(path))}\n`).join('')),relation.dependencyGraphSha256);
}
const candidate={...prior,reviewedOwnerSource:{commit:source,tree},existingVerifierPin:{...prior.existingVerifierPin,reviewedManifestSha256:activeManifestSha256},exactInputs};
const body=Buffer.from(`${JSON.stringify(candidate,null,2)}\n`),target=resolve(root,output);
if(existsSync(target))assert.deepEqual(readFileSync(target),body);
else writeFileSync(target,body,{flag:'wx',mode:0o644});
console.log(JSON.stringify({status:'candidate-only-not-activated',path:output,source,tree,changed:[...changed.keys()],bytes:body.length,sha256:sha256(body),bundleCount:2,cleanBuildsPerBundle:2}));
