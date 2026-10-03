import test from 'node:test';
import assert from 'node:assert/strict';
import {SocialAPI} from './api';
import {AccountIntentIndex} from './accountIntentIndex';
import {DurableOutbox} from './durableOutbox';
const a='ynx1'+'a'.repeat(38),b='ynx1'+'b'.repeat(38),key=`ynx.social.moment.intent.v1.${a}`;
const original=JSON.stringify({schemaVersion:1,account:a,idempotencyKey:'native-moment-'+'a'.repeat(32),text:'Original unknown publication',visibility:'private',media:[]});
function bind(api:SocialAPI,account=a){api.useProductSession(async()=>({proof:{account},proofHeader:'controlled-source-fixture-only'}),account)}
async function fixture(){
 const data=new Map<string,string>();const storage={read:async(k:string)=>data.get(k)??null,write:async(k:string,v:string)=>{data.set(k,v)},remove:async(k:string)=>{data.delete(k)}};
 const index=new AccountIntentIndex(storage);await index.bind(a,()=>true).write(key,original);
 const files=new Map<string,string>();const outbox=new DurableOutbox({read:k=>files.get(k)??null,write:(k,v)=>{files.set(k,v)},remove:k=>{files.delete(k)}});
 const entry={account:a,deviceId:'device',conversationId:'room',request:{messageId:'original',envelopes:[],senderSignature:'signature'}};
 outbox.update(()=>[entry]);return {data,storage,index,outbox,entry};
}
for(const [name,body] of [['false','{"deleted":false}'],['missing','{}'],['string','{"deleted":"true"}'],['invalidJSON','not-json'],['ambiguous','{"deleted":true,"account":"different"}']] as const){
 test(`bound current API rejects ${name} before authorization invalidation or local cleanup`,async()=>{
  const prior=globalThis.fetch,h=await fixture(),api=new SocialAPI('https://social.example');bind(api);const current=api.authorizationGuard();let invalidations=0,requests=0;
  api.onPrivateInvalidated=()=>{invalidations++};globalThis.fetch=async()=>{requests++;return new Response(body,{status:200})};
  try{await assert.rejects(api.deleteAccountReceipt(a),/not confirmed/);assert.equal(requests,1);assert.equal(invalidations,0);assert.equal(current(),true);assert.equal(h.data.get(key),original);assert.deepEqual(h.outbox.read(),[h.entry])}finally{globalThis.fetch=prior}
 });
}
test('exact success binds original account and clears only indexed original data',async()=>{
 const prior=globalThis.fetch,h=await fixture(),api=new SocialAPI('https://social.example');bind(api);globalThis.fetch=async()=>new Response('{"deleted":true}',{status:200});
 try{const before=api.authorizationGuard(),receipt=await api.deleteAccountReceipt(a);assert.equal(before(),false);assert.equal(receipt.account,a);assert.deepEqual(receipt.result,{deleted:true});await h.index.cleanupConfirmed(a,receipt.current);h.outbox.clearAccount(a,receipt.current);assert.equal(h.data.has(key),false);assert.deepEqual(h.outbox.read(),[])}finally{globalThis.fetch=prior}
});
test('unknown legacy account binding cannot issue a cleanup result or a DELETE',async()=>{
 const prior=globalThis.fetch,h=await fixture(),api=new SocialAPI('https://social.example','retained-legacy-token');const current=api.authorizationGuard();let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{"deleted":true}',{status:200})};
 try{await assert.rejects(api.deleteAccountReceipt(a),/legacy local erasure is not confirmed/);assert.equal(calls,0);assert.equal(current(),true);assert.equal(h.data.get(key),original)}finally{globalThis.fetch=prior}
});
test('account switch during final JSON await cannot produce deletion cleanup',async()=>{
 const prior=globalThis.fetch,h=await fixture(),api=new SocialAPI('https://social.example');bind(api);let newCurrent=()=>false;
 globalThis.fetch=async()=>{const response=new Response('{"deleted":true}',{status:200});response.json=async()=>{bind(api,b);newCurrent=api.authorizationGuard();return {deleted:true}};return response};
 try{await assert.rejects(api.deleteAccountReceipt(a),/authorization changed/);assert.equal(newCurrent(),true);assert.equal(h.data.get(key),original);assert.deepEqual(h.outbox.read(),[h.entry])}finally{globalThis.fetch=prior}
});
test('switch in invalidation callback cannot attach old success to a new account',async()=>{
 const prior=globalThis.fetch,h=await fixture(),api=new SocialAPI('https://social.example');bind(api);let newCurrent=()=>false;api.onPrivateInvalidated=()=>{bind(api,b);newCurrent=api.authorizationGuard()};globalThis.fetch=async()=>new Response('{"deleted":true}',{status:200});
 try{await assert.rejects(api.deleteAccountReceipt(a),/cleanup discarded/);assert.equal(newCurrent(),true);assert.equal(h.data.get(key),original);assert.deepEqual(h.outbox.read(),[h.entry])}finally{globalThis.fetch=prior}
});
test('interrupted local erasure retains recovery references and resumes without another backend DELETE',async()=>{
 const prior=globalThis.fetch,h=await fixture(),api=new SocialAPI('https://social.example');bind(api);let requests=0;globalThis.fetch=async()=>{requests++;return new Response('{"deleted":true}',{status:200})};
 try{const receipt=await api.deleteAccountReceipt(a),remove=h.storage.remove;h.storage.remove=async()=>{throw new Error('protected storage interrupted')};await assert.rejects(h.index.cleanupConfirmed(a,receipt.current),/interrupted/);assert.equal(h.data.get(key),original);assert.equal(JSON.parse(h.data.get(`ynx.social.intent.index.v1.${a}`)!).deleted,true);h.storage.remove=remove;await new AccountIntentIndex(h.storage).cleanupConfirmed(a,receipt.current);assert.equal(requests,1);assert.equal(h.data.has(key),false)}finally{globalThis.fetch=prior}
});
