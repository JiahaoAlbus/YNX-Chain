import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {isIP} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
async function fixture(t,{writeFailure=false,closeFailure=false,dirSyncFailure=false,dirCloseFailure=false}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ynx-multichain-atomic-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const filePath=path.join(root,'journal.json'),before='{"version":1,"PUBLIC":"original pending transaction"}';await fs.writeFile(filePath,before,{mode:0o600});
 let fileCloses=0,dirCloses=0;
 const cleanup=Error('PUBLIC cleanup diagnostic'),directoryFailure=Error('PUBLIC directory fsync refusal');
 const open=async(file,...args)=>{
  const handle=await fs.open(file,...args),temporary=file.endsWith('.tmp'),directory=file===root;
  return new Proxy(handle,{get(object,key){
   if(key==='writeFile'&&temporary&&writeFailure)return async()=>{throw false;};
   if(key==='sync'&&directory&&dirSyncFailure)return async()=>{throw directoryFailure;};
   if(key==='close')return async()=>{if(temporary)fileCloses++;if(directory)dirCloses++;await object.close();if(temporary&&closeFailure)throw cleanup;if(directory&&dirCloseFailure)throw cleanup;};
   const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;
  }});
 };
 const source=(await fs.readFile(new URL('../src/multichain-config.mjs',import.meta.url),'utf8')).replace(/^import .*;$/mg,'').replace(/^export /mg,'');
 const context={open,readFile:fs.readFile,rename:fs.rename,unlink:fs.unlink,mkdir:fs.mkdir,path,isIP,createHash,randomUUID,structuredClone,Buffer};
 runInNewContext(source+'\nthis.File=AtomicMultiFile;',context);
 const store=new context.File({filePath,initial:{version:1},validate:x=>x});
 return {root,filePath,before,store,cleanup,directoryFailure,counts:()=>({fileCloses,dirCloses}),files:()=>fs.readdir(root)};
}
test('uncertain first file close is never retried and the unrenamed original-result copy is preserved',async t=>{
 const f=await fixture(t,{closeFailure:true});let failure;
 try{await f.store.write({version:1,PUBLIC:'new original signed-result DATA'});}catch(e){failure=e;}
 assert(failure);assert.equal(f.counts().fileCloses,1);
 assert.equal(await fs.readFile(f.filePath,'utf8'),f.before);
 const temporary=(await f.files()).filter(n=>n.endsWith('.tmp'));assert.equal(temporary.length,1);
 assert.match(await fs.readFile(path.join(f.root,temporary[0]),'utf8'),/new original signed-result DATA/);
});
test('falsy write failure remains first cause while a single cleanup failure remains separate',async t=>{
 const f=await fixture(t,{writeFailure:true,closeFailure:true});let failure;
 try{await f.store.write({version:1,PUBLIC:'new original DATA'});}catch(e){failure=e;}
 assert.equal(failure?.code,'MULTICHAIN_STORE_WRITE_UNCONFIRMED');assert.equal(failure.cause,false);
 assert.equal(failure.cleanupCausePresent,true);assert.equal(failure.cleanupCause,f.cleanup);
 assert.equal(f.counts().fileCloses,1);assert.equal(await fs.readFile(f.filePath,'utf8'),f.before);
 assert.equal((await f.files()).filter(n=>n.endsWith('.tmp')).length,1);
});
test('post-rename directory failure preserves the new record and separate cleanup failure without success',async t=>{
 const f=await fixture(t,{dirSyncFailure:true,dirCloseFailure:true});let failure;
 try{await f.store.write({version:1,PUBLIC:'new result after rename'});}catch(e){failure=e;}
 assert.equal(failure?.cause,f.directoryFailure);assert.equal(failure.cleanupCause,f.cleanup);
 assert.equal(failure.renamed,true);assert.equal(f.counts().dirCloses,1);
 assert.match(await fs.readFile(f.filePath,'utf8'),/new result after rename/);
});
