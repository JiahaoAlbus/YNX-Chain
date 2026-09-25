#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const webRequire=createRequire(resolve(root,'apps/finance/web/package.json'));
const {build,version:esbuildVersion}=webRequire('esbuild');
assert.equal(esbuildVersion,'0.25.9','EVM read build tool changed');
const opaquePath='apps/finance/evidence/finance-opaque-runtime-candidate-pr199-v2-20260925.json';
const opaqueSha256='420859cbf51d689a16904168dd6925756331aad8beddde14f5d8499216918a66';
const destination='apps/finance/evidence/evm-read-runtime-verifier-candidate-pr199-v2-20260925.json';
const priorPath='apps/finance/evidence/evm-read-runtime-verifier-candidate-20260924.json';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const read=path=>readFileSync(resolve(root,path));

assert.equal(git('status','--porcelain'),'','candidate generation requires a clean source tree');
const opaqueBytes=read(opaquePath);
assert.equal(sha256(opaqueBytes),opaqueSha256,'independently reviewed complete runtime candidate changed');
const opaque=JSON.parse(opaqueBytes);
assert.equal(opaque.sourceCommit,'6e2b35cb2e7bb8cc2830a4baaccca2fef116ac4d');
assert.equal(opaque.status,'INDEPENDENT_REVIEW_REQUIRED_NOT_PINNED_NOT_PUBLIC');
const prior=JSON.parse(read(priorPath));
const inventory=new Map([...opaque.exactInputs,...opaque.relations.flatMap(item=>item.graph)].map(item=>[item.path,item]));
const exactInputs=prior.exactInputs.map(item=>{
  const current=inventory.get(item.path);
  assert.ok(current,`complete runtime candidate omits ${item.path}`);
  const bytes=read(item.path);
  assert.equal(bytes.length,current.bytes,item.path);
  assert.equal(sha256(bytes),current.sha256,item.path);
  return current;
});
const relation=async(old,options)=>{
  const buildOptions={absWorkingDir:root,entryPoints:[resolve(root,old.entry)],write:false,metafile:true,...options};
  const first=await build(buildOptions),second=await build(buildOptions);
  assert.equal(first.outputFiles.length,1);
  assert.equal(second.outputFiles.length,1);
  const bundle=read(old.bundle),firstBytes=Buffer.from(first.outputFiles[0].contents),secondBytes=Buffer.from(second.outputFiles[0].contents);
  assert.deepEqual(firstBytes,secondBytes,`${old.kind} independent builds differ`);
  assert.deepEqual(firstBytes,bundle,`${old.kind} current bundle differs from source`);
  const paths=Object.keys(first.metafile.inputs).sort();
  for(const path of paths)assert.ok(path===old.entry||path.startsWith('packages/wallet-auth/src/')||path.startsWith('packages/wallet-auth/node_modules/@noble/'),`unreviewed ${old.kind} graph input: ${path}`);
  return {
    kind:old.kind,entry:old.entry,bundle:old.bundle,command:old.command,tool:`esbuild@${esbuildVersion}`,
    independentRebuilds:2,cleanExtractionBuilds:0,byteReproducibleInCurrentWorkspace:true,
    dependencyGraphInputs:paths.length,
    repositoryGraphInputs:paths.filter(path=>!path.includes('/node_modules/')).length,
    lockedDependencyGraphInputs:paths.filter(path=>path.includes('/node_modules/')).length,
    dependencyGraphSha256:sha256(paths.map(path=>`${path}\0${sha256(read(path))}\n`).join('')),
    bundleBytes:bundle.length,bundleSha256:sha256(bundle),
  };
};
const sourceCommit=opaque.sourceCommit;
const walletCommit='3a49d5f1c7609b3f7fa3b561c121dc22fae44caf';
assert.equal(git('rev-parse',`${sourceCommit}:packages/wallet-auth`),git('rev-parse',`${walletCommit}:packages/wallet-auth`),'Wallet/Auth graph is not PR199-exact');
const candidate={
  schemaVersion:'ynx.finance.evm-read-runtime-verifier-candidate.v1',
  status:'INDEPENDENT_REVIEW_REQUIRED_NOT_PINNED_NOT_PUBLIC',
  reviewedOwnerSource:{commit:sourceCommit,tree:opaque.sourceTree},
  sharedWalletAuthSource:{commit:walletCommit,tree:git('rev-parse',`${walletCommit}:packages/wallet-auth`),packageRoot:'packages/wallet-auth/src/index.js',packageLock:'packages/wallet-auth/package-lock.json'},
  existingVerifierPin:{path:'apps/finance/web/verify-wallet-connect.mjs',reviewedManifestSha256:'fe22be4766486090a1e99b120fe445e4174db1ba98938ca528a6e4d542c0c599',pinChanged:false},
  sourceBundleRelations:[
    await relation(prior.sourceBundleRelations[0],{bundle:true,minify:true,platform:'browser',target:'es2022'}),
    await relation(prior.sourceBundleRelations[1],{bundle:true,platform:'node',target:'node22',format:'esm'}),
  ],
  exactInputs,
  releaseClosure:prior.releaseClosure,
  truth:{independentManifestReview:false,hardcodedVerifierPinUpdated:false,cleanExtractionVerified:false,deployedPublic:false,realWalletApproval:false,realWalletRejection:false,installedRuntime:false,privateFinanceAuthorized:false,orderOrTransactionAuthorized:false},
};
const bytes=Buffer.from(`${JSON.stringify(candidate,null,2)}\n`);
writeFileSync(resolve(root,destination),bytes,{flag:'wx',mode:0o644});
console.log(JSON.stringify({path:destination,sourceCommit,bytes:bytes.length,sha256:sha256(bytes)}));
