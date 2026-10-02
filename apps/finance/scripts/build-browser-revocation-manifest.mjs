#!/usr/bin/env node
// Reproducible source closure only. This cannot authorize deployment or a Wallet.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const web=resolve(dirname(fileURLToPath(import.meta.url)),'../web'),root=resolve(web,'../../..');
const source='5e840877d3c7b6e648da70d214b9811cd9d8f688',predecessorPin='e09ed6fd0f5114f7423d90aca317a374b596c5f03d5ddd969fbbb48a9a8fc19d';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),read=p=>readFileSync(resolve(root,p));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const frozen=execFileSync('git',['show',`${source}:apps/finance/web/wallet-verifier-manifest.json`],{cwd:root});assert.equal(sha(frozen),predecessorPin);
const existingManifestPin=sha(read('apps/finance/web/wallet-verifier-manifest.json'));
const prior=JSON.parse(frozen),candidatePath='../evidence/evm-read-runtime-verifier-candidate-browser-revocation-f0b1ab4e5-20261002.json',candidateFull=relative(root,resolve(web,candidatePath));
const candidate=JSON.parse(execFileSync('git',['show',`${source}:${relative(root,resolve(web,prior.evmRead.candidatePath))}`],{cwd:root}));
const {build,version}=createRequire(resolve(web,'package.json'))('esbuild');assert.equal(version,'0.25.9');
const write=(p,bytes)=>writeFileSync(resolve(root,p),bytes),json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
async function twice(options){const [a,b]=await Promise.all([build({...options,preserveSymlinks:true,alias:{"@ynx-chain/sdk":resolve(root,"sdk/js/index.js"),"@ynx-chain/wallet-auth/central-browser-session-contract":resolve(root,"packages/wallet-auth/src/central-browser-session-contract.js"),"@ynx-chain/wallet-auth":resolve(root,"packages/wallet-auth/src/index.js")},write:false,metafile:true}),build({...options,preserveSymlinks:true,alias:{"@ynx-chain/sdk":resolve(root,"sdk/js/index.js"),"@ynx-chain/wallet-auth/central-browser-session-contract":resolve(root,"packages/wallet-auth/src/central-browser-session-contract.js"),"@ynx-chain/wallet-auth":resolve(root,"packages/wallet-auth/src/index.js")},write:false,metafile:true})]);assert.equal(a.outputFiles.length,1);assert.deepEqual(Buffer.from(a.outputFiles[0].contents),Buffer.from(b.outputFiles[0].contents));assert.deepEqual(Object.keys(a.metafile.inputs).sort(),Object.keys(b.metafile.inputs).sort());return a}
const graphHash=paths=>sha(paths.map(p=>`${p}\0${sha(read(p))}\n`).join(''));
// These two EVM authorities MUST remain entry + Wallet/Auth + Noble only.
for(const [i,options] of [{bundle:true,minify:true,platform:'browser',target:'es2022'},{bundle:true,platform:'node',target:'node22',format:'esm'}].entries()){
 const old=candidate.sourceBundleRelations[i],built=await twice({absWorkingDir:root,entryPoints:[old.entry],...options}),paths=Object.keys(built.metafile.inputs).sort();
 for(const p of paths)assert.ok(p===old.entry||p==='packages/wallet-auth/product-session-registry.json'||p.startsWith('packages/wallet-auth/src/')||p.startsWith('packages/wallet-auth/node_modules/@noble/'),`EVM Noble-only graph rejected ${p}`);
 const bytes=Buffer.from(built.outputFiles[0].contents);write(old.bundle,bytes);
 candidate.sourceBundleRelations[i]={...old,dependencyGraphInputs:paths.length,repositoryGraphInputs:paths.filter(p=>!p.includes('/node_modules/')).length,lockedDependencyGraphInputs:paths.filter(p=>p.includes('/node_modules/')).length,dependencyGraphSha256:graphHash(paths),bundleBytes:bytes.length,bundleSha256:sha(bytes)};
}
const central=candidate.centralPairBundle,base=resolve(root,'packages/wallet-auth');
const centralBuild=await twice({absWorkingDir:base,entryPoints:['src/central-browser-session-browser.js'],bundle:true,platform:'browser',format:'iife',legalComments:'none'});
const centralPaths=Object.keys(centralBuild.metafile.inputs).map(p=>relative(root,resolve(base,p)).replaceAll('\\','/')).sort();
// Preserve the complete predecessor graph; a new dependency requires review.
assert.deepEqual(centralPaths,[...central.dependencyGraphPaths].sort(),'central reviewed finite contract dependency path set changed');
const centralBytes=Buffer.from(centralBuild.outputFiles[0].contents);write(central.bundle,centralBytes);
candidate.centralPairBundle={...central,dependencyGraphPaths:centralPaths,dependencyGraphInputs:centralPaths.length,bytes:centralBytes.length,sha256:sha(centralBytes),dependencyGraphSha256:graphHash(centralPaths)};
const wallet=await twice({absWorkingDir:web,entryPoints:['wallet-auth-entry.js'],bundle:true,minify:true,platform:'browser',target:'es2022'}),walletBytes=Buffer.from(wallet.outputFiles[0].contents);
write('apps/finance/web/wallet-auth.js',walletBytes);
const closurePath='apps/finance/web/wallet-build-closure.json',closure=JSON.parse(execFileSync('git',['show',`${source}:${closurePath}`],{cwd:root})),walletPaths=Object.keys(wallet.metafile.inputs).sort();
const expectedWalletPaths=closure.inputs.map(p=>p==='vendor/product-session-browser-e1471c491.mjs'?'vendor/product-session-browser-f0b1ab4e5.mjs':p).sort();
assert.deepEqual(walletPaths,expectedWalletPaths,'Finance reviewed private finite dependency path set changed');write(closurePath,json({...closure,inputs:walletPaths}));
let html=read('apps/finance/web/index.html').toString();
for(const name of ['manifest.webmanifest','ynx-logo.png','styles.css','finance-locale.js','wallet-auth.js','order-wallet.js','order-opaque.js','evm-read-session.js','evm-subject.js','app.js','read-sources.js','product-catalog.js']){
 const pattern=new RegExp(`(/${name.replaceAll('.','\\.')}\\?v=)[0-9a-f]{64}`,'g');html=html.replace(pattern,(_match,prefix)=>prefix+sha(read('apps/finance/web/'+name)));
}
write('apps/finance/web/index.html',html);
candidate.reviewedOwnerSource={commit:source,tree:git('rev-parse',`${source}^{tree}`)};
candidate.sharedWalletAuthSource={...candidate.sharedWalletAuthSource,commit:source,tree:git('rev-parse',`${source}:packages/wallet-auth`)};
const generatedInputs=new Set(['apps/finance/web/index.html','apps/finance/web/evm-read-session.js','apps/finance/scripts/evm-read-session-authority.bundle.mjs','packages/wallet-auth/src/central-browser-session-browser.bundle.js']);
const finitePaths=[...["packages/wallet-auth/src/product-session-finite-consent.js","packages/wallet-auth/src/product-session-v2.js","packages/wallet-auth/src/product-session-recovery.js","packages/wallet-auth/src/product-session-browser.js","internal/productsessionv2/client.go","apps/finance/web/private-wallet-entry.js","apps/finance/web/private-finite-consent-copy.js","apps/finance/web/vendor/product-session-browser-e1471c491.entry.mjs","apps/finance/web/vendor/product-session-browser-e1471c491.mjs","apps/finance/web/vendor/product-session-browser-e1471c491.manifest.json","apps/finance/scripts/build-private-finite-browser-vendor.mjs"],'apps/finance/web/vendor/product-session-browser-f0b1ab4e5.entry.mjs','apps/finance/web/vendor/product-session-browser-f0b1ab4e5.mjs','apps/finance/web/vendor/product-session-browser-f0b1ab4e5.manifest.json','internal/centralbrowserfamily/contract.go','internal/centralbrowserfamily/client.go','internal/centralbrowserfamily/store.go','packages/wallet-auth/src/central-browser-backend-auth.js','internal/finance/browser_sso_binding.go']; for(const path of finitePaths)if(!candidate.exactInputs.some(i=>i.path===path))candidate.exactInputs.push({path});
candidate.exactInputs=candidate.exactInputs.map(item=>{const bytes=read(item.path);if(!generatedInputs.has(item.path)){const baseline=execFileSync('git',['show',`${source}:${item.path}`],{cwd:root});assert.deepEqual(bytes,baseline,`source changed beyond frozen generation baseline: ${item.path}`)}return{path:item.path,bytes:bytes.length,sha256:sha(bytes)}});
const candidateBytes=json(candidate);write(candidateFull,candidateBytes);
const allowed=new Set(['verify-versioned-assets.mjs','verify-evm-read-candidate.mjs','wallet-auth-entry.js','endpoint-authority-entry.js','../../../sdk/js/index.js','../../../sdk/js/endpoint-authority-v2.js','private-wallet-entry.js','wallet-auth.js','app.js','finance-locale.js','index.html','evm-read-session.js','wallet-build-closure.json',candidatePath,'../../../packages/wallet-auth/src/walletconnect-dapp-connection.js','../../../packages/wallet-auth/src/central-browser-session-registry.js','../../../packages/wallet-auth/src/central-browser-session-contract.js','../../../packages/wallet-auth/src/central-browser-session-browser.bundle.js','../../wallet-web/package.json','../../wallet-web/src/hosted-protocol.js','../../../packages/wallet-auth/src/product-session-v2.js']);
for(const p of ['../../../packages/wallet-auth/src/product-session-browser.js','../../../packages/wallet-auth/src/product-session-recovery.js','../../../apps/finance/scripts/build-private-finite-browser-vendor.mjs'])allowed.add(p);
const changed=[];
const appendedPaths=["../../../packages/wallet-auth/src/product-session-finite-consent.js","../../../packages/wallet-auth/src/product-session-v2.js","../../../packages/wallet-auth/src/product-session-recovery.js","../../../packages/wallet-auth/src/product-session-browser.js","../../../internal/productsessionv2/client.go","private-wallet-entry.js","private-finite-consent-copy.js","vendor/product-session-browser-e1471c491.entry.mjs","vendor/product-session-browser-e1471c491.mjs","vendor/product-session-browser-e1471c491.manifest.json","../../../apps/finance/scripts/build-private-finite-browser-vendor.mjs","vendor/product-session-browser-f0b1ab4e5.entry.mjs","vendor/product-session-browser-f0b1ab4e5.mjs","vendor/product-session-browser-f0b1ab4e5.manifest.json"].filter(p=>!prior.files.some(x=>x.path===p));
const orderedFiles=[...prior.files,...appendedPaths.map(path=>({path,bytes:0,sha256:''}))];for(const p of appendedPaths)allowed.add(p);
const files=orderedFiles.map(original=>{const item={...original,path:original.path===prior.evmRead.candidatePath?candidatePath:original.path};const bytes=readFileSync(resolve(web,item.path));if(bytes.length!==item.bytes||sha(bytes)!==item.sha256){assert.ok(allowed.has(item.path),`unreviewed predecessor file change: ${item.path}`);changed.push(item.path)}return{path:item.path,bytes:bytes.length,sha256:sha(bytes)}});
assert.ok(files.some(item=>item.path==='ynx-favicon.png'),'reviewed favicon must remain in predecessor');
assert.equal(files.length,prior.files.length+appendedPaths.length);assert.deepEqual(files.map(x=>x.path),orderedFiles.map(x=>x.path===prior.evmRead.candidatePath?candidatePath:x.path));
const manifest={...prior,evmRead:{candidatePath,candidateBytes:candidateBytes.length,candidateSha256:sha(candidateBytes)},sourceBundleRelation:{...prior.sourceBundleRelation,bytes:walletBytes.length,sha256:sha(walletBytes)},files},manifestBytes=json(manifest);
write('apps/finance/web/wallet-verifier-manifest.json',manifestBytes);
const verifierPath='apps/finance/web/verify-wallet-connect.mjs';let verifier=read(verifierPath).toString();assert.ok(verifier.includes(`const REVIEWED_VERIFIER_MANIFEST_SHA256='${existingManifestPin}'`)||verifier.includes(`const REVIEWED_VERIFIER_MANIFEST_SHA256='${predecessorPin}'`)||verifier.includes("const REVIEWED_VERIFIER_MANIFEST_SHA256='fcb1f8683ea2a42eb0257bb84df49ba9dc7b9572b016a2c430dfaaef020eb79a'")||verifier.includes(`const REVIEWED_VERIFIER_MANIFEST_SHA256='${sha(manifestBytes)}'`));
verifier=verifier.replaceAll(prior.evmRead.candidatePath,candidatePath);
verifier=verifier.replace(/const REVIEWED_FILES=\[[^\n]+\];/,`const REVIEWED_FILES=${JSON.stringify(files.map(x=>x.path))};`);
verifier=verifier.replace(/const REVIEWED_VERIFIER_MANIFEST_SHA256='[0-9a-f]{64}'/,`const REVIEWED_VERIFIER_MANIFEST_SHA256='${sha(manifestBytes)}'`);
verifier=verifier.replace(`binding.sourceBundleRelation?.bytes!==${prior.sourceBundleRelation.bytes}`,`binding.sourceBundleRelation?.bytes!==${walletBytes.length}`).replace(`binding.sourceBundleRelation?.sha256!=='${prior.sourceBundleRelation.sha256}'`,`binding.sourceBundleRelation?.sha256!=='${sha(walletBytes)}'`);write(verifierPath,verifier);
console.log(JSON.stringify({source,predecessorPin,manifestSha256:sha(manifestBytes),candidateSha256:sha(candidateBytes),files:files.length,walletInputs:walletPaths.length,centralInputs:centralPaths.length,walletBytes:walletBytes.length,walletSha256:sha(walletBytes),changed,publicRuntimeVerified:false}));
