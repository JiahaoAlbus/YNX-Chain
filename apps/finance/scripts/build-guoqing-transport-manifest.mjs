#!/usr/bin/env node
// Finance source candidate only; not public endpoint or installed Wallet proof.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const web=resolve(dirname(fileURLToPath(import.meta.url)),'../web'),root=resolve(web,'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const frozen=execFileSync('git',['show','1d70d3712:apps/finance/web/wallet-verifier-manifest.json'],{cwd:root});
assert.equal(sha(frozen),'73dec50123b34da6be72d33afc851a470a1e5b9a175daff1a5b78189ab2c4cd5');
const prior=JSON.parse(frozen),candidatePath=process.argv[2]??'../evidence/evm-read-runtime-verifier-candidate-guoqing-hosted-native-d334806c-20261001.json';
const candidatePin=process.argv[3]??'0aa296f795b703377b1373841787e9ff531ff9e9d61353156ec642557b6e2fe6';
assert.ok(process.argv.length===2||process.argv.length===4,'supply both successor candidate path and reviewed SHA256');
assert.match(candidatePath,/^\.\.\/evidence\/evm-read-runtime-verifier-candidate-[a-z0-9-]+\.json$/u);assert.match(candidatePin,/^[0-9a-f]{64}$/u);
const candidate=readFileSync(resolve(web,candidatePath));
assert.equal(sha(candidate),candidatePin);
const {build,version}=createRequire(resolve(web,'package.json'))('esbuild');assert.equal(version,'0.25.9');
const options={absWorkingDir:web,entryPoints:[resolve(web,'wallet-auth-entry.js')],bundle:true,minify:true,platform:'browser',target:'es2022',write:false};
const [first,second]=await Promise.all([build(options),build(options)]),bundle=readFileSync(resolve(web,'wallet-auth.js'));
assert.deepEqual(Buffer.from(first.outputFiles[0].contents),Buffer.from(second.outputFiles[0].contents));
assert.deepEqual(Buffer.from(first.outputFiles[0].contents),bundle);
const changed=new Set(['wallet-auth-entry.js','private-wallet-entry.js','endpoint-authority-entry.js','wallet-auth.js','evm-read-session.js','index.html','app.js','finance-locale.js','styles.css','verify-evm-read-candidate.mjs','hosted-wallet-controller.js','private-subject-boundary.js']);
const files=prior.files.map(item=>{
  const path=item.path===prior.evmRead.candidatePath?candidatePath:item.path,bytes=readFileSync(resolve(web,path));
  if(path===item.path&&!changed.has(path)){assert.equal(bytes.length,item.bytes,path);assert.equal(sha(bytes),item.sha256,path)}
  return {path,bytes:bytes.length,sha256:sha(bytes)};
});
const path='../../../packages/wallet-auth/src/wallet-provider-discovery.js',bytes=readFileSync(resolve(web,path));files.push({path,bytes:bytes.length,sha256:sha(bytes)});
const hostedPath='../../../packages/wallet-auth/src/vendor/hosted-wallet-adapter-4bccefef.js',hostedBytes=readFileSync(resolve(web,hostedPath));
assert.equal(hostedBytes.length,12659);assert.equal(sha(hostedBytes),'2567f4ec0958852ef27ee382067b6b104e33fe5dc3feba3aa94d710caa7f2c0a');
files.push({path:hostedPath,bytes:hostedBytes.length,sha256:sha(hostedBytes)});
const manifest={...prior,evmRead:{candidatePath,candidateBytes:candidate.length,candidateSha256:sha(candidate)},sourceBundleRelation:{byteReproducible:true,status:'VERIFIED_REPRODUCIBLE',cleanBuildCount:2,bytes:bundle.length,sha256:sha(bundle)},files};
const body=Buffer.from(`${JSON.stringify(manifest,null,2)}\n`);
writeFileSync(resolve(web,'wallet-verifier-manifest.json'),body);
console.log(JSON.stringify({status:'source-candidate-only',manifestSha256:sha(body),walletBytes:bundle.length,walletSha256:sha(bundle),publicRuntimeVerified:false}));
