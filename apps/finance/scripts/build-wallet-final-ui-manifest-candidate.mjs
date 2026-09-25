#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../web');
const require=createRequire(resolve(root,'package.json'));
const {build,version}=require('esbuild');
const prior=readFileSync(resolve(root,'wallet-verifier-manifest.json'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256(prior),'32bfe7e88f15926933c14dc2ce838913508fae25a18ed0d5e06ccf9eeb3751eb');
assert.equal(version,'0.25.9');
const priorManifest=JSON.parse(prior);
const candidatePath='../evidence/evm-read-runtime-verifier-candidate-final-ui-17b76fcc-v3-20260925.json';
const candidateBytes=readFileSync(resolve(root,candidatePath));
const candidateSha256='514c92e996081e9cbec27db31242957df2307ae7c9961449213e8f01a26c771c';
assert.equal(sha256(candidateBytes),candidateSha256);
const buildOptions={absWorkingDir:root,entryPoints:[resolve(root,priorManifest.build.entry)],bundle:true,minify:true,platform:'browser',target:'es2022',write:false};
const first=await build(buildOptions),second=await build(buildOptions);
const bundle=readFileSync(resolve(root,priorManifest.build.bundle));
assert.deepEqual(Buffer.from(first.outputFiles[0].contents),Buffer.from(second.outputFiles[0].contents));
assert.deepEqual(Buffer.from(first.outputFiles[0].contents),bundle);
const changed=new Set(['wallet-auth-entry.js','private-wallet-entry.js','wallet-auth.js','index.html','app.js','finance-locale.js','product-catalog.js','verify-evm-read-candidate.mjs']);
const files=priorManifest.files.map(item=>{
  const path=item.path===priorManifest.evmRead.candidatePath?candidatePath:item.path;
  const body=readFileSync(resolve(root,path));
  if(path===item.path&&!changed.has(path)){
    assert.equal(body.length,item.bytes,path);
    assert.equal(sha256(body),item.sha256,path);
  }
  return {path,bytes:body.length,sha256:sha256(body)};
});
assert.equal(new Set(files.map(file=>file.path)).size,files.length);
const manifest={
  schemaVersion:priorManifest.schemaVersion,
  build:priorManifest.build,
  evmRead:{candidatePath,candidateBytes:candidateBytes.length,candidateSha256},
  sourceBundleRelation:{byteReproducible:true,status:'VERIFIED_REPRODUCIBLE',cleanBuildCount:2,bytes:bundle.length,sha256:sha256(bundle)},
  files,
};
const output='../evidence/wallet-verifier-manifest-final-ui-17b76fcc-v3-20260925.json';
const body=Buffer.from(`${JSON.stringify(manifest,null,2)}\n`);
writeFileSync(resolve(root,output),body,{flag:'wx',mode:0o644});
console.log(JSON.stringify({path:`apps/finance/evidence/${output.split('/').at(-1)}`,bytes:body.length,sha256:sha256(body),walletBundle:{bytes:bundle.length,sha256:sha256(bundle)}}));
