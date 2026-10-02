import assert from 'node:assert/strict';
import {MatrixEvent} from 'matrix-js-sdk/lib/models/event.js';
import {encryptAttachment} from 'matrix-encrypt-attachment';
import {MatrixSocialTransport} from '../web/matrix/transport.mjs';
import {RestrictedMoments} from '../web/matrix/restricted-moments.mjs';
import {recoverIndexedComment} from '../web/matrix/restricted-comment-recovery.mjs';

const protocol='ynx-social-matrix-moment/v1',owner='@original:fixture.invalid',peer='@member:fixture.invalid',transactionId='original_transaction_123';
const audience={protocol,kind:'private',revision:'a'.repeat(64),roomId:'!original:fixture.invalid',owner,members:[owner]};
const results=[];
const codec=await encryptAttachment(new TextEncoder().encode('Original protected file').buffer);
const attachment={msgtype:'m.file',body:'original.txt',file:{...codec.info,url:'mxc://media.fixture.invalid/original'},info:{size:codec.data.byteLength,mimetype:'text/plain'}};
function event({id='$original',sender=owner,txn=transactionId,text='Original text',audience:expected=audience,parent=null,file=null,status=null,alter=()=>{}}={}){
  const content={msgtype:'m.text',body:text,'com.ynx.social.moment':{protocol,kind:parent?'comment':'moment',audience:expected.kind,revision:expected.revision,owner:expected.owner,author:sender}};
  if(file){content.msgtype='m.file';content.body=file.body;content.file=structuredClone(file.file);content.info=structuredClone(file.info);content['com.ynx.social.moment'].text=text}
  if(parent)content['m.relates_to']={rel_type:'m.reference',event_id:parent};alter(content);
  const sdkEvent=new MatrixEvent({type:'m.room.message',event_id:id,room_id:expected.roomId,sender,content,unsigned:txn?{transaction_id:txn}:{}});
  sdkEvent.makeEncrypted('m.room.encrypted',{algorithm:'m.megolm.v1.aes-sha2',ciphertext:'isolated-sdk-event-fixture-not-runtime'},'isolated-curve-key','isolated-signing-key');
  if(status!==null)sdkEvent.setStatus(status);return sdkEvent;
}
function fixture({events=[event()],expected=audience,actor=owner,onAuthorize=()=>{}}={}){
  const actions=[];let sends=0,uploads=0;
  const transport=new MatrixSocialTransport();
  transport.binding={account:'ynx1'+'a'.repeat(38),userId:actor,deviceId:'original-device',homeserver:'https://hs.fixture.invalid/',accessToken:'isolated-software-qa'};
  transport.client={getRoom:()=>({getMembers:()=>expected.members.map(userId=>({userId,membership:'join'})),getLiveTimeline:()=>({getEvents:()=>events})}),decryptEventIfNeeded:async()=>{},getCrypto:()=>({getEncryptionInfoForEvent:async()=>({shieldColour:0})}),sendMessage:async()=>{sends++;return {event_id:'$original'}},uploadContent:async()=>{uploads++;throw Error('no recovery upload permitted')},stopClient(){}};
  transport.assertTrusted=async()=>{};
  const consumer=new RestrictedMoments({transport,authorize:async(_expected,authorization)=>{actions.push(structuredClone(authorization));await onAuthorize(authorization,transport);return structuredClone(expected)}});
  const intent={status:'delivery-unknown',transactionId,text:'Original text',selection:{kind:expected.kind},audience:structuredClone(expected),file:null};
  return {transport,consumer,intent,actions,counts:()=>({sends,uploads})};
}
async function test(name,run){try{await run();results.push({name,status:'PASS'})}catch(error){results.push({name,status:'FAIL',error:error.message})}}
await test('cold original text remote echo settles index without send/upload',async()=>{const f=fixture();const receipt=await f.consumer.recover(f.intent);assert.equal(receipt.eventId,'$original');assert.equal(receipt.transactionId,transactionId);assert.deepEqual(f.counts(),{sends:0,uploads:0});assert.equal(f.actions.filter(action=>action.action==='index').length,1)});
await test('cold prepared encrypted file settles original descriptor without second upload',async()=>{const f=fixture({events:[event({file:attachment})]});const intent={...f.intent,file:{name:'original.txt',base64:'isolated-original-file'},preparedAttachment:attachment};assert.equal((await f.consumer.recover(intent)).eventId,'$original');assert.deepEqual(f.counts(),{sends:0,uploads:0})});
await test('unindexed comment fallback verifies original parent and settles without resend',async()=>{const expected={...audience,kind:'contacts',members:[owner,peer]},parentEvent=event({id:'$parent',txn:'parent_transaction_123',audience:expected}),commentEvent=event({sender:peer,parent:'$parent',audience:expected});const f=fixture({expected,actor:peer,events:[parentEvent,commentEvent]});const intent={status:'delivery-unknown',transactionId,text:'Original text',selection:{kind:'contacts'},file:null,comment:{author:peer,index:{audience:expected,eventId:'$parent'},parent:{protocol,eventId:'$parent',roomId:expected.roomId,revision:expected.revision,owner}}};const receipt=await recoverIndexedComment({intent,expectedSender:peer,loadIndexes:async()=>({indexes:[]}),consumer:f.consumer,guard:()=>{}});assert.equal(receipt.parentEventId,'$parent');assert.deepEqual(f.counts(),{sends:0,uploads:0})});
await test('missing remote echo remains unknown and never indexes',async()=>{const f=fixture({events:[]});await assert.rejects(f.consumer.recover(f.intent));assert.equal(f.actions.some(action=>action.action==='index'),false);assert.deepEqual(f.counts(),{sends:0,uploads:0})});
await test('two same transaction echoes reject ambiguous delivery',async()=>{const f=fixture({events:[event(),event({id:'$duplicate'})]});await assert.rejects(f.consumer.recover(f.intent));assert.equal(f.actions.some(action=>action.action==='index'),false)});
await test('local pending echo cannot settle original transaction',async()=>{const f=fixture({events:[event({status:'sending'})]});await assert.rejects(f.consumer.recover(f.intent));assert.equal(f.actions.some(action=>action.action==='index'),false)});
await test('other sender transaction metadata is not exposed or accepted',async()=>{const f=fixture({events:[event({sender:peer})]});const records=await f.transport.messages(audience.roomId);assert.equal(records[0].transactionId,undefined);await assert.rejects(f.consumer.recover(f.intent))});
await test('original transaction with different body cannot settle',async()=>{const f=fixture({events:[event({text:'Replacement'})]});await assert.rejects(f.consumer.recover(f.intent));assert.equal(f.actions.some(action=>action.action==='index'),false)});
await test('unknown semantic fields cannot settle original content',async()=>{const f=fixture({events:[event({alter:content=>{content['com.ynx.social.moment'].unknown=true}})]});await assert.rejects(f.consumer.recover(f.intent))});
await test('file descriptor substitution cannot settle protected attachment',async()=>{const f=fixture({events:[event({file:{...attachment,body:'replacement.txt'}})]});await assert.rejects(f.consumer.recover({...f.intent,file:{name:'original'},preparedAttachment:attachment}))});
await test('unknown upload without original prepared descriptor remains retained',async()=>{const f=fixture();await assert.rejects(f.consumer.recover({...f.intent,file:{name:'original'}}));assert.equal(f.actions.length,0);assert.deepEqual(f.counts(),{sends:0,uploads:0})});
await test('backend index failure keeps original intent unresolved',async()=>{const f=fixture({onAuthorize:action=>{if(action.action==='index')throw Error('index unavailable')}});await assert.rejects(f.consumer.recover(f.intent));assert.deepEqual(f.counts(),{sends:0,uploads:0});assert.equal(f.intent.status,'delivery-unknown')});
await test('identity changes inside reader await prevent index',async()=>{const f=fixture({onAuthorize:(_action,transport)=>{transport.generation++}});await assert.rejects(f.consumer.recover(f.intent));assert.equal(f.actions.some(action=>action.action==='index'),false)});
await test('revocation inside final read checkpoint cannot return confirmation',async()=>{let indexed=false;const f=fixture({onAuthorize:action=>{if(action.action==='index')indexed=true;else if(indexed)throw Error('revoked')}});await assert.rejects(f.consumer.recover(f.intent));assert.equal(f.intent.status,'delivery-unknown')});
await test('warm send receipt recovery uses original event ID without second send',async()=>{let failIndex=true;const f=fixture({events:[event({txn:null})],onAuthorize:action=>{if(action.action==='index'&&failIndex)throw Error('index response lost')}});await assert.rejects(f.consumer.publish({audience,text:f.intent.text,transactionId}));assert.equal(f.consumer.pending.get(transactionId).eventId,'$original');failIndex=false;await f.consumer.recover(f.intent);assert.deepEqual(f.counts(),{sends:1,uploads:0});assert.equal(f.consumer.pending.size,0)});
console.log(JSON.stringify({qualification:'actual locked MatrixEvent metadata and owned transport/consumer recovery; controlled decrypt/trust/authority, no live HS/public/installed claim',results},null,2));
if(results.some(result=>result.status!=='PASS'))process.exitCode=1;
