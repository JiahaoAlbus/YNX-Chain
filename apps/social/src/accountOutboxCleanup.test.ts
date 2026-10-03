import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableOutbox} from './durableOutbox';
const a='ynx1'+'a'.repeat(38),b='ynx1'+'b'.repeat(38);
const entry=(account:string)=>({account,deviceId:'device',conversationId:'room',request:{messageId:'original',envelopes:[],senderSignature:'signature'}});
function harness(){const data=new Map<string,string>();const storage={read:(key:string)=>data.get(key)??null,write:(key:string,value:string)=>{data.set(key,value)},remove:(key:string)=>{data.delete(key)}};return {data,storage,outbox:new DurableOutbox(storage)}}
test('account deletion preserves other outbox users and legacy carrier after cold recovery',()=>{
 const h=harness();h.data.set('legacy',JSON.stringify([entry(a),entry(b)]));h.outbox.update(v=>v);assert.ok(h.data.has(`index.${a}`));
 h.outbox.clearAccount(a,()=>true);assert.deepEqual(new DurableOutbox(h.storage).read(),[entry(b)]);assert.ok(h.data.has('legacy'));assert.throws(()=>h.outbox.update(v=>[...v,entry(a)]),/Deleted account/);
});
test('stale deletion cannot touch the outbox',()=>{const h=harness();h.outbox.update(()=>[entry(a),entry(b)]);const original=[...h.data];assert.throws(()=>h.outbox.clearAccount(a,()=>false),/authorization changed/);assert.deepEqual([...h.data],original)});
