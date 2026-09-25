#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(resolve(root,'apps/finance/web/package.json'));
const {build,version:esbuildVersion}=require('esbuild');
const source='01130b501da5c16fce41c547feabf9b7c10cd3f0';
const priorPath='apps/finance/evidence/evm-read-runtime-verifier-candidate-pr199-v2-20260925.json';
const output='apps/finance/evidence/evm-read-runtime-verifier-candidate-final-ui-01130b50-v4-20260925.json';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const read=path=>readFileSync(resolve(root,path));
const oldBytes=read(priorPath);
assert.equal(sha256(oldBytes),'69a425d8c0340e411454a466aa78a34749b1beb5976d9df7520b6d1c84c62353');
const old=JSON.parse(oldBytes);
const currentManifestSha256='32bfe7e88f15926933c14dc2ce838913508fae25a18ed0d5e06ccf9eeb3751eb';
assert.equal(sha256(read('apps/finance/web/wallet-verifier-manifest.json')),currentManifestSha256);
assert.equal(esbuildVersion,'0.25.9');
assert.equal(git('rev-parse',`${source}^{tree}`),'516650642b4a06555bf85b9b6e07c47e09cd662c');
const exactInputs=old.exactInputs.map(input=>{
  const bytes=read(input.path);
  const signed=execFileSync('git',['show',`${source}:${input.path}`],{cwd:root});
  assert.deepEqual(bytes,signed,`working input differs from reviewed source: ${input.path}`);
  if(input.path!=='apps/finance/web/index.html'){
    assert.equal(bytes.length,input.bytes,input.path);
    assert.equal(sha256(bytes),input.sha256,input.path);
  }
  return {path:input.path,bytes:bytes.length,sha256:sha256(bytes)};
});
for(const relation of old.sourceBundleRelations){
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
const candidate={...old,reviewedOwnerSource:{commit:source,tree:git('rev-parse',`${source}^{tree}`)},existingVerifierPin:{...old.existingVerifierPin,reviewedManifestSha256:currentManifestSha256},exactInputs};
const body=Buffer.from(`${JSON.stringify(candidate,null,2)}\n`);
writeFileSync(resolve(root,output),body,{flag:'wx',mode:0o644});
console.log(JSON.stringify({path:output,bytes:body.length,sha256:sha256(body),source}));
