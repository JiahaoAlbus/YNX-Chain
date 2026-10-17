import test from 'node:test';
import assert from 'node:assert/strict';
import {PasswordVaultFile} from '../src/password-vault-file.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readBoundedPrivateFile} from '../src/bounded-private-file-read.mjs';
const limit=1_048_576;
const emptyJournal=JSON.stringify({schemaVersion:2,records:[],rejections:[],resolutions:[]});
function fixture(content,{size=Buffer.byteLength(content),chunk=8192}={}){
  const bytes=Buffer.from(content),calls={bulk:0,reads:[],closed:0,writes:0};
  const io={open:async()=>({stat:async()=>({isFile:()=>true,size}),readFile:async()=>{calls.bulk++;return bytes.toString('utf8')},
    read:async({buffer,offset,length,position})=>{calls.reads.push({length,position});const count=Math.min(length,chunk,Math.max(0,bytes.length-position));bytes.copy(buffer,offset,position,position+count);return{bytesRead:count,buffer}},close:async()=>{calls.closed++}})};
  const policy={available:async()=>{},assertPrivate:async()=>{}};
  return{bytes,calls,vault:new PasswordVaultFile('/controlled/vault.json',{io,filePolicy:policy}),journal:new FileTransactionIntentStore({filePath:'/controlled/journal.json',io,filePolicy:policy})};
}
test('journal growing beyond the stat budget is rejected without accepting or rewriting its original',async()=>{
  const f=fixture(emptyJournal+' '.repeat(limit),{size:emptyJournal.length});const before=Buffer.from(f.bytes);
  await assert.rejects(f.journal.snapshot(),error=>error.data?.code==='TRANSACTION_JOURNAL_INVALID');
  assert.equal(f.calls.bulk,0);assert.equal(f.calls.closed,1);assert.equal(f.calls.writes,0);assert.deepEqual(f.bytes,before);
});
test('encrypted vault growth is rejected without an unbounded bulk read or deletion',async()=>{
  const f=fixture('controlled-encrypted-metadata'+' '.repeat(limit),{size:32});
  await assert.rejects(f.vault.read(),error=>error.data?.code==='PASSWORD_VAULT_FILE_INVALID');
  assert.equal(f.calls.bulk,0);assert.equal(f.calls.closed,1);assert.equal(f.calls.writes,0);
  assert.ok(f.calls.reads.every(call=>call.position+call.length<=limit+1));
});
test('partial bounded reads preserve exact vault bytes/digest and normal journal schema',async()=>{
  const text='controlled-public-and-encrypted-元数据\n',f=fixture(text,{chunk:1});
  const read=await f.vault.read();assert.equal(read.text,text);assert.match(read.digest,/^[0-9a-f]{64}$/);assert.equal(f.calls.bulk,0);assert.equal(f.calls.closed,1);
  const j=fixture(emptyJournal,{chunk:3});assert.deepEqual(await j.journal.snapshot(),[]);assert.equal(j.calls.closed,1);assert.equal(j.calls.bulk,0);
});
test('initial oversize still refuses before content reads and exactly-at-limit remains accepted',async()=>{
  const over=fixture('x',{size:limit+1});await assert.rejects(over.vault.read(),error=>error.data?.code==='PASSWORD_VAULT_FILE_INVALID');assert.equal(over.calls.reads.length,0);assert.equal(over.calls.bulk,0);
  const exact=fixture('x'.repeat(limit));assert.equal((await exact.vault.read()).text.length,limit);assert.equal(exact.calls.bulk,0);assert.equal(exact.calls.closed,1);
  const invalidUTF8=fixture(Buffer.alloc(limit,255));await assert.rejects(invalidUTF8.vault.read(),error=>error.data?.code==='PASSWORD_VAULT_FILE_INVALID');assert.equal(invalidUTF8.calls.bulk,0);
});
test('real private file growth after fstat remains byte-bounded and preserves both original files',async t=>{
  const directory=await fs.mkdtemp(join(tmpdir(),'ynx-private-read-bounds-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  for(const kind of ['vault','journal']){
    const filePath=join(directory,kind+'.json'),original=kind==='journal'?emptyJournal:'controlled-encrypted-metadata';
    await fs.writeFile(filePath,original,{mode:0o600});let bulk=0,closed=0,requested=0;
    const io={...fs,open:async(...args)=>{
      const handle=await fs.open(...args);
      return{stat:async()=>{const stat=await handle.stat();await fs.appendFile(filePath,' '.repeat(limit));return stat},
        read:async options=>{requested+=options.length;return handle.read(options)},
        readFile:async(...args)=>{bulk++;return handle.readFile(...args)},close:async()=>{closed++;return handle.close()}};
    }};
    if(kind==='vault')await assert.rejects(new PasswordVaultFile(filePath,{io}).read(),error=>error.data?.code==='PASSWORD_VAULT_FILE_INVALID');
    else await assert.rejects(new FileTransactionIntentStore({filePath,io}).snapshot(),error=>error.data?.code==='TRANSACTION_JOURNAL_INVALID');
    assert.equal(bulk,0);assert.equal(closed,1);assert.equal(requested,limit+1);
    assert.equal(await fs.readFile(filePath,'utf8'),original+' '.repeat(limit));
  }
});
test('malformed read results and actual I/O failures cannot loop indefinitely or become partial records',async()=>{
  for(const bytesRead of [-1,0.5,65537,NaN,undefined])await assert.rejects(readBoundedPrivateFile({read:async()=>({bytesRead})}),/Invalid private file read result/);
  const f=fixture('controlled');f.vault.io.open=async()=>({stat:async()=>({isFile:()=>true,size:10}),read:async()=>{throw Object.assign(Error('sensitive OS path must not be reflected'),{code:'EIO'})},close:async()=>{f.calls.closed++}});
  await assert.rejects(f.vault.read(),error=>error.data?.code==='PASSWORD_VAULT_STORAGE_FAILED'&&!error.message.includes('sensitive OS path'));
  assert.equal(f.calls.closed,1);
});
test('close failures fail closed without reflecting paths or replacing an existing primary refusal',async()=>{
  for(const oversized of [false,true])for(const kind of ['vault','journal']){
    const f=fixture(emptyJournal+(oversized?' '.repeat(limit):''),{size:emptyJournal.length}),open=f.vault.io.open;
    f.vault.io.open=async()=>{const handle=await open();return{...handle,close:async()=>{await handle.close();throw Error('PRIVATE_PATH')}}};
    if(kind==='vault')await assert.rejects(f.vault.read(),error=>error.data?.code===(oversized?'PASSWORD_VAULT_FILE_INVALID':'PASSWORD_VAULT_STORAGE_FAILED')&&!error.message.includes('PRIVATE_PATH'));
    else await assert.rejects(f.journal.snapshot(),error=>error.data?.code==='TRANSACTION_JOURNAL_INVALID'&&!error.message.includes('PRIVATE_PATH'));
    assert.equal(f.calls.closed,1);
  }
});
test('an error after opening an existing vault or journal cannot become a missing/empty Wallet',async()=>{
  for(const phase of ['probe','stat','private-policy','read'])for(const kind of ['vault','journal']){
    const f=fixture(emptyJournal),missing=()=>{throw Object.assign(Error('PRIVATE_PATH'),{code:'ENOENT'})},open=f.vault.io.open;
    if(phase==='probe')f.vault.filePolicy.available=async()=>missing();
    if(phase==='private-policy')f.vault.filePolicy.assertPrivate=async()=>missing();
    if(['stat','read'].includes(phase))f.vault.io.open=async()=>{const h=await open();return{...h,...(phase==='stat'?{stat:async()=>missing()}:{read:async()=>missing()})}};
    if(kind==='vault')await assert.rejects(f.vault.read(),error=>error.data?.code==='PASSWORD_VAULT_STORAGE_FAILED'&&!error.message.includes('PRIVATE_PATH'));
    else await assert.rejects(f.journal.snapshot(),error=>error.data?.code==='TRANSACTION_JOURNAL_INVALID'&&!error.message.includes('PRIVATE_PATH'));
    assert.equal(f.calls.closed,phase==='probe'?0:1);assert.equal(f.calls.writes,0);
  }
});
test('only actual absence while opening keeps the established fresh-Wallet behavior',async()=>{
  const f=fixture(emptyJournal);f.vault.io.open=async()=>{throw Object.assign(Error('not present'),{code:'ENOENT'})};
  assert.equal(await f.vault.read(),null);assert.deepEqual(await f.journal.snapshot(),[]);assert.equal(f.calls.closed,0);
});
