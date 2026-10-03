import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeMomentIntents,checkedNativeMomentIntent,publishedMomentRecordId,publishOriginalNativeMoment,type NativeMomentDraft} from './nativeMomentIntent';
const account='ynx1'+'a'.repeat(38),other='ynx1'+'b'.repeat(38),draft:NativeMomentDraft={text:'Original',visibility:'contacts',media:[{id:'original-media',uri:'file:///original.jpg'}]};
test('unknown publication response is checked, not asserted into success',()=>{
 for(const value of [null,{},true,{record:{}},{record:{id:''}},{record:{id:123}}])assert.throws(()=>publishedMomentRecordId(value),/not confirmed/);
 assert.equal(publishedMomentRecordId({record:{id:'actual-record'}}),'actual-record');
});
function fixture(){const rows=new Map<string,string>();let nonces=0;const storage={read:async(key:string)=>rows.get(key)??null,write:async(key:string,value:string)=>{rows.set(key,value)},remove:async(key:string)=>{rows.delete(key)}};return {rows,storage,queue:new NativeMomentIntents(storage,async()=>{nonces++;return 'a'.repeat(32)}),nonces:()=>nonces}}
test('original publication survives a new controller and retains payload/key',async()=>{
 const f=fixture(),first=await f.queue.prepare(account,draft,()=>true);const restarted=new NativeMomentIntents(f.storage,async()=>{throw new Error('no replacement nonce')});assert.deepEqual(await restarted.load(account),first);assert.deepEqual(await restarted.prepare(account,draft,()=>true),first);assert.equal(f.nonces(),1);
});
test('changed visibility/text/media cannot replace uncertain publication',async()=>{
 const f=fixture(),first=await f.queue.prepare(account,draft,()=>true);for(const changed of [{...draft,text:'Changed'},{...draft,visibility:'public' as const},{...draft,media:[]}])await assert.rejects(f.queue.prepare(account,changed,()=>true),/Restore/);assert.deepEqual(await f.queue.load(account),first);
});
test('another account has a separate carrier and cannot read original',async()=>{
 const f=fixture();await f.queue.prepare(account,draft,()=>true);assert.equal(await f.queue.load(other),null);assert.equal(f.rows.size,1);
});
test('malformed existing storage is retained, not reset',async()=>{
 const f=fixture();f.rows.set(`ynx.social.moment.intent.v1.${account}`,'broken original');await assert.rejects(f.queue.prepare(account,draft,()=>true),/recovery/);assert.equal([...f.rows.values()][0],'broken original');assert.equal(f.nonces(),0);
});
test('stale authority cannot create, acknowledge or remove original carrier',async()=>{
 const f=fixture();await assert.rejects(f.queue.prepare(account,draft,()=>false),/original account/);assert.equal(f.rows.size,0);const intent=await f.queue.prepare(account,draft,()=>true);assert.equal(await f.queue.acknowledge(intent,'actual-record',()=>false),false);assert.equal(f.rows.size,1);
});
test('only original current successful readback clears its pending carrier',async()=>{
 const f=fixture(),intent=await f.queue.prepare(account,draft,()=>true);await assert.rejects(f.queue.acknowledge(intent,'',()=>true),/not confirmed/);assert.equal(f.rows.size,1);assert.equal(await f.queue.acknowledge(intent,'actual-record',()=>true),true);assert.equal(f.rows.size,0);
});
test('account mismatch and unrecognized schema cannot be adopted',async()=>{
 const f=fixture(),intent=await f.queue.prepare(account,draft,()=>true);assert.throws(()=>checkedNativeMomentIntent(JSON.stringify(intent),other),/recovery/);assert.throws(()=>checkedNativeMomentIntent(JSON.stringify({...intent,grant:'fake'}),account),/recovery/);
});
test('timeout followed by late server success retains original nonce for exact retry',async()=>{
 const f=fixture();let finish!:(value:unknown)=>void;let sentKey='';
 await assert.rejects(publishOriginalNativeMoment(f.queue,account,draft,()=>true,payload=>{sentKey=payload.idempotencyKey;return new Promise(resolve=>{finish=resolve})},10),/not confirmed/);
 const original=await f.queue.load(account);assert.equal(original?.idempotencyKey,sentKey);
 finish({record:{id:'late-server-record'}});await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(await f.queue.load(account),original);assert.equal(f.nonces(),1);
 const retried=await f.queue.prepare(account,draft,()=>true);assert.equal(retried.idempotencyKey,sentKey);
});
test('unknown server receipt retains original publication instead of clearing',async()=>{
 const f=fixture();await assert.rejects(publishOriginalNativeMoment(f.queue,account,draft,()=>true,async()=>({accepted:true})),/not confirmed/);assert.equal(f.rows.size,1);
});
test('account changes while server is replying preserve carrier and discard UI success',async()=>{
 const f=fixture();let current=true;
 assert.equal(await publishOriginalNativeMoment(f.queue,account,draft,()=>current,async()=>{current=false;return {record:{id:'old-record'}}}),false);
 assert.equal(f.rows.size,1);
});
test('current server receipt completes exactly original request',async()=>{
 const f=fixture();let sends=0;
 assert.equal(await publishOriginalNativeMoment(f.queue,account,draft,()=>true,async()=>{sends++;return {record:{id:'actual-record'}}}),true);
 assert.equal(sends,1);assert.equal(f.rows.size,0);
});
test('closing the composer bounds local wait and late success cannot clear original',async()=>{
 const f=fixture(),close=new AbortController();let finish!:(value:unknown)=>void,started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve});
 const pending=publishOriginalNativeMoment(f.queue,account,draft,()=>true,()=>{started();return new Promise(resolve=>{finish=resolve})},1000,close.signal);
 await ready;const original=await f.queue.load(account);close.abort();assert.equal(await pending,false);
 finish({record:{id:'late-after-close'}});await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(await f.queue.load(account),original);assert.deepEqual(await f.queue.prepare(account,draft,()=>true),original);
});
test('permission rejection retains exact original body and key for explicit restoration',async()=>{
 const f=fixture();await assert.rejects(publishOriginalNativeMoment(f.queue,account,draft,()=>true,async()=>{throw new Error('permission rejected')}),/permission rejected/);
 const restored=await f.queue.load(account);assert.equal(restored?.text,draft.text);assert.equal(restored?.visibility,draft.visibility);assert.deepEqual(restored?.media,draft.media);
 assert.deepEqual(await f.queue.prepare(account,draft,()=>true),restored);assert.equal(f.nonces(),1);
});
test('already closed review sends nothing and creates no carrier',async()=>{
 const f=fixture(),close=new AbortController();close.abort();let sends=0;
 assert.equal(await publishOriginalNativeMoment(f.queue,account,draft,()=>true,async()=>{sends++;return {}},1000,close.signal),false);
 assert.equal(sends,0);assert.equal(f.rows.size,0);
});
