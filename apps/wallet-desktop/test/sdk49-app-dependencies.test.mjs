import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {walletAuthDependencyPlan,verifyPackagedWalletAuthDependencies,assertWalletAuthDependencyDeclarations} from '../scripts/wallet-auth-dependencies.mjs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

const source=fileURLToPath(new URL('../../..',import.meta.url));
const names=['@noble/curves','@noble/hashes','@noble/ciphers','@noble/post-quantum','@ynx/batch-v01-candidate'];
const selection=JSON.parse(fs.readFileSync(path.join(source,'runtime-projections/sdk49-product/SDK49_PRODUCT_PACK_SELECTION.json')));
const pins=selection.files.filter(row=>names.some(name=>row.path.startsWith('node_modules/'+name+'/')));
const manifestName='apps/wallet-desktop/scripts/wallet-auth-sdk49-runtime-dependencies.json';
const supply=fs.readFileSync(path.join(source,manifestName));
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wallet-sdk49-dependencies-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,bytes)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 for(const name of fs.readdirSync(path.join(source,'runtime-projections/sdk49-product')))put('runtime-projections/sdk49-product/'+name,fs.readFileSync(path.join(source,'runtime-projections/sdk49-product',name)));
 for(const name of ['original-ide-auth-runtime-manifest.json','original-ide-contract-relay-runtime-manifest.json'])put('packages/wallet-auth/native/'+name,fs.readFileSync(path.join(source,'packages/wallet-auth/native',name)));
 put('packages/wallet-auth/package.json',fs.readFileSync(path.join(source,'packages/wallet-auth/package.json')));
 put(manifestName,supply);
 git('init','-q');git('add','.');
 const commit=()=>{git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','PUBLIC source-owned SDK49 input');};
 commit();
 for(const row of pins)put('packages/wallet-auth/'+row.path,fs.readFileSync(path.join(source,'packages/wallet-auth',row.path)));
 const plan=()=>walletAuthDependencyPlan(root,'HEAD');
 return{root,put,commit,plan};
}
test('SDK49 normal dependency callee uses all323 exact candidate3 leaves from its committed product closure',t=>{
 const f=fixture(t),plan=f.plan();
 assert.equal(plan.rows.length,323);assert.equal(plan.public.versions['@ynx/batch-v01-candidate'],'0.1.0-candidate.3');
 assert.equal(JSON.parse(plan.contents.get('code/packages/wallet-auth/node_modules/@ynx/batch-v01-candidate/package.json')).version,'0.1.0-candidate.3');
 assert.equal(plan.public.manifest.path,manifestName);
 const projected=new Map(pins.map(row=>[row.path.slice('node_modules/'.length),row]));
 for(const row of plan.public.files){assert.equal(row.bytes,projected.get(row.path)?.bytes);assert.equal(row.sha256,projected.get(row.path)?.sha256);}
 assert.equal(plan.public.files.filter(row=>row.path.startsWith('@ynx/batch-v01-candidate/')).length,16);
 const archive=new Map(plan.contents),asar={extractFile:(_,p)=>archive.get(p),listPackage:()=>[...archive.keys()],statFile:()=>({})};
 const result=verifyPackagedWalletAuthDependencies(asar,'PUBLIC',plan,{dependencies:plan.public.versions});
 assert.equal(result.filesVerified,323);
 archive.set(plan.rows[0].path,Buffer.from('changed'));
 assert.throws(()=>verifyPackagedWalletAuthDependencies(asar,'PUBLIC',plan,{dependencies:plan.public.versions}),/PACKAGED_SDK_DEPENDENCY_DIFFERS/);
});
test('SDK49 refuses missing, changed, symlink and old candidate2 inputs without repairing or ambient fallback',t=>{
 const f=fixture(t),row=pins.find(row=>row.path==='node_modules/@ynx/batch-v01-candidate/package.json'),file=path.join(f.root,'packages/wallet-auth',row.path),original=fs.readFileSync(file);
 fs.unlinkSync(file);assert.throws(f.plan);assert.equal(fs.existsSync(file),false);
 fs.writeFileSync(file,Buffer.from('changed'));assert.throws(f.plan);assert.equal(fs.readFileSync(file,'utf8'),'changed');
 fs.unlinkSync(file);const other=path.join(f.root,'PUBLIC-package.json');fs.writeFileSync(other,original);fs.symlinkSync(other,file);assert.throws(f.plan);fs.unlinkSync(file);
 const old=JSON.parse(original);old.version='0.1.0-candidate.2';fs.writeFileSync(file,JSON.stringify(old));assert.throws(f.plan);
});
test('SDK49 missing or changed committed supply is refused instead of falling back to legacy316',t=>{
 const f=fixture(t);
 f.put(manifestName,Buffer.from('{}'));f.commit();assert.throws(f.plan,/SDK49_RUNTIME_DEPENDENCY_SUPPLY_DIFFERS/);
 fs.unlinkSync(path.join(f.root,manifestName));f.commit();assert.throws(f.plan);
});
test('all seven candidate3 split modules are required and the new declaration chain is SDK49-only',t=>{
 const f=fixture(t),old=JSON.parse(fs.readFileSync(path.join(source,'apps/wallet-desktop/scripts/wallet-auth-runtime-dependencies.json'))),oldNames=new Set(old.files.map(row=>row.path));
 const added=JSON.parse(supply).files.filter(row=>!oldNames.has(row.path));assert.equal(added.length,7);
 for(const row of added){const file=path.join(f.root,'packages/wallet-auth/node_modules',row.path),bytes=fs.readFileSync(file);fs.unlinkSync(file);assert.throws(f.plan);fs.writeFileSync(file,bytes);}
 const sdk=JSON.parse(fs.readFileSync(path.join(f.root,'packages/wallet-auth/package.json'))),provider=JSON.parse(fs.readFileSync(path.join(f.root,'packages/wallet-auth/node_modules/@ynx/batch-v01-candidate/package.json'))),pq=JSON.parse(fs.readFileSync(path.join(f.root,'packages/wallet-auth/node_modules/@noble/post-quantum/package.json')));
 assertWalletAuthDependencyDeclarations({'@noble/ciphers':'2.2.0'},sdk,provider,pq);
 assert.throws(()=>assertWalletAuthDependencyDeclarations({'@noble/ciphers':'2.2.0'},{...sdk,version:'1.3.0-pq.3.32-auth.46'},provider,pq),/DECLARATION_CHANGED/);
});
test('normal ASAR relocation writer retains exact323 and package aliases without modifying its raw input',t=>{
 const f=fixture(t),require=createRequire(new URL('../package.json',import.meta.url)),asar=require('@electron/asar'),stage=path.join(f.root,'PUBLIC-stage'),archive=path.join(f.root,'input.asar'),output=path.join(f.root,'output.asar');
 const put=(name,bytes)=>{const file=path.join(stage,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
 const metadata=Buffer.from('{"name":"public-fixture","version":"0.0.0","main":"code/apps/wallet-desktop/src/main.mjs"}');
 put('package.json',metadata);put('native/original-auth-identity.node','PUBLIC data only');put('node_modules/@ynx-chain/wallet-auth/package.json','{"name":"@ynx-chain/wallet-auth"}');
 execFileSync(process.execPath,[require.resolve('@electron/asar/bin/asar.js'),'pack',stage,archive,'--unpack','original-auth-identity.node'],{stdio:'pipe'});
 const hash=b=>createHash('sha256').update(b).digest('hex'),beforeHash=hash(fs.readFileSync(archive));
 const before=asar.listPackage(archive).map(raw=>{const name=raw.replace(/^\//,''),info=asar.statFile(archive,name,false);if(info.files)return{path:name,type:'directory',unpacked:!!info.unpacked};const b=asar.extractFile(archive,name);return{path:name,type:'file',unpacked:!!info.unpacked,executable:!!info.executable,physicalMode:info.unpacked?fs.lstatSync(path.join(archive+'.unpacked',name)).mode&0o777:null,bytes:b.length,sha256:hash(b)};});
 const config=path.join(f.root,'PUBLIC-config.json');fs.writeFileSync(config,JSON.stringify({archive,output,before,root:f.root}));
 const writer=new URL('../scripts/release-provenance.mjs',import.meta.url).href,dependency=new URL('../scripts/wallet-auth-dependencies.mjs',import.meta.url).href,pkg=fileURLToPath(new URL('../package.json',import.meta.url));
 const code=`import fs from 'node:fs';import{createRequire}from'node:module';import{writeCanonicalArchiveInputs}from${JSON.stringify(writer)};import{walletAuthDependencyPlan}from${JSON.stringify(dependency)};const c=JSON.parse(fs.readFileSync(process.argv[1])),asar=createRequire(${JSON.stringify(pkg)})('@electron/asar');await writeCanonicalArchiveInputs({asar,archive:c.archive,output:c.output,before:c.before,metadataInput:asar.extractFile(c.archive,'package.json'),dependencies:walletAuthDependencyPlan(c.root,'HEAD'),evidence:{rows:[],contents:new Map()}});`;
 execFileSync(process.execPath,['--input-type=module','-e',code,config],{stdio:'pipe'});
 const plan=f.plan();assert.equal(verifyPackagedWalletAuthDependencies(asar,output,plan,{dependencies:plan.public.versions}).filesVerified,323);
 for(const row of plan.rows){const alias=row.path.replace('code/packages/wallet-auth/','node_modules/@ynx-chain/wallet-auth/');assert.equal(hash(asar.extractFile(output,alias)),row.sha256);}
 assert.equal(hash(fs.readFileSync(archive)),beforeHash);
});
