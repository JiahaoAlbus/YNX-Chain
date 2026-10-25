import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {canonicalArchivePlan,canonicalPackedPath,SDK_CANONICAL} from '../scripts/canonical-package.mjs';
import {readSDK46ProductRuntime,assertSDK46ProductArchive} from '../scripts/sdk46-product-runtime.mjs';
const root=process.env.WALLET_SDK46_FAILED_APP_ROOT;
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
test('actual SDK46 failed raw ASAR passes normal relocation child with immutable full-to-product manifest mapping',{skip:!root?'requires preserved original A d220 failed normal App':false},t=>{
 const cwd=path.join(root,'apps/wallet-desktop'),resources=path.join(cwd,'dist/mac-arm64/YNX Wallet.app/Contents/Resources'),archive=path.join(resources,'app.asar');
 const asar=createRequire(path.join(cwd,'package.json'))('@electron/asar');
 const inputPin=pin(fs.readFileSync(archive));
 const before=asar.listPackage(archive).map(raw=>{
  const name=raw.replace(/^\//,''),info=asar.statFile(archive,name,false);
  if('files'in info)return{path:name,type:'directory',unpacked:!!info.unpacked};
  if('link'in info)return{path:name,type:'link',link:info.link,unpacked:!!info.unpacked};
  return{path:name,type:'file',unpacked:!!info.unpacked,executable:!!info.executable,physicalMode:info.unpacked?fs.lstatSync(path.join(archive+'.unpacked',name)).mode&0o777:null,...pin(asar.extractFile(archive,name,false))};
 });
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert.equal(commit,'d220e41f8e9c72b57060ab6d039014d9a53dc7cf');
 const product=readSDK46ProductRuntime(root,commit),prepared=product.prepare(before),metadata=asar.extractFile(archive,'package.json');
 assert.equal(product.excluded.size,15);assert.equal(prepared.excludedRows.length,17);
 for(const name of ['native/original-auth-runtime-manifest.json','native/walletconnect-runtime-manifest.json'])for(const mutation of [row=>({...row,sha256:'0'.repeat(64)}),row=>({...row,unpacked:true}),row=>({...row,executable:true})]){
  const bad=before.map(row=>canonicalPackedPath(row.path)===SDK_CANONICAL+'/'+name?mutation(row):row);
  assert.throws(()=>product.prepare(bad),/SDK46_PRODUCT_BUILD_INPUT_MANIFEST_DIFFERS/);
 }
 for(const row of prepared.manifestRows){
  const previous=before.find(p=>canonicalPackedPath(p.path)===row.path);
  assert.equal(previous.bytes,row.originalBytes);assert.equal(previous.sha256,row.originalSHA256);assert.equal(previous.unpacked,false);assert.equal(previous.executable,false);
 }
 const plan=canonicalArchivePlan(before,metadata,[],prepared.manifestRows,prepared.dataRows,prepared.excludedRows);
 const allowed=new Set([...product.selected.keys()].map(p=>SDK_CANONICAL+'/'+p));for(const row of product.manifestRows)allowed.add(row.path);
 assert.deepEqual(plan.after.filter(row=>row.type!=='directory'&&row.path.startsWith(SDK_CANONICAL+'/')&&!allowed.has(row.path)).map(row=>row.path),[]);
 assertSDK46ProductArchive(product,plan.after);
 for(const change of [row=>({...row,sourcePath:row.sourcePath.replace('sdk46','sdk47')}),row=>({...row,originalSHA256:'0'.repeat(64)}),row=>({...row,originalBytes:row.originalBytes+1})]){
  const bad=prepared.manifestRows.map((row,i)=>i?row:change(row));assert.throws(()=>canonicalArchivePlan(before,metadata,[],bad,prepared.dataRows,prepared.excludedRows),/Product runtime manifest mapping differs/);
 }
 const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wallet-sdk46-relocation-')));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 const output=path.join(temporary,'app.asar'),writer=new URL('../scripts/release-provenance.mjs',import.meta.url).href;
 const script=`import{writeRelocatedArchive}from${JSON.stringify(writer)};await writeRelocatedArchive(${JSON.stringify(resources)},${JSON.stringify(cwd)},${JSON.stringify(output)});`;
 const run=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',maxBuffer:2<<20});assert.equal(run.status,0,run.stderr);
 const after=asar.listPackage(output).map(raw=>{const name=raw.replace(/^\//,''),info=asar.statFile(output,name,false);return'files'in info?{path:name,type:'directory'}:'link'in info?{path:name,type:'link'}:info.unpacked?{path:name,type:'file'}:{path:name,type:'file',...pin(asar.extractFile(output,name,false))};});
 assertSDK46ProductArchive(product,after);
 for(const row of prepared.manifestRows)assert.deepEqual(asar.extractFile(output,row.path),product.contents.get(row.path));
 assert.equal(after.filter(row=>row.path===SDK_CANONICAL+'/native/original-ide-auth-runtime-manifest.json').length,1);
 assert.deepEqual(pin(fs.readFileSync(archive)),inputPin);
});
