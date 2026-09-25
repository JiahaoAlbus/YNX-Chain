#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const webRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../web');
const require=createRequire(resolve(webRoot,'package.json'));
const {build,version:esbuildVersion}=require('esbuild');
const manifestPath=resolve(webRoot,'wallet-verifier-manifest.json');
const priorSha256='fe22be4766486090a1e99b120fe445e4174db1ba98938ca528a6e4d542c0c599';
const newCandidate='../evidence/evm-read-runtime-verifier-candidate-pr199-v2-20260925.json';
const newCandidateSha256='69a425d8c0340e411454a466aa78a34749b1beb5976d9df7520b6d1c84c62353';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const priorBytes=readFileSync(manifestPath);
assert.equal(sha256(priorBytes),priorSha256,'reviewed predecessor manifest changed');
const prior=JSON.parse(priorBytes);
assert.equal(prior.schemaVersion,'ynx.finance.wallet-web-verifier.v1');
assert.equal(prior.evmRead.candidatePath,'../evidence/evm-read-runtime-verifier-candidate-20260924.json');
assert.equal(esbuildVersion,prior.build.esbuildVersion);
const candidateBytes=readFileSync(resolve(webRoot,newCandidate));
assert.equal(sha256(candidateBytes),newCandidateSha256,'EVM read candidate changed after review');
const buildOptions={absWorkingDir:webRoot,entryPoints:[resolve(webRoot,prior.build.entry)],bundle:true,minify:true,platform:'browser',target:'es2022',write:false};
const first=await build(buildOptions),second=await build(buildOptions);
assert.equal(first.outputFiles.length,1);
assert.equal(second.outputFiles.length,1);
const firstBytes=Buffer.from(first.outputFiles[0].contents),secondBytes=Buffer.from(second.outputFiles[0].contents),frozenBundle=readFileSync(resolve(webRoot,prior.build.bundle));
assert.deepEqual(firstBytes,secondBytes,'two independent Wallet browser builds differ');
assert.deepEqual(firstBytes,frozenBundle,'frozen Wallet browser bundle differs from source');
assert.equal(frozenBundle.length,prior.sourceBundleRelation.bytes);
assert.equal(sha256(frozenBundle),prior.sourceBundleRelation.sha256);
const paths=prior.files.map(item=>item.path===prior.evmRead.candidatePath?newCandidate:item.path);
assert.equal(new Set(paths).size,paths.length,'duplicate verifier source');
const files=paths.map(path=>{
  const bytes=readFileSync(resolve(webRoot,path));
  return {path,bytes:bytes.length,sha256:sha256(bytes)};
});
const next={
  schemaVersion:prior.schemaVersion,
  build:prior.build,
  evmRead:{candidatePath:newCandidate,candidateBytes:candidateBytes.length,candidateSha256:newCandidateSha256},
  sourceBundleRelation:prior.sourceBundleRelation,
  files,
};
const bytes=Buffer.from(`${JSON.stringify(next,null,2)}\n`);
writeFileSync(manifestPath,bytes,{flag:'w',mode:0o644});
console.log(JSON.stringify({path:'apps/finance/web/wallet-verifier-manifest.json',bytes:bytes.length,sha256:sha256(bytes)}));
