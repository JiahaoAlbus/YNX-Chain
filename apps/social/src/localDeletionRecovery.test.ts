import test from 'node:test';
import assert from 'node:assert/strict';
import {SocialAPI} from './api';
import {AccountIntentIndex} from './accountIntentIndex';
const a='ynx1'+'a'.repeat(38),b='ynx1'+'b'.repeat(38),key=(account:string)=>`ynx.social.moment.intent.v1.${account}`;
const draft=(account:string)=>JSON.stringify({schemaVersion:1,account,idempotencyKey:'native-moment-'+'a'.repeat(32),text:'Original',visibility:'private',media:[]});
async function fixture(){const data=new Map<string,string>();const storage={read:async(k:string)=>data.get(k)??null,write:async(k:string,v:string)=>{data.set(k,v)},remove:async(k:string)=>{data.delete(k)}};const index=new AccountIntentIndex(storage);await index.bind(a,()=>true).write(key(a),draft(a));await index.bind(b,()=>true).write(key(b),draft(b));return {data,storage,index}}
function bind(api:SocialAPI,account=a){api.useProductSession(async()=>({proof:{account},proofHeader:'controlled-source-fixture'}),account)}
test('confirmation fence survives invalidation and cold local-only resume without another DELETE',async()=>{
 const prior=globalThis.fetch,h=await fixture(),api=new SocialAPI('https://social.example');bind(api);let calls=0,invalidated=false;globalThis.fetch=async()=>{calls++;return new Response('{"deleted":true}',{status:200})};
 api.onPrivateInvalidated=()=>{invalidated=true;assert.equal(JSON.parse(h.data.get(`ynx.social.intent.index.v1.${a}`)!).deleted,true)};
 try{const current=api.authorizationGuard();await h.index.beginDeletion(a,current);await api.deleteAccountReceipt(a,active=>h.index.recordConfirmedDeletion(a,active));assert.equal(invalidated,true);const cold=new AccountIntentIndex(h.storage),localCurrent=api.authorizationGuard();assert.equal((await cold.reviewDeletionRecovery(a,localCurrent))?.state,'confirmed');await cold.resumeCleanup(a,localCurrent);assert.equal(calls,1);assert.equal(h.data.has(key(a)),false);assert.equal(h.data.get(key(b)),draft(b))}finally{globalThis.fetch=prior}
});
test('ambiguous server failure preserves unknown attempt and refuses another server operation',async()=>{
 const prior=globalThis.fetch,h=await fixture(),api=new SocialAPI('https://social.example');bind(api);globalThis.fetch=async()=>new Response('{"error":"media cleanup failed after state commit"}',{status:500});
 try{const current=api.authorizationGuard();await h.index.beginDeletion(a,current);await assert.rejects(api.deleteAccountReceipt(a,active=>h.index.recordConfirmedDeletion(a,active)));const cold=new AccountIntentIndex(h.storage);assert.equal((await cold.reviewDeletionRecovery(a,current))?.state,'unknown');await assert.rejects(cold.beginDeletion(a,current),/do not repeat/);await assert.rejects(cold.resumeCleanup(a,current),/No retained deletion confirmation/);assert.equal(h.data.get(key(a)),draft(a))}finally{globalThis.fetch=prior}
});
test('no fence cannot be silently promoted by local resume',async()=>{const h=await fixture();await assert.rejects(h.index.resumeCleanup(a,()=>true),/No retained deletion confirmation/);assert.equal(h.data.get(key(a)),draft(a));assert.equal(JSON.parse(h.data.get(`ynx.social.intent.index.v1.${a}`)!).deleted,false)});
test('account switch while persisting confirmation preserves new account and stops further cleanup',async()=>{
 const prior=globalThis.fetch,h=await fixture(),api=new SocialAPI('https://social.example');bind(api);const write=h.storage.write;h.storage.write=async(k,v)=>{await write(k,v);if(k===`ynx.social.intent.index.v1.${a}`&&JSON.parse(v).deleted)bind(api,b)};globalThis.fetch=async()=>new Response('{"deleted":true}',{status:200});
 try{await assert.rejects(api.deleteAccountReceipt(a,active=>h.index.recordConfirmedDeletion(a,active)),/changed account/);assert.equal(api.currentProductAccount,b);assert.equal(h.data.get(key(b)),draft(b));assert.equal(h.data.get(key(a)),draft(a));assert.equal((await new AccountIntentIndex(h.storage).reviewDeletionRecovery(a,()=>true))?.state,'confirmed')}finally{globalThis.fetch=prior}
});
