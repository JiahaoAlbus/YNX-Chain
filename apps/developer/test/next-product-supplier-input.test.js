import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPhysicalPin,assertSourceRows} from '../scripts/next-product-supplier-input.mjs';
test('physical supplier verification rejects changed bytes and symlink aliases',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-next-product-pin-')));
 try{
  const path=join(root,'source'),bytes=Buffer.from('fixed source');await writeFile(path,bytes);
  const pin={path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.deepEqual(await verifyPhysicalPin(pin),pin);
  await writeFile(path,'other source');await assert.rejects(verifyPhysicalPin(pin),/pinned|changed/);
  await writeFile(path,bytes);const alias=join(root,'alias');await symlink(path,alias);
  await assert.rejects(verifyPhysicalPin({...pin,path:alias}),/regular file/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('inventory cannot duplicate or escape the supplied source root',()=>{
 const row={path:'/source/a',relativePath:'a'};assert.doesNotThrow(()=>assertSourceRows([row],'/source'));
 for(const rows of [[row,row],[{path:'/outside/a',relativePath:'../outside/a'}],[{...row,relativePath:'b'}]])assert.throws(()=>assertSourceRows(rows,'/source'),/escaped|duplicated/);
});
