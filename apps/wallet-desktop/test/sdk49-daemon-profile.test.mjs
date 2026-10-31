import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readSDK49ProductRuntime,assertSDK49ProductArchive} from '../scripts/sdk49-product-runtime.mjs';
import {SDK49_DAEMON_VARIANT,SDK49_DAEMON_UNION} from '../scripts/sdk49-daemon-profile.mjs';
import {sdkRuntimeUnionProfile,SDK49_RUNTIME_UNION} from '../scripts/sdk14-runtime-union.mjs';
import {verifySDK49FullRuntimeTables} from '../scripts/sdk49-runtime-source.mjs';
import {fixedSDKRuntimeManifestSources,assertSDKRuntimePackCoverage,relocateDesktopRuntimeSource} from '../scripts/release-provenance.mjs';
import {verifySDK13NativeComponent} from '../scripts/sdk13-native-component.mjs';
const source=fileURLToPath(new URL('../../..',import.meta.url)),version='1.3.0-pq.3.32-auth.49';
const packed=fs.readFileSync(new URL('./fixtures/sdk49-daemon-product-source.json.gz',import.meta.url));
assert.equal(createHash('sha256').update(packed).digest('hex'),'4364f73319801ac656fdc819bd64a5f70dcbd070cd073c2462c4a44a80640f44');
const data=JSON.parse(gunzipSync(packed)),auth='packages/wallet-auth/native/original-ide-auth-runtime-manifest.json',union='packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json';
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wallet-sdk49-daemon-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,b)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,b);};
 for(const[name,b64]of Object.entries(data.files))put(name,Buffer.from(b64,'base64'));
 put('apps/wallet-desktop/package.json',fs.readFileSync(path.join(source,'apps/wallet-desktop/package.json')));
 const git=(...a)=>execFileSync('git',a,{cwd:root,stdio:'pipe'}),commit=()=>{git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','Exact supplier source DATA');};
 git('init','-q');commit();return{root,put,commit,read:n=>fs.readFileSync(path.join(root,n)),product:()=>readSDK49ProductRuntime(root,'HEAD')};
}
test('same-version daemon six-role source reaches the normal product and executable pack-filter callers',t=>{
 const f=fixture(t),p=f.product();assert.equal(p.public.sourceVariant,SDK49_DAEMON_VARIANT);
 assert.equal(p.selected.size,9612);assert.equal(p.authRows.size,601);assert.equal(p.unionRows.size,9462);assert.equal(p.excluded.size,15);
 assert.equal(p.public.SourceQualified,false);assert.equal(p.public.Root,false);assert.equal(p.public.computedEdgesProven,false);
 assert.deepEqual(fixedSDKRuntimeManifestSources(f.root,'HEAD'),[auth,union]);
 assert.equal(assertSDKRuntimePackCoverage(path.join(f.root,'apps/wallet-desktop'),'HEAD').runtimeQualified,false);
 // Model the raw archive's exact existing members; no Native code is loaded.
 const before=[...p.selected.values()].map(row=>({...row,path:'code/packages/wallet-auth/'+row.path,type:'file',unpacked:false,executable:false}));
 const prepared=p.prepare(before),inventory=[...prepared.dataRows,...prepared.manifestRows.map(row=>({...row,type:'file'}))];
 assert.equal(inventory.length,9614);assertSDK49ProductArchive(p,inventory);
 assert.throws(()=>assertSDK49ProductArchive(p,inventory.slice(1)),/PACK_ROW_MISSING_OR_CHANGED/);
});
test('new full runtime tables pair only with each other and never inherit the old default version profile',t=>{
 const f=fixture(t),a=f.read(auth),u=f.read(union),oldAuth=fs.readFileSync(path.join(source,auth)),oldUnion=fs.readFileSync(path.join(source,union));
 assert.equal(sdkRuntimeUnionProfile(version),SDK49_RUNTIME_UNION);
 assert.equal(sdkRuntimeUnionProfile(version,u),SDK49_DAEMON_UNION);
 assert.deepEqual(verifySDK49FullRuntimeTables(a,u),{authFiles:611,unionFiles:9471,fullAuthSubsetOfFullUnion:true,NativeAdmission:false});
 assert.deepEqual(verifySDK49FullRuntimeTables(oldAuth,oldUnion),{authFiles:597,unionFiles:9457,fullAuthSubsetOfFullUnion:true,NativeAdmission:false});
 assert.throws(()=>verifySDK49FullRuntimeTables(a,oldUnion));assert.throws(()=>verifySDK49FullRuntimeTables(oldAuth,u));
 f.put(auth,oldAuth);f.commit();assert.throws(()=>fixedSDKRuntimeManifestSources(f.root,'HEAD'));
});
test('mixed, changed and missing formal roles cannot silently select either SDK49 source image',t=>{
 const f=fixture(t),selection='runtime-projections/sdk49-product/SDK49_PRODUCT_PACK_SELECTION.json';
 f.put(selection,fs.readFileSync(path.join(source,selection)));f.commit();assert.throws(f.product,/SOURCE_PIN_DIFFERS/);
 f.put(selection,Buffer.from(data.files[selection],'base64'));f.put('runtime-projections/sdk49-product/PROJECTION_RECEIPT.json',Buffer.from('{}'));f.commit();assert.throws(f.product,/SOURCE_PIN_DIFFERS/);
 fs.unlinkSync(path.join(f.root,selection));f.commit();assert.throws(f.product,/SOURCE_SET_DIFFERS/);
});
test('new Root storage URL remains unavailable and requires its exact selected source role',t=>{
 const f=fixture(t),name='packages/wallet-auth/src/original-source-root-owner-v2.js',raw=f.read(name);
 assert.throws(()=>relocateDesktopRuntimeSource(name,raw,version),/Unlisted repository operand/);
 assert.deepEqual(relocateDesktopRuntimeSource(name,raw,version,SDK49_DAEMON_VARIANT).bytes,raw);
 assert.throws(()=>relocateDesktopRuntimeSource(name,Buffer.concat([raw,raw]),version,SDK49_DAEMON_VARIANT),/operand count differs/);
 assert.throws(()=>relocateDesktopRuntimeSource(name,Buffer.from(raw.toString().replace('original-source-root-dirfd.node','unreviewed.node')),version,SDK49_DAEMON_VARIANT));
 assert.throws(()=>relocateDesktopRuntimeSource(name,raw,'1.3.0-pq.3.32-auth.46',SDK49_DAEMON_VARIANT),/Unsupported SDK source variant/);
});
test('the existing executed component record is refused against the new runtime before module or helper qualification',t=>{
 const f=fixture(t),record=JSON.parse(fs.readFileSync(path.join(source,'apps/wallet-desktop/native/original-auth-identity-build.json'))),before=JSON.stringify(record),reads=[];
 assert.throws(()=>verifySDK13NativeComponent({record,inventoryBytes:fs.readFileSync(path.join(source,record.sourceInventory.relative)),moduleBytes:Buffer.from('PUBLIC unused'),helperBytes:Buffer.from('PUBLIC unused')},name=>{reads.push(name);return f.read(name)}));
 assert.deepEqual(reads,[union]);assert.equal(JSON.stringify(record),before);
});
test('normal ASAR writer emits the new exact projected table pair and preserves the unavailable Root caller bytes',t=>{
 const f=fixture(t),p=f.product(),require=createRequire(new URL('../package.json',import.meta.url)),asar=require('@electron/asar'),stage=path.join(f.root,'PUBLIC-input'),archive=path.join(f.root,'raw.asar'),output=path.join(f.root,'projected.asar'),owner='src/original-source-root-owner-v2.js';
 const put=(name,b)=>{const file=path.join(stage,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,b);};
 const metadata=Buffer.from('{"name":"public-fixture","main":"code/apps/wallet-desktop/src/main.mjs"}');
 put('package.json',metadata);put('native/original-auth-identity.node','PUBLIC data, not a component');
 put('node_modules/@ynx-chain/wallet-auth/package.json','{"name":"@ynx-chain/wallet-auth"}');
 put('node_modules/@ynx-chain/wallet-auth/'+owner,f.read('packages/wallet-auth/'+owner));
 for(const name of [auth,union])put('node_modules/@ynx-chain/wallet-auth/'+name.slice('packages/wallet-auth/'.length),f.read(name));
 execFileSync(process.execPath,[require.resolve('@electron/asar/bin/asar.js'),'pack',stage,archive,'--unpack','original-auth-identity.node'],{stdio:'pipe'});
 const hash=b=>createHash('sha256').update(b).digest('hex'),original=hash(fs.readFileSync(archive)),before=asar.listPackage(archive).map(raw=>{const name=raw.replace(/^\//,''),info=asar.statFile(archive,name,false);if(info.files)return{path:name,type:'directory',unpacked:!!info.unpacked};const bytes=asar.extractFile(archive,name);return{path:name,type:'file',unpacked:!!info.unpacked,executable:!!info.executable,physicalMode:info.unpacked?fs.lstatSync(path.join(archive+'.unpacked',name)).mode&0o777:null,bytes:bytes.length,sha256:hash(bytes)};});
 const config=path.join(f.root,'PUBLIC-writer.json');fs.writeFileSync(config,JSON.stringify({root:f.root,archive,output,before}));
 const writer=new URL('../scripts/release-provenance.mjs',import.meta.url).href,reader=new URL('../scripts/sdk49-product-runtime.mjs',import.meta.url).href,pkg=fileURLToPath(new URL('../package.json',import.meta.url));
 const code=`import fs from 'node:fs';import{createRequire}from'node:module';import{writeCanonicalArchiveInputs}from${JSON.stringify(writer)};import{readSDK49ProductRuntime}from${JSON.stringify(reader)};const c=JSON.parse(fs.readFileSync(process.argv[1])),asar=createRequire(${JSON.stringify(pkg)})('@electron/asar'),p=readSDK49ProductRuntime(c.root,'HEAD');await writeCanonicalArchiveInputs({asar,archive:c.archive,output:c.output,before:c.before,metadataInput:asar.extractFile(c.archive,'package.json'),dependencies:{rows:[],contents:new Map()},evidence:{rows:[],contents:new Map()},productRuntime:{manifestRows:p.manifestRows,contents:p.contents,dataRows:[],excludedRows:[]}});`;
 execFileSync(process.execPath,['--input-type=module','-e',code,config],{stdio:'pipe'});
 for(const pin of p.manifestRows)assert.equal(hash(asar.extractFile(output,pin.path)),pin.sha256);
 assert.deepEqual(asar.extractFile(output,'code/packages/wallet-auth/'+owner),f.read('packages/wallet-auth/'+owner));
 assert(!asar.listPackage(output).some(name=>name.endsWith('original-source-root-dirfd.node')));assert.equal(hash(fs.readFileSync(archive)),original);
});
