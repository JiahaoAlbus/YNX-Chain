// PUBLIC in-memory rows only. Not the official fullprefix or new product identity.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {projectSDK35ProductRuntimeMetadata as project,verifySDK35ProductRuntimeProjectionMetadata as verify} from './sdk35-product-runtime-projection.mjs';
import {analyzeSDK35ProductSourceImports as analyze} from './sdk35-product-source-analysis.mjs';
const policy=JSON.parse(fs.readFileSync(new URL('./fixtures/sdk35-product-runtime-policy.json',import.meta.url),'utf8'));
const clone=x=>structuredClone(x),sha=b=>createHash('sha256').update(b).digest('hex'),row=p=>({path:p,bytes:6,sha256:sha('PUBLIC')}),sort=xs=>xs.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
function model(){
 const app=Array.from({length:316},(_,i)=>row('node_modules/PUBLIC-app/'+String(i).padStart(3,'0')+'.js'));
 const wc=['@walletconnect/core/dist/index.cjs','@walletconnect/core/package.json','@walletconnect/sign-client/dist/index.cjs','@walletconnect/sign-client/package.json','@walletconnect/utils/dist/index.cjs','@walletconnect/utils/package.json'].map(p=>row('node_modules/'+p));
 const deps=sort([...app,...wc,...Array.from({length:9176-322},(_,i)=>row('node_modules/PUBLIC-deps/'+String(i).padStart(5,'0')+'.js'))]);
 const proof=['package.json','native/original-auth-identity-source-verifier.mjs','native/original-ide-auth-proof-dispatch.mjs','native/original-auth-identity-v2-contract.mjs','src/auth-identity-verification.js','src/pq-wallet-policy.js','src/pq-wallet-authorization.js'];
 const relay=['src/original-ide-contract-relay-guard-node.js','src/original-ide-contract-relay-guard-core.js','src/walletconnect-dapp-connection.js','src/walletconnect-contract-initiator-boundary.js','src/walletconnect-contract-initiator-boundary-node.js'];
 const native=Array.from({length:99},(_,i)=>row('native/PUBLIC-Native'+String(i).padStart(3,'0')+'.h'));
 const map=new Map([...policy.excluded,...policy.nativeReaders,...[...proof,...relay,'package-lock.json','src/public.js','scripts/PUBLIC-cli.mjs'].map(row),...native].map(p=>[p.path,p]));
 for(let i=0;map.size<404;i++){const p=row('src/PUBLIC-owned-'+String(i).padStart(3,'0')+'.js');map.set(p.path,p);}const owned=sort([...map.values()]);
 const authOwn=new Map([...policy.excluded.filter(p=>p.path.startsWith('native/')),...proof.map(p=>map.get(p))].map(p=>[p.path,p]));for(const p of owned){if(authOwn.size>=66)break;if(!p.path.startsWith('integration/'))authOwn.set(p.path,p);}
 const unionOwn=new Map([...authOwn.values(),...relay.map(p=>map.get(p))].map(p=>[p.path,p]));for(const p of owned){if(unionOwn.size>=303)break;if(!p.path.startsWith('integration/'))unionOwn.set(p.path,p);}
 const lock={path:'node_modules/.package-lock.json',bytes:54706,sha256:'4bcda46e64a177344da39833571be1c875398fa3b4fc8e6dd12104bfc4e77048'};
 const full=sort([...owned,...deps,lock]),schema='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1';
 return {inventory:{kind:'YNX_SDK35_COMPLETE_NORMAL_PREFIX_FILE_INVENTORY/v1',versionSDK:policy.versionSDK,fileCount:9581,files:full},auth:{version:schema,files:sort([...authOwn.values(),...deps.filter(p=>!app.slice(263).some(a=>a.path===p.path)).slice(0,500)])},union:{version:schema,files:sort([...unionOwn.values(),...deps.filter(p=>!app.slice(263).some(a=>a.path===p.path))])},materialization:{filesCopied:9176,files:deps,app316Files:316,app316Added:53,fullAppDependencyCoverage:true},appManifest:{files:app.map(p=>({...p,path:p.path.slice(13)}))},packageJSON:{version:policy.versionSDK,exports:{'./public':{import:'./src/public.js'}},bin:{PUBLIC:'scripts/PUBLIC-cli.mjs'}},nativeInventory:{version:policy.versionSDK,NativeInputs:native}};
}
test('PUBLIC RED old manifests retain ten excluded files despite a passing finite pack selection; new manifests repair it',()=>{
 const m=model(),before=JSON.stringify(m),p=project(m);assert.equal(p.productFiles,9566);assert.equal(p.productAuthFiles,556);assert.equal(p.productUnionFiles,9417);
 assert.throws(()=>verify({selection:{files:p.files},auth:m.auth,union:m.union}),{code:'SDK35_PRODUCT_MANIFEST_PACK_MISMATCH'});
 assert.equal(verify({selection:{files:p.files},auth:p.Auth,union:p.union}).metadataConsistent,true);
 assert.equal(p.union.files.find(x=>x.path==='node_modules/.package-lock.json').sha256,'4bcda46e64a177344da39833571be1c875398fa3b4fc8e6dd12104bfc4e77048');assert.equal(m.union.files.some(x=>x.path==='node_modules/.package-lock.json'),false);
 assert.equal(JSON.stringify(m),before);for(const k of ['NativeAdmission','SourceAdmission','Root','AppQualified','activation','installed','published'])assert.equal(p[k],false);assert.equal(p.runtimeBytesReadBack,false);assert.equal(p.originalProvenanceVerified,false);
});
test('PUBLIC finite exact policy rejects guessed tests, changed pins and production/native/export removal',()=>{
 for(const delta of [x=>x.exclusions=[...policy.excluded,row('scripts/assert-pq-test-provider.mjs')],x=>{x.exclusions=clone(policy.excluded);x.exclusions[0].bytes++;},x=>{x.nativeInventory.NativeInputs[0]=clone(policy.excluded[0]);},x=>{x.packageJSON.exports['./bad']={import:'./'+policy.excluded[0].path};}]){const m=model();delta(m);assert.throws(()=>project(m),{code: m.exclusions?'SDK35_PRODUCT_EXCLUSION_POLICY':'SDK35_PRODUCT_REQUIRED_REMOVAL'});}
});
test('PUBLIC all9176 dependencies, installed lock and App316 extra53 remain exact; any lost/change rejects',()=>{
 const m=model(),p=project(m);for(const dep of m.materialization.files)assert.deepEqual(p.files.find(x=>x.path===dep.path),dep);assert.equal(p.App316FilesPreserved,316);assert.equal(p.App316Extra53Preserved,true);
 const missing=clone(m);missing.materialization.files.pop();assert.throws(()=>project(missing),{code:'SDK35_PRODUCT_DEPENDENCIES'});
 const changed=clone(m);changed.inventory.files.find(x=>x.path==='node_modules/.package-lock.json').sha256='0'.repeat(64);assert.throws(()=>project(changed),{code:'SDK35_PRODUCT_MEMBER'});
 const app=clone(m);app.appManifest.files[315].sha256='0'.repeat(64);assert.throws(()=>project(app),{code:'SDK35_PRODUCT_MEMBER'});
});
test('PUBLIC proposed runtime schema or missing required product lock fails closed',()=>{
 const p=project(model()),selection={files:p.files};const missing=clone(p.union);missing.files=missing.files.filter(p=>p.path!=='node_modules/.package-lock.json');assert.throws(()=>verify({selection,auth:p.Auth,union:missing}),{code:'SDK35_PRODUCT_COUNT'});
 assert.throws(()=>verify({selection,auth:{...p.Auth,qualified:true},union:p.union}),{code:'SDK35_PRODUCT_RUNTIME_SCHEMA'});
});
for(const [name,source]of [['import',"import '../native/test-pq-catalog-source-contract.mjs';"],['export',"export * from '../native/test-pq-catalog-source-contract.mjs';"],['dynamic literal',"await import('../native/test-pq-catalog-source-contract.mjs');"],['require',"require('../native/test-pq-catalog-source-contract.mjs');"],['fixed URL',"new URL('../native/test-pq-catalog-source-contract.mjs',import.meta.url);"],['query URL',"await import('../native/test-pq-catalog-source-contract.mjs?PUBLIC=1#retained');"],['escaped URL',"import '../native/%74est-pq-catalog-source-contract.mjs';"]])test('PUBLIC actual TypeScript AST rejects production '+name+' edge to excluded file',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'sdk35-AST-PUBLIC-')));try{fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src/main.mjs'),source);const files=[{path:'src/main.mjs',bytes:Buffer.byteLength(source),sha256:sha(source)}];assert.throws(()=>analyze({prefix:root,files,excluded:policy.excluded}),{code:'SDK35_PRODUCT_EXCLUDED_SOURCE_EDGE'});}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('PUBLIC actual TypeScript AST allows retained literal import, reports unresolved computed edges without qualification',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'sdk35-AST-PUBLIC-')));try{fs.mkdirSync(path.join(root,'src'));const source="import './retained.mjs'; const x='computed'; await import(x);";fs.writeFileSync(path.join(root,'src/main.mjs'),source);const r=analyze({prefix:root,files:[{path:'src/main.mjs',bytes:Buffer.byteLength(source),sha256:sha(source)}],excluded:policy.excluded});assert.equal(r.edges[0].target,'src/retained.mjs');assert.equal(r.unresolvedComputedEdges.length,1);assert.equal(r.computedEdgesProven,false);assert.equal(r.SourceAdmission,false);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
