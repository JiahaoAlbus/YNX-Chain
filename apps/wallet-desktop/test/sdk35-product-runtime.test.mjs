import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {SDK35_PRODUCT_PINS,readSDK35ProductRuntime,assertSDK35ProductArchive} from '../scripts/sdk35-product-runtime.mjs';
import {canonicalArchivePlan,SDK_CANONICAL,SDK_ALIAS,CANONICAL_MAIN} from '../scripts/canonical-package.mjs';
import {assertSDKRuntimePackCoverage} from '../scripts/release-provenance.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const row=(name,body)=>({path:name,type:'file',unpacked:false,executable:false,physicalMode:null,bytes:body.length,sha256:digest(body)});
const metadata=Buffer.from(JSON.stringify({main:CANONICAL_MAIN}));
function base(){return[{path:SDK_ALIAS,type:'directory',unpacked:false},{...row('native/original-auth-identity.node',Buffer.from('PUBLIC not executable')),unpacked:true},row('package.json',metadata)];}
test('product projection maps only the closed manifest pair and retains exact data without changing original rows',()=>{
 const names=['original-ide-auth-runtime-manifest.json','original-ide-contract-relay-runtime-manifest.json'],old=Buffer.from('PUBLIC full source table'),next=Buffer.from('PUBLIC product table');
 const before=[...base(),...names.map(name=>row(SDK_ALIAS+'/native/'+name,old))],snapshot=JSON.stringify(before),manifests=names.map(name=>({path:SDK_CANONICAL+'/native/'+name,sourcePath:'runtime-projections/sdk35-product/'+name,bytes:next.length,sha256:digest(next),originalBytes:old.length,originalSHA256:digest(old)})),data=[row(SDK_CANONICAL+'/src/public.d.ts',Buffer.from('PUBLIC declaration')),row(SDK_CANONICAL+'/node_modules/.package-lock.json',Buffer.from('PUBLIC lock'))];
 const result=canonicalArchivePlan(before,metadata,[],manifests,data).after;
 assert.equal(JSON.stringify(before),snapshot);
 for(const pin of [...manifests,...data])assert.equal(result.find(r=>r.path===pin.path).sha256,pin.sha256);
 assert.equal(result.find(r=>r.path===SDK_ALIAS+'/src/public.d.ts').link,SDK_CANONICAL+'/src/public.d.ts');
 assert.throws(()=>canonicalArchivePlan(before,metadata,[],manifests.slice(0,1)),/pair required/);
 assert.throws(()=>canonicalArchivePlan(before,metadata,[],[{...manifests[0],sourcePath:'foreign.json'},manifests[1]]),/mapping differs/);
 assert.throws(()=>canonicalArchivePlan(before,metadata,[],[{...manifests[0],originalSHA256:'0'.repeat(64)},manifests[1]]),/mapping differs/);
});
test('product archive rejects closed build-evidence tests, unknown members and any missing required data',()=>{
 const data=row(SDK_CANONICAL+'/src/public.d.ts',Buffer.from('PUBLIC declaration')),manifest=row(SDK_CANONICAL+'/native/original-ide-auth-runtime-manifest.json',Buffer.from('PUBLIC table')),excluded='native/original-auth-identity-source-authority.test.mjs';
 const product={selected:new Map([['src/public.d.ts',data]]),manifestRows:[manifest],excluded:new Map([[excluded,{}]])};
 assertSDK35ProductArchive(product,[data,manifest]);
 assert.throws(()=>assertSDK35ProductArchive(product,[manifest]),{code:'SDK35_PRODUCT_PACK_ROW_MISSING_OR_CHANGED'});
 assert.throws(()=>assertSDK35ProductArchive(product,[data,manifest,row(SDK_CANONICAL+'/'+excluded,Buffer.from('PUBLIC evidence'))]),{code:'SDK35_PRODUCT_EXCLUDED_PACK_MEMBER'});
 assert.throws(()=>assertSDK35ProductArchive(product,[data,manifest,row(SDK_CANONICAL+'/native/foreign.mjs',Buffer.from('PUBLIC foreign'))]),{code:'SDK35_PRODUCT_UNLISTED_PACK_MEMBER'});
});
test('normal ASAR stream writer emits projected manifests and missing pack data, removes excluded evidence and preserves raw input',t=>{
 const require=createRequire(new URL('../package.json',import.meta.url)),asar=require('@electron/asar'),cli=require.resolve('@electron/asar/bin/asar.js');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-product35-asar-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const stage=path.join(root,'raw'),archive=path.join(root,'input.asar'),output=path.join(root,'output.asar'),old=Buffer.from('PUBLIC full table'),next=Buffer.from('PUBLIC product table'),excluded='native/original-auth-identity-source-authority.test.mjs',excludedBody=Buffer.from('PUBLIC source evidence');
 const names=['original-ide-auth-runtime-manifest.json','original-ide-contract-relay-runtime-manifest.json'];
 const put=(name,body)=>{fs.mkdirSync(path.dirname(path.join(stage,name)),{recursive:true});fs.writeFileSync(path.join(stage,name),body);};
 put('package.json',metadata);put('native/original-auth-identity.node','PUBLIC not executable');put(SDK_ALIAS+'/package.json','{"name":"@ynx-chain/wallet-auth"}');
 for(const name of names)put(SDK_ALIAS+'/native/'+name,old);put(SDK_ALIAS+'/'+excluded,excludedBody);
 execFileSync(process.execPath,[cli,'pack',stage,archive,'--unpack','original-auth-identity.node'],{stdio:'pipe'});
 const originalHash=digest(fs.readFileSync(archive)),before=asar.listPackage(archive).map(raw=>{const name=raw.replace(/^\//,''),info=asar.statFile(archive,name,false);return 'files'in info?{path:name,type:'directory',unpacked:!!info.unpacked}:{...row(name,asar.extractFile(archive,name)),unpacked:!!info.unpacked,executable:!!info.executable,physicalMode:info.unpacked?fs.lstatSync(path.join(archive+'.unpacked',name)).mode&0o777:null};});
 const manifestRows=names.map(name=>({path:SDK_CANONICAL+'/native/'+name,sourcePath:'runtime-projections/sdk35-product/'+name,bytes:next.length,sha256:digest(next),originalBytes:old.length,originalSHA256:digest(old)})),extra=new Map([['src/public.d.ts',Buffer.from('PUBLIC declaration')],['node_modules/.package-lock.json',Buffer.from('PUBLIC installed lock')]]),dataRows=[...extra].map(([n,b])=>row(SDK_CANONICAL+'/'+n,b)),excludedRows=[{path:SDK_CANONICAL+'/'+excluded,bytes:excludedBody.length,sha256:digest(excludedBody)}];
 const config={archive,output,before,manifestRows,dataRows,excludedRows,extra:[...extra].map(([n,b])=>[SDK_CANONICAL+'/'+n,b.toString()]),next:next.toString()},writer=new URL('../scripts/release-provenance.mjs',import.meta.url).href,pkg=fileURLToPath(new URL('../package.json',import.meta.url));
 const code=`import{createRequire}from'node:module';import{writeCanonicalArchiveInputs}from${JSON.stringify(writer)};const c=${JSON.stringify(config)},asar=createRequire(${JSON.stringify(pkg)})('@electron/asar'),productRuntime={manifestRows:c.manifestRows,dataRows:c.dataRows,excludedRows:c.excludedRows,contents:new Map(c.manifestRows.map(r=>[r.path,Buffer.from(c.next)])),readAdditional:p=>{const item=c.extra.find(([n])=>n===p);return item?Buffer.from(item[1]):undefined;}};await writeCanonicalArchiveInputs({asar,archive:c.archive,output:c.output,before:c.before,metadataInput:asar.extractFile(c.archive,'package.json'),dependencies:{rows:[],contents:new Map()},evidence:{rows:[],contents:new Map()},productRuntime});`;
 execFileSync(process.execPath,['--input-type=module','-e',code],{stdio:'pipe'});asar.uncache(output);
 for(const pin of manifestRows)assert.deepEqual(asar.extractFile(output,pin.path),next);
 for(const[n,b]of extra)assert.deepEqual(asar.extractFile(output,SDK_CANONICAL+'/'+n),b);
 assert.throws(()=>asar.extractFile(output,SDK_CANONICAL+'/'+excluded),/not found/);assert.equal(digest(fs.readFileSync(archive)),originalHash);
 for(const name of names)assert.deepEqual(asar.extractFile(archive,SDK_ALIAS+'/native/'+name),old);
});
test('fixed actual SDK35 projection preserves full build custody and restores missing declaration and installed lock from exact composed source',{skip:!process.env.WALLET_SDK35_PROJECTION_ROOT},t=>{
 const supply=process.env.WALLET_SDK35_PROJECTION_ROOT,source=path.join(supply,'composed-source-final'),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-product35-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const copy=(from,to)=>{const target=path.join(root,to);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(from,target);};
 const proj='runtime-projections/sdk35-product/';
 for(const name of Object.keys(SDK35_PRODUCT_PINS))copy(path.join(source,proj,name),proj+name);
 const normal=JSON.parse(fs.readFileSync(path.join(supply,'../sdk35-normal-supply/SDK35_CANONICAL_NORMAL_PREFIX_RUNTIME_ROLES_HANDOFF.json')));
 copy(normal.runtime.Auth.manifest.path,'packages/wallet-auth/native/original-ide-auth-runtime-manifest.json');copy(normal.runtime.union.path,'packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json');
 const app=path.join(root,'apps/wallet-desktop');fs.mkdirSync(app,{recursive:true});fs.copyFileSync(new URL('../package.json',import.meta.url),path.join(app,'package.json'));
 fs.writeFileSync(path.join(root,'packages/wallet-auth/package.json'),JSON.stringify({version:'1.3.0-pq.3.32-auth.35'}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'}),commit=()=>{git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','PUBLIC fixed projection metadata');};git('init','-q');commit();
 const product=readSDK35ProductRuntime(root,'HEAD');assert.equal(product.selected.size,9566);assert.equal(product.authRows.size,556);assert.equal(product.unionRows.size,9417);assert.equal(product.excluded.size,15);assert.equal(product.public.Root,false);
 assert(assertSDKRuntimePackCoverage(app,'HEAD').executableSDKRowsChecked>10);
 const missing=['src/ide-artifact-release-result.d.ts','node_modules/.package-lock.json'],addendum=JSON.parse(fs.readFileSync(path.join(supply,'FINITE_REQUIRED_PACK_DATA_ADDENDUM.json')));
 for(const name of missing){const m=addendum.specialExactMappings.find(m=>m.composedSource==='packages/wallet-auth/'+name);assert(m);copy(m.source.path,m.composedSource);}
 const before=[...product.selected.values()].filter(r=>!missing.includes(r.path)).map(r=>({...r,path:SDK_ALIAS+'/'+r.path,type:'file',unpacked:false,executable:false,physicalMode:null}));
 const prepared=product.prepare(before);assert.equal(prepared.dataRows.length,9566);assert.equal(prepared.missing.size,2);
 for(const name of missing){const body=prepared.readAdditional(SDK_CANONICAL+'/'+name);assert.equal(digest(body),product.selected.get(name).sha256);}
 const inventory=[...prepared.dataRows,...product.manifestRows.map(r=>({...r,type:'file'}))];assertSDK35ProductArchive(product,inventory);
 fs.appendFileSync(path.join(root,'packages/wallet-auth',missing[0]),'PUBLIC tamper');assert.throws(()=>prepared.readAdditional(SDK_CANONICAL+'/'+missing[0]),{code:'SDK35_PRODUCT_SOURCE_BYTES_DIFFERS'});
 fs.appendFileSync(path.join(root,proj,'PROJECTION_RECEIPT.json'),' ');commit();assert.throws(()=>readSDK35ProductRuntime(root,'HEAD'),{code:'SDK35_PRODUCT_SOURCE_PIN_DIFFERS'});
});
