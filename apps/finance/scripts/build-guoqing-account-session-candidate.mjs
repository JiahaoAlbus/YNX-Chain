#!/usr/bin/env node
// Deterministic successor to the existing EVM-read candidate builder. This
// produces review material, not an activated public-runtime authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const source='79b48ace5';
const output='apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-sso-79b48ace-20261001.json';
const priorPath='apps/finance/evidence/evm-read-runtime-verifier-candidate-workspace-2627b209-v5-20260925.json';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=path=>readFileSync(resolve(root,path));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const priorBytes=read(priorPath);
assert.equal(sha256(priorBytes),'e6740a5312449f9e3d933892e61796dfc509d306e0fb1172bf0676e4f204673d');
const prior=JSON.parse(priorBytes);
const {build,version}=createRequire(resolve(root,'apps/finance/web/package.json'))('esbuild');
assert.equal(version,'0.25.9');
const paths=[...prior.exactInputs.map(value=>value.path),'apps/finance/web/app.js','apps/finance/web/finance-locale.js',
  'packages/wallet-auth/product-session-registry.json','packages/wallet-auth/src/central-browser-session-contract.js','packages/wallet-auth/src/central-browser-session-registry.js',
  'packages/wallet-auth/src/central-browser-session-store.js','packages/wallet-auth/src/central-browser-session.js',
  'packages/wallet-auth/src/central-browser-session-browser.js','packages/wallet-auth/src/central-browser-session-browser.bundle.js',
  'packages/wallet-auth/src/product-session-gateway-node-host.js','packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs',
  'internal/finance/browser_sso.go','internal/finance/browser_sso_binding.go','internal/finance/server.go',
  'internal/finance/store.go','internal/finance/types.go','apps/finance/cmd/server/main.go'];
const exactInputs=[...new Set(paths)].map(path=>{
  const bytes=read(path),frozen=execFileSync('git',['show',`${source}:${path}`],{cwd:root});
  assert.deepEqual(bytes,frozen,`${path} differs from implementation checkpoint`);
  return {path,bytes:bytes.length,sha256:sha256(bytes)};
});
const sourceBundleRelations=[];
const centralOptions={absWorkingDir:resolve(root,'packages/wallet-auth'),entryPoints:['src/central-browser-session-browser.js'],bundle:true,write:false,platform:'browser',format:'iife',legalComments:'none'};
const centralFirst=await build(centralOptions),centralSecond=await build(centralOptions);
assert.deepEqual(Buffer.from(centralFirst.outputFiles[0].contents),Buffer.from(centralSecond.outputFiles[0].contents));
assert.deepEqual(Buffer.from(centralFirst.outputFiles[0].contents),read('packages/wallet-auth/src/central-browser-session-browser.bundle.js'));
for(const relation of prior.sourceBundleRelations){
  const options={absWorkingDir:root,entryPoints:[resolve(root,relation.entry)],bundle:true,write:false,metafile:true,...(relation.kind==='browser'?{minify:true,platform:'browser',target:'es2022'}:{platform:'node',target:'node22',format:'esm'})};
  const first=await build(options),second=await build(options),frozen=read(relation.bundle);
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents),Buffer.from(second.outputFiles[0].contents));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents),frozen,relation.bundle);
  const inputs=Object.keys(first.metafile.inputs).sort();
  sourceBundleRelations.push({...relation,bundleBytes:frozen.length,bundleSha256:sha256(frozen),dependencyGraphInputs:inputs.length,repositoryGraphInputs:inputs.filter(path=>!path.includes('/node_modules/')).length,lockedDependencyGraphInputs:inputs.filter(path=>path.includes('/node_modules/')).length,dependencyGraphSha256:sha256(inputs.map(path=>`${path}\0${sha256(read(path))}\n`).join(''))});
}
const candidate={...prior,reviewedOwnerSource:{commit:git('rev-parse',source),tree:git('rev-parse',`${source}^{tree}`)},existingVerifierPin:{...prior.existingVerifierPin,pinChanged:false},exactInputs,sourceBundleRelations};
const body=Buffer.from(`${JSON.stringify(candidate,null,2)}\n`),target=resolve(root,output);
if(existsSync(target))assert.deepEqual(readFileSync(target),body);else writeFileSync(target,body,{flag:'wx',mode:0o644});
console.log(JSON.stringify({status:'candidate-only-independent-review-required',path:output,bytes:body.length,sha256:sha256(body),bundleCount:2,cleanBuildsPerBundle:2,publicRuntimeVerified:false}));
