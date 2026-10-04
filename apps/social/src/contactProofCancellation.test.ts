import test from 'node:test';
import assert from 'node:assert/strict';
import {SocialAPI} from './api';
import {ContactRequestFlow} from './contactRequestFlow';
import type {SessionProof} from './scopedSessionBridge';
const account='ynx1'+'a'.repeat(38),person={id:'sp_'+'a'.repeat(32),handle:'fixture-person',displayName:'Controlled source fixture'};
const proof:SessionProof={proof:{account},proofHeader:'controlled-source-test-only'};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const drain=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('cancel during confirmation proof wait prevents a late request dispatch',async()=>{
 const prior=globalThis.fetch,waiting=deferred<SessionProof>(),started=deferred<void>(),calls:string[]=[];let proofs=0;
 const api=new SocialAPI('https://social.example');api.useProductSession(async()=>{if(++proofs===2){started.resolve();return waiting.promise}return proof},account);
 globalThis.fetch=async url=>{calls.push(String(url));return new Response(JSON.stringify(String(url).endsWith('/preview')?{person}:{operationReturned:true}),{status:200})};
 try{const flow=new ContactRequestFlow(api,async()=>'n'.repeat(16)),review=await flow.preview('handle','fixture-person'),current=api.authorizationGuard();const pending=flow.confirm(review,'Original request').catch(error=>error);await started.promise;flow.cancel();waiting.resolve(proof);assert.ok(await pending instanceof Error);await drain();assert.equal(calls.length,1,'cancelled proof wait dispatched a late contact request');assert.equal(current(),true)}finally{globalThis.fetch=prior}
});
test('cancel during preview proof wait prevents an old preview dispatch',async()=>{
 const prior=globalThis.fetch,waiting=deferred<SessionProof>(),started=deferred<void>();let calls=0;const api=new SocialAPI('https://social.example');api.useProductSession(async()=>{started.resolve();return waiting.promise},account);globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({person}),{status:200})};
 try{const flow=new ContactRequestFlow(api,async()=>'n'.repeat(16)),pending=flow.preview('handle','fixture-person').catch(error=>error);await started.promise;flow.cancel();waiting.resolve(proof);assert.ok(await pending instanceof Error);await drain();assert.equal(calls,0,'cancelled preview dispatched after proof wait')}finally{globalThis.fetch=prior}
});
test('proof rejection after explicit cancellation does not invalidate the retained account',async()=>{
 const prior=globalThis.fetch,waiting=deferred<SessionProof>(),started=deferred<void>();const api=new SocialAPI('https://social.example');api.useProductSession(async()=>{started.resolve();return waiting.promise},account);const current=api.authorizationGuard();globalThis.fetch=async()=>{throw new Error('Unexpected dispatch')};
 try{const flow=new ContactRequestFlow(api,async()=>'n'.repeat(16)),pending=flow.preview('handle','fixture-person').catch(error=>error);await started.promise;flow.cancel();waiting.reject(new Error('Controlled late proof failure'));await pending;await drain();assert.equal(current(),true,'cancelled proof response invalidated the account')}finally{globalThis.fetch=prior}
});
test('ordinary preview and confirmed original message still dispatch with exact target',async()=>{
 const prior=globalThis.fetch,bodies:unknown[]=[];const api=new SocialAPI('https://social.example');api.useProductSession(async()=>proof,account);globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/preview'))return new Response(JSON.stringify({person}),{status:200});bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({operationReturned:true}),{status:200})};
 try{const flow=new ContactRequestFlow(api,async()=>'n'.repeat(16)),review=await flow.preview('handle','fixture-person');await flow.confirm(review,'  Original request  ');assert.deepEqual(bodies,[{source:'handle',value:'fixture-person',idempotencyKey:'native-contact-'+'n'.repeat(16),expectedAccount:person.id,message:'Original request'}]);assert.equal(flow.isCurrent(review),false)}finally{globalThis.fetch=prior}
});
