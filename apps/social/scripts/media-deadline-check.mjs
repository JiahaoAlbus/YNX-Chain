import assert from 'node:assert/strict';
import {encryptAttachment} from 'matrix-encrypt-attachment';
import {getHttpUriForMxc} from 'matrix-js-sdk/lib/content-repo.js';
import {MatrixSocialTransport} from '../web/matrix/transport.mjs';
import {RestrictedMoments} from '../web/matrix/restricted-moments.mjs';
import {createBoundedOperation,wipeBytes} from '../web/matrix/bounded-operation.mjs';
const encrypted=await encryptAttachment(new TextEncoder().encode('Original finite media').buffer);
const owner='@original:fixture.invalid',audience={protocol:'ynx-social-matrix-moment/v1',kind:'private',revision:'a'.repeat(64),roomId:'!original:fixture.invalid',owner,members:[owner]};
const index={audience,eventId:'$original',sender:owner,transactionId:'original_transaction_123'};
const content={msgtype:'m.file',body:'original.txt',file:{...encrypted.info,url:'mxc://media.fixture.invalid/original'},'com.ynx.social.moment':{protocol:audience.protocol,kind:'moment',audience:audience.kind,revision:audience.revision,owner,author:owner,text:'Original caption'}};
const results=[];
function fixture(response=null){
  let fetches=0;
  const transport=new MatrixSocialTransport({fetcher:async()=>{fetches++;return response?response():new Response(encrypted.data)}});
  transport.binding={homeserver:'https://hs.fixture.invalid/',accessToken:'isolated-software-qa',userId:owner,deviceId:'original-device'};
  transport.client={mxcUrlToHttp:(uri,...args)=>getHttpUriForMxc(transport.binding.homeserver,uri,...args),getRoom:()=>({getMembers:()=>[{userId:owner,membership:'join'}]}),stopClient(){}};
  transport.messages=async()=>[{id:index.eventId,sender:owner,encrypted:true,verification:{shieldColour:0},content}];
  const consumer=new RestrictedMoments({transport,authorize:async()=>structuredClone(audience)});
  return {transport,consumer,fetches:()=>fetches};
}
async function test(name,run){const detail=await run();results.push({name,status:'PASS',...detail})}
await test('unchanged real 30s timer rejects pending authority and cleans tracked operation',async()=>{
  const f=fixture();let release;const start=performance.now();
  const pending=f.transport.downloadAttachment(content,{revalidate:()=>new Promise(resolve=>{release=resolve})});
  await assert.rejects(pending,error=>error.code==='MATRIX_OPERATION_CANCELLED');
  const elapsedMs=Math.round(performance.now()-start);assert.ok(elapsedMs>=29900&&elapsedMs<35000);assert.equal(f.transport.downloads.size,0);assert.equal(f.fetches(),0);
  release();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.fetches(),0);
  return {elapsedMs,fetches:f.fetches(),tracked:f.transport.downloads.size};
});
await test('stop rejects nonsettling original identity before fetch, late result discarded',async()=>{
  const f=fixture();let release;
  const pending=f.consumer.downloadAttachment(index,content,{validateIdentity:()=>new Promise(resolve=>{release=resolve})});
  f.transport.stop();await assert.rejects(pending);assert.equal(f.transport.downloads.size,0);assert.equal(f.fetches(),0);
  release();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.fetches(),0);
});
await test('abort rejects nonsettling stream reader and releases local handle',async()=>{
  const parent=new AbortController();let started,release,cancelled=false;
  const ready=new Promise(resolve=>{started=resolve});
  const f=fixture(()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:()=>new Promise(resolve=>{release=resolve;started()}),cancel:async()=>{cancelled=true},releaseLock(){}})}}));
  const pending=f.transport.downloadAttachment(content,{signal:parent.signal});await ready;parent.abort();await assert.rejects(pending);
  assert.equal(cancelled,true);assert.equal(f.transport.downloads.size,0);
  const late=new Uint8Array([1,2,3]);release({done:false,value:late});await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual([...late],[0,0,0]);
});
await test('bounded primitive rejects nonsettling codec and wipes late plaintext',async()=>{
  const bounded=createBoundedOperation({timeoutMs:15});let release;
  const pending=bounded.wait(()=>new Promise(resolve=>{release=resolve}),wipeBytes);await assert.rejects(pending);
  const late=new Uint8Array([7,8,9]);release(late.buffer);await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual([...late],[0,0,0]);bounded.dispose();
});
await test('stop rejects pending original recovery authority without sending or clearing intent',async()=>{
  const f=fixture();f.consumer.authorize=()=>new Promise(()=>{});
  const original={status:'delivery-unknown',transactionId:index.transactionId,text:'Original caption',audience,file:null};
  const pending=f.consumer.recover(original);await new Promise(resolve=>setTimeout(resolve,0));f.transport.stop();await assert.rejects(pending);assert.equal(original.status,'delivery-unknown');assert.equal(f.transport.downloads.size,0);
});
console.log(JSON.stringify({qualification:'actual unchanged 30s owned deadline and immediate cancellation; controlled nonsettling callback/stream, no public outage or grant-TTL claim',results},null,2));
