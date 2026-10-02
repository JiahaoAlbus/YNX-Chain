import assert from 'node:assert/strict';
import {encryptAttachment} from 'matrix-encrypt-attachment';
import {getHttpUriForMxc} from 'matrix-js-sdk/lib/content-repo.js';
import {MatrixSocialTransport} from '../web/matrix/transport.mjs';
import {RestrictedMoments} from '../web/matrix/restricted-moments.mjs';
const original=new Uint8Array(512*1024).fill(83),encrypted=await encryptAttachment(original.buffer);
const owner='@original:fixture.invalid',audience={protocol:'ynx-social-matrix-moment/v1',kind:'private',revision:'a'.repeat(64),roomId:'!original:fixture.invalid',owner,members:[owner]};
const index={audience,eventId:'$original',sender:owner,transactionId:'original_transaction_123'};
const content={msgtype:'m.file',body:'original.bin',file:{...encrypted.info,url:'mxc://media.fixture.invalid/original'},'com.ynx.social.moment':{protocol:audience.protocol,kind:'moment',audience:audience.kind,revision:audience.revision,owner,author:owner,text:'Original caption'}};
const results=[];
function fixture(mode='valid'){
  let authorizations=0,identities=0,chunks=0,allowed=true,epoch=1;
  const ciphertext=new Uint8Array(encrypted.data);
  const transport=new MatrixSocialTransport({fetcher:async()=>new Response(new ReadableStream({async pull(controller){
    if(chunks*1024>=ciphertext.byteLength){controller.close();return}
    if(mode==='stale'&&chunks===2)epoch++;
    if(mode==='periodic-revoke'&&chunks===0){await new Promise(resolve=>setTimeout(resolve,5100));allowed=false}
    controller.enqueue(ciphertext.slice(chunks*1024,++chunks*1024));
  }}))});
  transport.binding={homeserver:'https://hs.fixture.invalid/',accessToken:'isolated-software-qa',userId:owner,deviceId:'original-device'};
  transport.client={mxcUrlToHttp:(mxc,...args)=>getHttpUriForMxc(transport.binding.homeserver,mxc,...args),getRoom:()=>({getMembers:()=>[{userId:owner,membership:'join'}]})};
  transport.messages=async()=>[{id:index.eventId,sender:owner,encrypted:true,verification:{shieldColour:0},content}];
  const consumer=new RestrictedMoments({transport,authorize:async()=>{authorizations++;if(authorizations>300)throw Error('controlled existing 300/min budget exceeded');if(!allowed)throw Error('revoked');return structuredClone(audience)}});
  const download=()=>consumer.downloadAttachment(index,content,{assertCurrent:()=>{if(epoch!==1)throw Error('stale view')},validateIdentity:async()=>{identities++;if(!allowed)throw Error('identity revoked')}});
  return {download,counts:()=>({authorizations,identities,chunks})};
}
for(const mode of ['valid','stale','periodic-revoke']){
  const f=fixture(mode);
  if(mode==='valid'){assert.deepEqual(new Uint8Array(await f.download()),original);const counts=f.counts();assert.equal(counts.chunks,512);assert.ok(counts.authorizations<30&&counts.identities<30);results.push({name:'512 real 1KiB chunks decrypt within unchanged controlled 300/min budget',status:'PASS',...counts})}
  else{await assert.rejects(f.download());assert.ok(f.counts().chunks<512);results.push({name:mode==='stale'?'local view guard discards stream immediately without remote roundtrip':'long stream periodic authority check observes revoke before completion',status:'PASS',...f.counts()})}
}
console.log(JSON.stringify({qualification:'actual consumer/transport and locked SDK cipher; controlled existing budget and authority, not a public rate-limit claim',results},null,2));
