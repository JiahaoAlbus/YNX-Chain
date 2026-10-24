import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readOriginalPQHostSourceCatalog} from '../src/wallet-pq-host-catalog.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-catalog-public-')));fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'catalog.json'),bytes=Buffer.from('{"PUBLIC":"Not Protocol trust or an executable"}');fs.writeFileSync(file,bytes,{mode:0o600});
 return {dir,file,bytes,receipt:{catalogPath:file,catalogSha256:sha(bytes)}};
}
test('absent independent registration refuses, and malformed pairs cannot read arbitrary configuration',()=>{
 for(const v of [null,undefined])assert.throws(()=>readOriginalPQHostSourceCatalog(v),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'});
 let reads=0;const getter={get catalogPath(){reads++;return '/PUBLIC';},catalogSha256:'a'.repeat(64)};
 for(const r of [getter,new Proxy({},{}),{catalogPath:'/PUBLIC',catalogSha256:'a'.repeat(64),nativeGrant:true},{catalogPath:'/PUBLIC/../other',catalogSha256:'a'.repeat(64)},{catalogPath:'/',catalogSha256:'a'.repeat(64)},{catalogPath:'/PUBLIC',catalogSha256:'0'.repeat(64)}])assert.throws(()=>readOriginalPQHostSourceCatalog(r));
 assert.equal(reads,0);
});
test('actual protected catalog read returns only the independently supplied pair, not a Source grant',{skip:process.platform==='win32'||process.getuid?.()===0},t=>{
 const f=fixture(t),r=readOriginalPQHostSourceCatalog(f.receipt);assert.deepEqual(r,f.receipt);assert(Object.isFrozen(r));assert.deepEqual(Object.keys(r),['catalogPath','catalogSha256']);assert(fs.readFileSync(f.file).equals(f.bytes));
});
test('pin, parent privacy, file privacy, symlink, hardlink and bounded size failures never repair the original',{skip:process.platform==='win32'||process.getuid?.()===0},t=>{
 for(const mode of ['pin','parent','file','symlink','hardlink','oversize','empty']){
  const f=fixture(t);
  if(mode==='pin')f.receipt.catalogSha256='a'.repeat(64);
  if(mode==='parent')fs.chmodSync(f.dir,0o755);
  if(mode==='file')fs.chmodSync(f.file,0o644);
  if(mode==='symlink'){const target=path.join(f.dir,'original.json');fs.renameSync(f.file,target);fs.symlinkSync(target,f.file);}
  if(mode==='hardlink')fs.linkSync(f.file,path.join(f.dir,'another.json'));
  if(mode==='oversize')fs.writeFileSync(f.file,Buffer.alloc(16385,1));
  if(mode==='empty')fs.writeFileSync(f.file,'');
  const before=fs.lstatSync(f.file);assert.throws(()=>readOriginalPQHostSourceCatalog(f.receipt),{code:'PQ_HOST_CATALOG_UNVERIFIED'});
  const after=fs.lstatSync(f.file);for(const k of ['ino','size','mode','nlink'])assert.equal(after[k],before[k]);
 }
});
test('controlled mid-read replacement and close failure cannot publish a successful catalog pair',{skip:process.platform==='win32'||process.getuid?.()===0},t=>{
 for(const mode of ['replace','parent','close']){
  const f=fixture(t),moduleURL=new URL('../src/wallet-pq-host-catalog.mjs',import.meta.url).href;
  // Fault injection is confined to this separate PUBLIC process. The actual
  // normal loader has no injected filesystem/clock/provider callbacks.
  const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import assert from 'node:assert/strict';import {readOriginalPQHostSourceCatalog} from ${JSON.stringify(moduleURL)};
   const pair=${JSON.stringify(f.receipt)},mode=${JSON.stringify(mode)},dir=${JSON.stringify(f.dir)},read=fs.readSync,close=fs.closeSync;let entered=false;
   fs.readSync=(...args)=>{const n=read(...args);if(!entered){entered=true;if(mode==='replace'){fs.renameSync(pair.catalogPath,pair.catalogPath+'.original');fs.writeFileSync(pair.catalogPath,'replacement',{mode:0o600});}if(mode==='parent'){fs.renameSync(dir,dir+'.original');fs.mkdirSync(dir,{mode:0o700});fs.writeFileSync(pair.catalogPath,'replacement',{mode:0o600});}}return n;};
   if(mode==='close')fs.closeSync=(...args)=>{close(...args);throw Object.assign(Error('PUBLIC close unknown'),{code:'PUBLIC_CLOSE_UNKNOWN'});};
   syncBuiltinESMExports();try{assert.throws(()=>readOriginalPQHostSourceCatalog(pair),e=>e.code==='PQ_HOST_CATALOG_UNVERIFIED'&&(mode!=='close'||e.cause.code==='PUBLIC_CLOSE_UNKNOWN'));console.log('PUBLIC_CATALOG_FAULT_REFUSED');}finally{fs.readSync=read;fs.closeSync=close;syncBuiltinESMExports();}`;
  if(mode==='parent')t.after(()=>fs.rmSync(f.dir+'.original',{recursive:true,force:true}));
  const r=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PUBLIC_CATALOG_FAULT_REFUSED/);
 }
});
