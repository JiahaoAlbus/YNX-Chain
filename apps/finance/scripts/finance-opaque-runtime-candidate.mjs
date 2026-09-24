#!/usr/bin/env node
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authorityRuntimeFiles,runtimeFiles} from './finance-nonregressive-runtime.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const webRequire=createRequire(resolve(root,'apps/finance/web/package.json'));
const {build,version:esbuildVersion}=webRequire('esbuild');
const candidatePath='apps/finance/evidence/finance-opaque-runtime-candidate-20260925.json';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sourceAt=(commit,path)=>execFileSync('git',['show',`${commit}:${path}`],{cwd:root});
const inputs=Object.freeze([
  ...runtimeFiles.map(name=>`apps/finance/web/${name}`),
  ...authorityRuntimeFiles.map(item=>item.source),
  'apps/finance/web/package.json',
  'apps/finance/scripts/finance-nonregressive-runtime.mjs',
  'apps/finance/scripts/finance-opaque-runtime-candidate.mjs',
  'apps/finance/cmd/server/main.go',
  'internal/finance/server.go','internal/finance/drain.go','internal/finance/auth_v2.go',
  'internal/finance/broker_order_handoff_http.go','internal/finance/broker_order_handoff_store.go',
  'internal/finance/broker_order_handoff_exchange.go','internal/finance/broker_order_store.go',
  'internal/finance/broker_order_types.go',
  'packages/wallet-auth/package.json','packages/wallet-auth/package-lock.json',
].sort());
const relations=Object.freeze([
  Object.freeze({kind:'browser',entry:'apps/finance/scripts/finance-order-opaque-browser-entry.mjs',bundle:'apps/finance/web/order-opaque.js',options:{bundle:true,minify:true,platform:'browser',target:'es2022'}}),
  Object.freeze({kind:'node',entry:'apps/finance/scripts/finance-order-opaque-authority.mjs',bundle:'apps/finance/scripts/finance-order-opaque-authority.bundle.mjs',options:{bundle:true,platform:'node',target:'node22',format:'esm'}}),
]);

function inventory(bytes,path){return {path,bytes:bytes.length,sha256:sha256(bytes)}}
async function relationReceipt(relation,read){
  const options={absWorkingDir:root,entryPoints:[resolve(root,relation.entry)],write:false,metafile:true,...relation.options};
  const first=await build(options),second=await build(options);
  assert.equal(first.outputFiles.length,1);assert.equal(second.outputFiles.length,1);
  const firstBytes=Buffer.from(first.outputFiles[0].contents),secondBytes=Buffer.from(second.outputFiles[0].contents);
  assert.deepEqual(firstBytes,secondBytes,'two independent builds must be byte-identical');
  const bundle=read(relation.bundle);
  assert.deepEqual(firstBytes,bundle,`${relation.kind} bundle differs from source rebuild`);
  const graph=Object.keys(first.metafile.inputs).sort().map(path=>inventory(
    path.startsWith('packages/wallet-auth/node_modules/') ? readFileSync(resolve(root,path)) : read(path),path));
  for(const item of graph)assert.match(item.path,/^(?:apps\/finance\/scripts\/finance-order-opaque-(?:authority|browser-entry)\.mjs|packages\/wallet-auth\/(?:src\/|node_modules\/))/u,'unreviewed transitive input');
  return {kind:relation.kind,entry:relation.entry,bundle:relation.bundle,tool:`esbuild@${esbuildVersion}`,independentBuilds:2,
    installedDependencies:'must be reproduced from pinned packages/wallet-auth/package-lock.json before independent review',
    graph,graphSha256:sha256(graph.map(item=>`${item.path}\0${item.sha256}\n`).join('')),bundleBytes:bundle.length,bundleSha256:sha256(bundle)};
}
function verifyClosure(read){
  const html=read('apps/finance/web/index.html').toString('utf8');
  const server=read('internal/finance/server.go').toString('utf8');
  const drain=read('internal/finance/drain.go').toString('utf8');
  const app=read('apps/finance/web/app.js').toString('utf8');
  assert.equal((html.match(/<script src="\/order-opaque\.js" defer><\/script>/gu)||[]).length,1);
  assert.match(server,/"\/order-opaque\.js": "order-opaque\.js"/u);
  assert.match(drain,/"\/order-opaque\.js"/u);
  assert.match(app,/\/api\/broker\/order-handoff\/issue/u);
  assert.match(app,/body:JSON\.stringify\(\{code,state:stateToken\}\)/u);
  assert.doesNotMatch(app,/location\.(?:assign|replace)\s*\(\s*['"]ynxwallet:/u);
  assert.doesNotMatch(app,/location\.href\s*=\s*['"]ynxwallet:/u);
  assert.match(server,/r\.URL\.Path == "\/wallet-auth\/callback"/u);
}
async function receipt(sourceCommit,read){
  verifyClosure(read);
  const exactInputs=inputs.map(path=>inventory(read(path),path));
  assert.equal(new Set(exactInputs.map(item=>item.path)).size,exactInputs.length,'duplicate runtime input');
  return {schemaVersion:'ynx.finance.opaque-runtime-candidate.v1',status:'INDEPENDENT_REVIEW_REQUIRED_NOT_PINNED_NOT_PUBLIC',sourceCommit,sourceTree:git('rev-parse',`${sourceCommit}^{tree}`),
    exactInputs,relations:await Promise.all(relations.map(item=>relationReceipt(item,read))),
    truth:{localByteRebuild:true,fullTestSuitePassed:false,installedLocal:false,deployedPublic:false,realWalletApproval:false,providerOrderWrite:false,productionSigned:false}};
}
async function main(){
  const [mode,argument]=process.argv.slice(2);
  if(mode==='build'){
    assert.equal(git('status','--porcelain'),'','candidate build requires a clean source tree');
    const commit=git('rev-parse','HEAD');
    const value=await receipt(commit,path=>readFileSync(resolve(root,path)));
    writeFileSync(resolve(root,candidatePath),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o644});
    console.log(JSON.stringify({path:candidatePath,sourceCommit:commit,bytes:readFileSync(resolve(root,candidatePath)).length,sha256:sha256(readFileSync(resolve(root,candidatePath)))}));
  }else if(mode==='verify'){
    assert.match(argument||'',/^[0-9a-f]{64}$/u,'independent candidate SHA-256 pin required');
    const raw=readFileSync(resolve(root,candidatePath));assert.equal(sha256(raw),argument,'candidate pin mismatch');
    const candidate=JSON.parse(raw);
    assert.match(candidate.sourceCommit,/^[0-9a-f]{40}$/u);
    const reviewed=await receipt(candidate.sourceCommit,path=>sourceAt(candidate.sourceCommit,path));
    assert.deepEqual(candidate,reviewed,'candidate differs from exact committed source');
    for(const item of candidate.exactInputs){const local=readFileSync(resolve(root,item.path));assert.equal(local.length,item.bytes,item.path);assert.equal(sha256(local),item.sha256,item.path)}
    console.log(JSON.stringify({status:'LOCAL_CANDIDATE_VERIFIED_NOT_REVIEWED_NOT_PUBLIC',sourceCommit:candidate.sourceCommit,candidateSha256:argument}));
  }else throw new Error('usage: finance-opaque-runtime-candidate.mjs build | verify <independent-sha256-pin>');
}
await main();
