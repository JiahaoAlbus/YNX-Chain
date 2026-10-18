import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PQBackupFile} from '../src/pq-backup-file.mjs';
async function fixture(t){const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-backup-file-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,file:path.join(directory,'qa.ynxpq'),store:new PQBackupFile(),guard:{assert(){}}};}
test('PQ backup file saves exact SDK bytes privately and reads without altering existing file',async t=>{
 const f=await fixture(t),wire=new TextEncoder().encode('{"TEST_ENCRYPTED_ENVELOPE":true}');
 await f.store.write(f.file,wire,f.guard);assert.deepEqual(await f.store.read(f.file,f.guard),wire);
 if(process.platform!=='win32')assert.equal((await fs.stat(f.file)).mode&0o077,0);
 await assert.rejects(f.store.write(f.file,new Uint8Array([1]),f.guard));assert.deepEqual(new Uint8Array(await fs.readFile(f.file)),wire);
});
test('PQ backup never follows or overwrites an existing symlink',async t=>{
 const f=await fixture(t),target=path.join(f.directory,'target');await fs.writeFile(target,'ORIGINAL',{mode:0o600});await fs.symlink(target,f.file);
 await assert.rejects(f.store.write(f.file,new Uint8Array([1]),f.guard));await assert.rejects(f.store.read(f.file,f.guard));assert.equal(await fs.readFile(target,'utf8'),'ORIGINAL');
});
test('PQ backup read rejects oversized or non-private file without changing it',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file,Buffer.alloc(196609),{mode:0o600});await assert.rejects(f.store.read(f.file,f.guard));assert.equal((await fs.stat(f.file)).size,196609);
 if(process.platform!=='win32'){await fs.writeFile(f.file,'encrypted');await fs.chmod(f.file,0o644);await assert.rejects(f.store.read(f.file,f.guard));}
});
test('PQ lock after file creation retains partial output and rejects success without overwriting or cleanup',async t=>{
 const f=await fixture(t);let locked=false;
 const store=new PQBackupFile({io:{...fs,open:async(...args)=>{const h=await fs.open(...args);if(args[1]==='wx')locked=true;return h;}}});
 await assert.rejects(store.write(f.file,new Uint8Array([1]),{assert(){if(locked)throw false;}}),{code:'PQ_BACKUP_EXPORT_UNCONFIRMED'});
 assert.equal((await fs.stat(f.file)).size,0);
});
