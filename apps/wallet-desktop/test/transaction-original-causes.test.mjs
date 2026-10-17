import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FileTransactionIntentStore,originalRetention} from '../src/transaction-intent-store.mjs';
const account='0x'+'1'.repeat(40);
for(const first of [false,null,undefined,0,''])test(`original journal retains first ${String(first)} failure separately from cleanup/storage`,async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ynx-original-causes-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new FileTransactionIntentStore({filePath:path.join(directory,'journal.json')});await store.reserveOriginal(account,'native');
 store.originalFailed(account,first);store.originalFailed(account,Error('LATER_OPERATION'));
 store.originalFailed(account,first,{storage:true});store.originalFailed(account,Error('LATER_STORAGE'),{storage:true});
 const original=store.localOriginal(account);assert.equal(original.originalCause,first);assert.equal(original.storageCause,first);
 assert.equal(original.originalCausePresent,true);assert.equal(original.storageCausePresent,true);
 const visible=originalRetention(original);assert.equal(visible.originalCausePresent,true);assert.equal(visible.storageCausePresent,true);assert.equal(visible.durable,false);
 assert.equal((await store.unresolvedPreparation(account)).kind,'native');await assert.rejects(store.assertNoPreparation(account));
});
test('storage wrapper is not promoted to an operation failure and cause getters are never invoked',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ynx-original-causes-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new FileTransactionIntentStore({filePath:path.join(directory,'journal.json')});await store.reserveOriginal(account,'native');
 assert.equal(originalRetention(store.localOriginal(account)).originalCausePresent,false);
 store.originalFailed(account,null,{storage:true});store.originalFailed(account,{cause:null});
 assert.equal(store.localOriginal(account).originalCausePresent,false);assert.equal(store.localOriginal(account).storageCausePresent,true);
 let reads=0;const operation=Object.defineProperty(Error('operation'), 'cause',{get(){reads++;throw Error('do not invoke');}});
 store.originalFailed(account,operation);assert.equal(reads,0);assert.equal(store.localOriginal(account).originalCause,operation);
 store.originalFailed(account,Error('later'));assert.equal(store.localOriginal(account).originalCause,operation);
});
