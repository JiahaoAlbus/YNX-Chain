import assert from 'node:assert/strict';
import {createSocialAudienceHTTPClient} from '../web/matrix/audience-client.mjs';
import {recoverIndexedComment} from '../web/matrix/restricted-comment-recovery.mjs';
const account='ynx1'+'b'.repeat(38),sender='@original:fixture.invalid',protocol='ynx-social-matrix-moment/v1';
const audience={protocol,kind:'private',revision:'a'.repeat(64),roomId:'!original:fixture.invalid',owner:sender,members:[sender]};
const index={audience,eventId:'$parent',transactionId:'original_parent_txn_001',sender};
const parent={protocol,eventId:index.eventId,roomId:audience.roomId,revision:audience.revision,owner:sender};
const intent={status:'delivery-unknown',transactionId:'original_comment_txn_001',text:'Original comment',selection:{kind:'private'},file:null,comment:{author:sender,index,parent}};
const commentIndex={...index,eventId:'$comment',transactionId:intent.transactionId,parentEventId:index.eventId};
const scopes=['social.contacts','social.feed','social.messaging','social.profile'];
function fixture({fetcher,proof}={}){
  const session={current:{status:'connected',session:{scopes}},restore:async()=>({status:'connected',session:{account,scopes}}),proof:async()=>({proofHeader:'controlled-original-proof'}),createSocialAudienceProof:proof??(async({body})=>({body,proofHeader:'controlled-action',introspection:{proofHeader:'controlled-introspection'}}))};
  const client=createSocialAudienceHTTPClient({session,capture:()=>({account}),guard:()=>{},csrfToken:async()=>'controlled-csrf',fetcher:fetcher??(async()=>new Response(JSON.stringify(audience)))});
  return {client,session};
}
const results=[];async function test(name,run){await run();results.push({name,status:'PASS'})}
await test('actual HTTP indexes nonsettling fetch aborted, late index never reaches consumer',async()=>{
  const controller=new AbortController();let release,started,fetchSignal,reads=0;
  const ready=new Promise(resolve=>{started=resolve});
  const f=fixture({fetcher:(_url,options)=>{fetchSignal=options.signal;started();return new Promise(resolve=>{release=resolve})}});
  const originalJSON=JSON.stringify(intent);
  const pending=recoverIndexedComment({intent,expectedSender:sender,guard:()=>{},signal:controller.signal,loadIndexes:(after,options)=>f.client.indexes(after,options),consumer:{read:async()=>{reads++;throw Error('must not read')}}});
  await ready;controller.abort();await assert.rejects(pending);assert.equal(fetchSignal.aborted,true);
  release(new Response(JSON.stringify({indexes:[]})));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(reads,0);assert.equal(JSON.stringify(intent),originalJSON);
});
await test('existing indexed consumer never settles; cancellation rejects without confirmation',async()=>{
  const controller=new AbortController();let release,started;const ready=new Promise(resolve=>{started=resolve});
  const pending=recoverIndexedComment({intent,expectedSender:sender,guard:()=>{},signal:controller.signal,loadIndexes:async()=>({indexes:[commentIndex]}),consumer:{read:()=>{started();return new Promise(resolve=>{release=resolve})}}});
  await ready;controller.abort();await assert.rejects(pending);release({eventId:'$comment',text:intent.text,parent:null,attachment:null});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(intent.status,'delivery-unknown');
});
await test('late shared proof result after cancellation never dispatches authorize REST',async()=>{
  const controller=new AbortController();let release,started,fetches=0;const ready=new Promise(resolve=>{started=resolve});
  const f=fixture({fetcher:async()=>{fetches++;throw Error('must not fetch')},proof:({body})=>{started();return new Promise(resolve=>{release=()=>resolve({body,proofHeader:'controlled-action',introspection:{proofHeader:'controlled-introspection'}})})}});
  const pending=f.client.authorize(audience,{action:'read',transactionId:intent.transactionId},{signal:controller.signal});await ready;controller.abort();await assert.rejects(pending);release();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(fetches,0);
});
await test('nonsettling response JSON participates in the same cancellation',async()=>{
  const controller=new AbortController();let release,started;const ready=new Promise(resolve=>{started=resolve});
  const f=fixture({fetcher:async()=>({ok:true,json:()=>{started();return new Promise(resolve=>{release=resolve})}})});
  const pending=f.client.indexes('',{signal:controller.signal});await ready;controller.abort();await assert.rejects(pending);release({indexes:[]});await new Promise(resolve=>setTimeout(resolve,0));
});
await test('existing indexed original comment still confirms with current guard',async()=>{
  let checks=0;const receipt=await recoverIndexedComment({intent,expectedSender:sender,guard:()=>{checks++},loadIndexes:async()=>({indexes:[commentIndex]}),consumer:{read:async()=>({eventId:'$comment',text:intent.text,parent:null,attachment:null})}});assert.equal(receipt.transactionId,intent.transactionId);assert.ok(checks>=3);
});
console.log(JSON.stringify({qualification:'actual owned HTTP client and recovery helper, controlled current SSO/proof/REST; no live grant or public outage',results},null,2));
