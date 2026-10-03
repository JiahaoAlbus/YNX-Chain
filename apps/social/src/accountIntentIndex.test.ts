import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountIntentIndex} from './accountIntentIndex';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
const a='ynx1'+'a'.repeat(38),b='ynx1'+'b'.repeat(38);
const key=(account:string)=>'ynx.social.moment.report.v1.'+bytesToHex(sha256(utf8ToBytes(JSON.stringify([account,'moment','target']))));
const raw=(account:string)=>JSON.stringify({account,body:{targetId:'target'}});
function harness(){const data=new Map<string,string>();const store={read:async(key:string)=>data.get(key)??null,write:async(key:string,value:string)=>{data.set(key,value)},remove:async(key:string)=>{data.delete(key)}};return {data,store,index:new AccountIntentIndex(store)}}
test('cold account cleanup removes indexed original records and preserves another account and unknown legacy',async()=>{
 const h=harness();await h.index.bind(a,()=>true).write(key(a),raw(a));await h.index.bind(b,()=>true).write(key(b),raw(b));h.data.set('unknown-legacy','keep');
 const result=await new AccountIntentIndex(h.store).cleanupConfirmed(a,()=>true);
 assert.equal(result.knownRecordsRemoved,1);assert.equal(result.legacyUnindexedPreserved,true);assert.equal(h.data.has(key(a)),false);assert.equal(h.data.get(key(b)),raw(b));assert.equal(h.data.get('unknown-legacy'),'keep');
 await assert.rejects(h.index.bind(a,()=>true).write(key(a),raw(a)),/deletion was confirmed/);
});
test('index write precedes record and interruption never creates an unindexed new record',async()=>{
 const h=harness();let writes=0;h.store.write=async(key,value)=>{writes++;if(key.includes('index'))throw new Error('index interrupted');h.data.set(key,value)};
 await assert.rejects(h.index.bind(a,()=>true).write(key(a),raw(a)),/interrupted/);assert.equal(writes,1);assert.equal(h.data.has(key(a)),false);
});
test('authorization change during storage read stops cleanup before any erasure',async()=>{
 const h=harness();await h.index.bind(a,()=>true).write(key(a),raw(a));let current=true;const read=h.store.read;h.store.read=async k=>{const value=await read(k);current=false;return value};
 await assert.rejects(h.index.cleanupConfirmed(a,()=>current),/authorization changed/);assert.equal(h.data.get(key(a)),raw(a));
});
test('corrupted reference to another account is never erased',async()=>{
 const h=harness();h.data.set(key(b),raw(b));h.data.set(`ynx.social.intent.index.v1.${a}`,JSON.stringify({version:1,account:a,keys:[key(b)],deleted:false,cleanupComplete:false}));
 await assert.rejects(h.index.cleanupConfirmed(a,()=>true),/binding changed/);assert.equal(h.data.get(key(b)),raw(b));
});
