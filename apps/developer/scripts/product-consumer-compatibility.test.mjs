import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,copyFile,readFile,rm,realpath,symlink} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {assertCurrentNativeConsumerMapping} from './product-consumer-compatibility.mjs';
import {verifyPackagedSDKResolution} from './verify-packaged-sdk-resolution.mjs';
test('native identity requires exact main and bridge bytes with unique provenance labels',()=>{
 const rows=['main.m','ynx-wallet-admission-parent.m'].map((n,i)=>({relativePath:'apps/developer/desktop/macos/'+n,role:'current own native source/header',bytes:i+1,sha256:String(i).repeat(64)}));
 assert.equal(assertCurrentNativeConsumerMapping(rows,rows).length,2);
 assert.throws(()=>assertCurrentNativeConsumerMapping(rows,rows.map((r,i)=>i? r:{...r,sha256:'f'.repeat(64)})));
 assert.throws(()=>assertCurrentNativeConsumerMapping(rows,[...rows,rows[0]]));assert.throws(()=>assertCurrentNativeConsumerMapping(rows,rows.slice(1)));
});
async function fixture(t,{split=false,missing=false,divergent=false,packaged=false}={}){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'ynx-sdk-graph-')));t.after(()=>rm(temp,{recursive:true,force:true}));const root=packaged?join(temp,'Contents/Resources/code/apps/developer'):temp;await mkdir(root,{recursive:true});
 const sdk=join(root,'vendor/identity-admission'),old=join(root,'node_modules/@ynx-chain/wallet-auth');await mkdir(join(sdk,'src'),{recursive:true});await mkdir(join(root,'services/codeoss-service/src'),{recursive:true});await mkdir(join(root,'desktop'),{recursive:true});await mkdir(join(sdk,'scripts'),{recursive:true});await copyFile(new URL('../desktop/identity-sdk-loader.mjs',import.meta.url),join(root,'desktop/identity-sdk-loader.mjs'));await mkdir(join(root,'node_modules/@ynx-chain'),{recursive:true});
 const names=['original-ide-held-session-read','original-ide-admission','original-ide-deployment-v2','original-ide-contract-relay-guard','walletconnect-dapp-connection','pq-contract-deployment-material','pq-native-action'],exports={};
 for(const [i,name] of names.entries()){exports['./'+name]=['walletconnect-dapp-connection','pq-contract-deployment-material','pq-native-action'].includes(name)?{types:'./src/'+name+'.d.ts',import:'./src/'+name+'.js',default:'./src/'+name+'.js'}:{types:'./src/'+name+'.d.ts',browser:null,node:'./src/'+name+'.js',default:null};await writeFile(join(sdk,'src',name+'.js'),'throw Error("SDK MUST NOT EXECUTE DURING ARTIFACT CHECK");');}
 for(const name of ['original-held-session-read','original-project-reader','original-deployment-v2-signer'])await writeFile(join(root,'services/codeoss-service/src',name+'.mjs'),'export {};');
 if(missing)delete exports['./original-ide-held-session-read'];if(divergent)exports['./original-ide-held-session-read'].import='./src/other.js';
 const pkg={name:'@ynx-chain/wallet-auth',type:'module',exports};await writeFile(join(sdk,'package.json'),JSON.stringify(pkg));
 if(split){await mkdir(join(old,'src'),{recursive:true});await writeFile(join(old,'package.json'),JSON.stringify(pkg));for(const name of names)await writeFile(join(old,'src',name+'.js'),'throw Error("OLD SDK MUST NOT EXECUTE");');}
 for(const rel of ['scripts/ynx-ide-service-admission-supplier.mjs','src/original-ide-service-admission-startup.js'])await writeFile(join(sdk,rel),'throw Error("SDK MUST NOT EXECUTE DURING ARTIFACT CHECK");');
 const files=[];for(const rel of ['package.json',...names.map(n=>'src/'+n+'.js'),'scripts/ynx-ide-service-admission-supplier.mjs','src/original-ide-service-admission-startup.js']){const bytes=await readFile(join(sdk,rel));files.push({path:rel,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 await writeFile(join(root,'identity-sdk-pins.json'),JSON.stringify({schema:'YNX_IDE_SDK_CODE_PINS/v1',files}));return root;
}
test('one physical SDK graph resolves Node exports without executing any SDK code',async t=>{const r=await verifyPackagedSDKResolution(await fixture(t));assert.equal(r.records.length,9);assert.equal(r.modulesExecuted,false);assert.equal(r.NativeAdmission,false);});
test('stale caller node_modules never redirects the anchored public Node exports',async t=>{const root=await fixture(t,{split:true}),r=await verifyPackagedSDKResolution(root);assert.ok(r.records.every(row=>row.url.startsWith(pathToFileURL(join(root,'vendor/identity-admission')).href+'/')));});
test('missing R2 or divergent import graph refuses without falling back',async t=>{for(const options of [{missing:true},{divergent:true}])await assert.rejects(verifyPackagedSDKResolution(await fixture(t,options)),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});});

test('changed supplier code refuses before even the fixed startup module executes',async t=>{const root=await fixture(t);await writeFile(join(root,'vendor/identity-admission/src/original-ide-admission.js'),'throw Error("MUST NOT EXECUTE ALTERED SOURCE");');const {loadBundledIdentitySDK}=await import(pathToFileURL(join(root,'desktop/identity-sdk-loader.mjs')).href);await assert.rejects(loadBundledIdentitySDK('scripts/ynx-ide-service-admission-supplier.mjs'),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});});
async function repin(root,rel,body){
 await writeFile(join(root,'vendor/identity-admission',rel),body);
 const path=join(root,'identity-sdk-pins.json'),manifest=JSON.parse(await readFile(path));
 const row=manifest.files.find(r=>r.path===rel);row.bytes=Buffer.byteLength(body);row.sha256=createHash('sha256').update(body).digest('hex');await writeFile(path,JSON.stringify(manifest));
}
test('actual default held reader selects the fixed SDK, never stale caller node_modules',async t=>{
 const root=await fixture(t,{split:true});
 await repin(root,'src/original-ide-held-session-read.js','throw Object.assign(Error("PUBLIC_EXPECTED_FIXED_SDK"),{code:"PUBLIC_EXPECTED_FIXED_SDK"});');
 await copyFile(new URL('../services/codeoss-service/src/original-held-session-read.mjs',import.meta.url),join(root,'services/codeoss-service/src/original-held-session-read.mjs'));
 const {createOriginalIDEHeldRead}=await import(pathToFileURL(join(root,'services/codeoss-service/src/original-held-session-read.mjs')).href);
 const held=createOriginalIDEHeldRead();assert.equal(held.status().acquisitionEntered,false);
 await assert.rejects(held.assertCurrent(),{code:'PUBLIC_EXPECTED_FIXED_SDK'});await held.close();
 assert.equal(held.status().ownerRetained,false);
});
test('startup import stays lazy; damaged package refuses before supplier evaluation',async t=>{
 const root=await fixture(t);for(const file of ['wallet-admission-startup.mjs','wallet-admission-delivery.mjs'])await copyFile(new URL('../desktop/'+file,import.meta.url),join(root,'desktop',file));
 await writeFile(join(root,'vendor/identity-admission/scripts/ynx-ide-service-admission-supplier.mjs'),'throw Error("SUPPLIER_EXECUTED_BEFORE_PINS");');
 const {openBundledWalletAdmission}=await import(pathToFileURL(join(root,'desktop/wallet-admission-startup.mjs')).href);
 const facade=await openBundledWalletAdmission('PUBLIC_NO_AUTHORITY');assert.throws(()=>facade.assertCurrent(),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
 facade.close();assert.deepEqual(await facade.finishCleanup(),{complete:true});
});
test('a graph changed after a successful inspection is rechecked before import',async t=>{
 const root=await fixture(t);await verifyPackagedSDKResolution(root);
 await writeFile(join(root,'vendor/identity-admission/src/original-ide-admission.js'),'throw Error("ALTERED_AFTER_CHECK");');
 const {loadBundledIdentitySDK}=await import(pathToFileURL(join(root,'desktop/identity-sdk-loader.mjs')).href);
 await assert.rejects(loadBundledIdentitySDK('original-ide-admission'),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
});

async function projectionControl(root,{unbound=false,altered=false}={}){
 const rel='scripts/ide-runtime-source-projection.mjs',body='globalThis.__ynxProjectionPublicControl=(globalThis.__ynxProjectionPublicControl||0)+1;export function verifyIDERuntimeSourceProjection(){return {sourceVariant:"SDK49-IDE-R2-SOURCE-ARCHIVE-RUNTIME/v1",archivedSources:4,archiveVerified:true,extracts:false,executes:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};}';
 await writeFile(join(root,'vendor/identity-admission',rel),body);
 const path=join(root,'identity-sdk-pins.json'),code=JSON.parse(await readFile(path));code.files.push({path:rel,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')});await writeFile(path,JSON.stringify(code));
 const row=(path,bytes)=>({path,bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')}),projection='PUBLIC closed projection',inventory='PUBLIC runtime inventory';
 const binding={schema:'YNX_IDE_SDK_PROJECTION_BINDING/v1',sourceVariant:'SDK49-IDE-R2-SOURCE-ARCHIVE-RUNTIME/v1',projection:row('identity-sdk-source-projection.json',projection),runtimeInventory:row('identity-sdk-projected-runtime-inventory.json',inventory)};
 await writeFile(join(root,binding.projection.path),altered?'self-reported changed projection':projection);await writeFile(join(root,binding.runtimeInventory.path),inventory);
 const raw=JSON.stringify(binding);await writeFile(join(root,'identity-sdk-projection-binding.json'),raw);
 await writeFile(join(root,'../../../build-provenance.json'),JSON.stringify({packagedSDKSourceProjection:{path:'Contents/Resources/code/apps/developer/identity-sdk-projection-binding.json',bytes:Buffer.byteLength(raw),sha256:unbound?'0'.repeat(64):createHash('sha256').update(raw).digest('hex')}}));
}
test('projected SDK requires independent package binding before the pinned IO verifier executes',async t=>{
 for(const options of [{unbound:true},{altered:true}]){const root=await fixture(t,{packaged:true});await projectionControl(root,options);delete globalThis.__ynxProjectionPublicControl;await assert.rejects(verifyPackagedSDKResolution(root),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});assert.equal(globalThis.__ynxProjectionPublicControl,undefined);}
});
test('code pins and separate projection binding compose before any SDK public export executes',async t=>{
 const root=await fixture(t,{packaged:true});await projectionControl(root);delete globalThis.__ynxProjectionPublicControl;const result=await verifyPackagedSDKResolution(root);assert.equal(result.records.length,9);assert.equal(result.modulesExecuted,true);assert.equal(result.SDKProtectedModulesExecuted,false);assert.equal(result.artifactVerificationIO,true);assert.equal(globalThis.__ynxProjectionPublicControl,1);delete globalThis.__ynxProjectionPublicControl;
});
test('Root63 refuses a self-consistent replacement binding before its verifier executes',async t=>{
 for(const variant of ['SDK49-IDE-ROOT63-SOURCE-ARCHIVE-RUNTIME/v1','SDK49-IDE-ROOT63-CURRENT-PRODUCTION-SOURCE-ARCHIVE-RUNTIME/v1','SDK49-IDE-C6-SCOPE-PHASE-SOURCE-ARCHIVE-RUNTIME/v1','SDK49-IDE-CONTROL-MATCHED-WHOLE-SOURCE-ARCHIVE-RUNTIME/v1']){
 const root=await fixture(t,{packaged:true});await projectionControl(root);
 const bindingPath=join(root,'identity-sdk-projection-binding.json'),binding=JSON.parse(await readFile(bindingPath));
 binding.sourceVariant=variant;const raw=JSON.stringify(binding);await writeFile(bindingPath,raw);
 await writeFile(join(root,'../../../build-provenance.json'),JSON.stringify({packagedSDKSourceProjection:{path:'Contents/Resources/code/apps/developer/identity-sdk-projection-binding.json',bytes:Buffer.byteLength(raw),sha256:createHash('sha256').update(raw).digest('hex')}}));
 delete globalThis.__ynxProjectionPublicControl;
 await assert.rejects(verifyPackagedSDKResolution(root),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
 assert.equal(globalThis.__ynxProjectionPublicControl,undefined);
 }
});
test('a declared projection cannot downgrade by deleting its verifier and code-pin row',async t=>{
 for(const removeBinding of [false,true]){
  const root=await fixture(t,{packaged:true});await projectionControl(root);
  const pinsPath=join(root,'identity-sdk-pins.json'),pins=JSON.parse(await readFile(pinsPath));
  pins.files=pins.files.filter(r=>r.path!=='scripts/ide-runtime-source-projection.mjs');await writeFile(pinsPath,JSON.stringify(pins));
  await rm(join(root,'vendor/identity-admission/scripts/ide-runtime-source-projection.mjs'));
  if(removeBinding)await rm(join(root,'identity-sdk-projection-binding.json'));
  await assert.rejects(verifyPackagedSDKResolution(root),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
 }
});

test('contract connection/DATA exports use only their exact finite schema without SDK evaluation',async t=>{
 const root=await fixture(t),report=await verifyPackagedSDKResolution(root);
 for(const name of ['walletconnect-dapp-connection','pq-contract-deployment-material','pq-native-action']){
  const record=report.records.find(row=>row.name===name);
  assert.equal(record.url,pathToFileURL(join(root,'vendor/identity-admission/src/'+name+'.js')).href);
 }
 assert.equal(report.modulesExecuted,false);assert.equal(report.SourceAdmission,false);
});
test('finite contract export resolver rejects extra conditions, mismatched entry/types and path escapes',async t=>{
 for(const name of ['walletconnect-dapp-connection','pq-contract-deployment-material','pq-native-action'])for(const change of [
  value=>({...value,node:value.import}),value=>({...value,browser:null}),value=>({...value,import:[value.import]}),
  value=>({...value,default:'./src/original-ide-admission.js'}),value=>({...value,types:'./src/other.d.ts'}),
  value=>({...value,import:'/tmp/escape.js',default:'/tmp/escape.js'}),value=>({...value,import:'./src/../escape.js',default:'./src/../escape.js'}),
 ]){
  const root=await fixture(t),pkg=JSON.parse(await readFile(join(root,'vendor/identity-admission/package.json')));
  pkg.exports['./'+name]=change(pkg.exports['./'+name]);await repin(root,'package.json',JSON.stringify(pkg));
  await assert.rejects(verifyPackagedSDKResolution(root),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
 }
});
test('identity and relay guard retain Node-only schema; arbitrary names never become public',async t=>{
 const root=await fixture(t),pkg=JSON.parse(await readFile(join(root,'vendor/identity-admission/package.json')));
 pkg.exports['./original-ide-contract-relay-guard']={types:'./src/original-ide-contract-relay-guard.d.ts',import:'./src/original-ide-contract-relay-guard.js',default:'./src/original-ide-contract-relay-guard.js'};
 await repin(root,'package.json',JSON.stringify(pkg));await assert.rejects(verifyPackagedSDKResolution(root),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
 const fresh=await fixture(t),loader=await import(pathToFileURL(join(fresh,'desktop/identity-sdk-loader.mjs')).href);
 await assert.rejects(loader.loadBundledIdentitySDK('other-connection'),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
});

test('finite contract entries cannot resolve through symlinks or missing pins',async t=>{
 for(const name of ['walletconnect-dapp-connection','pq-contract-deployment-material','pq-native-action']){
  const root=await fixture(t),entry=join(root,'vendor/identity-admission/src/'+name+'.js');
  await rm(entry);await symlink('original-ide-admission.js',entry);
  await assert.rejects(verifyPackagedSDKResolution(root),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
  const other=await fixture(t),pinsPath=join(other,'identity-sdk-pins.json'),pins=JSON.parse(await readFile(pinsPath));
  pins.files=pins.files.filter(row=>row.path!=='src/'+name+'.js');await writeFile(pinsPath,JSON.stringify(pins));
  await assert.rejects(verifyPackagedSDKResolution(other),{code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
 }
});

for(const partial of [false,true])test('original bundled contract guard and connection retain one pinned graph and cleanup owner: '+partial,async t=>{
 const root=await fixture(t,{split:true});await copyFile(new URL('../desktop/bundled-contract-runtime.mjs',import.meta.url),join(root,'desktop/bundled-contract-runtime.mjs'));
 await repin(root,'src/original-ide-contract-relay-guard.js',`export const calls=[],cause=Error('PUBLIC original cause'),owner={close(){calls.push('close');}};export async function acquireOriginalIDEContractRelayGuard(input){calls.push(input);${partial?"throw Object.assign(cause,{cleanupOwner:owner});":"return owner;"}}export function assertOriginalIDEContractRelayGuardCurrent(value){if(value!==owner)throw Error('PUBLIC wrong graph');return {projectId:'PUBLIC-signed',projectGeneration:9};}`);
 await repin(root,'src/walletconnect-dapp-connection.js',`import{owner,calls}from './original-ide-contract-relay-guard.js';export function createDeveloperContractConnection(input){if(input.relayGuard!==owner||input.relayContext.projectId!=='PUBLIC-signed')throw Error('PUBLIC graph mismatch');calls.push('connect');return{PUBLIC:'connection'};}`);
 const runtime=await import(pathToFileURL(join(root,'desktop/bundled-contract-runtime.mjs')).href),guard=await import(pathToFileURL(join(root,'vendor/identity-admission/src/original-ide-contract-relay-guard.js')).href);
 assert.deepEqual(guard.calls,[]);const context={workspace:'/PUBLIC/project',profile:'/PUBLIC/profile',id:'PUBLIC-local'};
 const owner=await runtime.openBundledContractRelayAuthority({serverModuleURL:'file:///PUBLIC/server.mjs',localContext:context});
 assert.deepEqual(guard.calls,[{serverModuleURL:'file:///PUBLIC/server.mjs',localContext:context}]);
 if(partial){assert.throws(()=>owner.assertCurrent(),e=>e===guard.cause);assert.throws(()=>owner.createConnection(),e=>e===guard.cause);}
 else {assert.equal(owner.assertCurrent().projectGeneration,9);assert.deepEqual(owner.createConnection(),{PUBLIC:'connection'});}
 await owner.close();await owner.close();assert.equal(guard.calls.filter(x=>x==='close').length,1);assert.throws(()=>owner.assertCurrent(),{code:'IDE_CONTRACT_RETIRED'});
});
