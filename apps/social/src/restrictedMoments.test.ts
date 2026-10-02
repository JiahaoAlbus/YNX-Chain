import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore production JavaScript consumer
import {RestrictedMoments,RESTRICTED_MOMENT_PROTOCOL} from '../web/matrix/restricted-moments.mjs';
function fixture(){
  const audience={protocol:RESTRICTED_MOMENT_PROTOCOL,kind:'contacts',revision:'r1',owner:'@alice:node',roomId:'!room:node',members:['@alice:node','@bob:node']};
  let live=audience,stopped=false;const sent:unknown[][]=[];
  const operation={binding:{userId:audience.owner},client:{
    getRoom:()=>({getMembers:()=>audience.members.map(userId=>({userId,membership:'join'}))}),
    sendMessage:async(...args:unknown[])=>{sent.push(args);return {event_id:'$event'}},
  }};
  const transport={capture:()=>operation,guard:()=>{if(stopped)throw Error('stale session')},assertTrusted:async()=>{},messages:async():Promise<unknown[]>=>[]};
  return {audience,operation,transport,sent,setLive:(value:typeof audience)=>{live=value},stop:()=>{stopped=true},consumer:new RestrictedMoments({transport,authorize:async()=>live})};
}
const transactionId='original_transaction_001';
test('restricted moment uses standard encrypted-room carrier and metadata-only receipt',async()=>{
  const f=fixture();const receipt=await f.consumer.publish({audience:f.audience,text:'private draft',transactionId});
  assert.equal(f.sent.length,1);assert.equal((f.sent[0]![1] as {msgtype:string}).msgtype,'m.text');
  assert.equal('text' in receipt,false);assert.equal(receipt.eventId,'$event');
});
test('relationship revision change during trust preparation blocks sending and retains draft',async()=>{
  const f=fixture();f.transport.assertTrusted=async()=>{f.setLive({...f.audience,revision:'r2'})};
  await assert.rejects(f.consumer.publish({audience:f.audience,text:'retained draft',transactionId}),/Audience changed/);
  assert.equal(f.sent.length,0);assert.equal(f.consumer.pending.get(transactionId).status,'draft');
});
test('account stop during preparation cannot publish old draft',async()=>{
  const f=fixture();f.transport.assertTrusted=async()=>f.stop();
  await assert.rejects(f.consumer.publish({audience:f.audience,text:'old draft',transactionId}),/stale session/);
  assert.equal(f.sent.length,0);
});
test('uncertain delivered write retains exact transaction and refuses audience substitution',async()=>{
  const f=fixture();f.operation.client.sendMessage=async(...args:unknown[])=>{f.sent.push(args);f.setLive({...f.audience,revision:'r2'});return {event_id:'$event'}};
  await assert.rejects(f.consumer.publish({audience:f.audience,text:'original',transactionId}),/Audience changed/);
  assert.equal(f.consumer.pending.get(transactionId).status,'unknown');
  assert.equal(f.consumer.pending.get(transactionId).eventId,'$event');
  await assert.rejects(f.consumer.publish({audience:{...f.audience,revision:'r2'},text:'original',transactionId}),/preserve original/);
  assert.equal(f.sent.length,1);
});

test('concurrent prepare cannot send the same transaction twice',async()=>{
  const f=fixture();let release!:()=>void;
  f.transport.assertTrusted=()=>new Promise<void>(resolve=>{release=resolve});
  const first=f.consumer.publish({audience:f.audience,text:'original',transactionId});
  await assert.rejects(f.consumer.publish({audience:f.audience,text:'original',transactionId}),/already being sent/);
  await Promise.resolve();release();await first;
  assert.equal(f.sent.length,1);
});

test('caller supplied parent receipt alone never authorizes a comment',async()=>{
  const f=fixture();const parent={protocol:RESTRICTED_MOMENT_PROTOCOL,roomId:f.audience.roomId,revision:f.audience.revision,owner:f.audience.owner,eventId:'$forged'};
  await assert.rejects(f.consumer.publish({audience:f.audience,text:'comment',transactionId,parent}),/parent event is unavailable/);
  assert.equal(f.sent.length,0);
});

test('current approved member can comment only on authenticated matching encrypted parent',async()=>{
  const f=fixture();f.operation.binding.userId='@bob:node';
  const parent={protocol:RESTRICTED_MOMENT_PROTOCOL,roomId:f.audience.roomId,revision:f.audience.revision,owner:f.audience.owner,eventId:'$parent'};
  f.transport.messages=async()=>[{id:'$parent',sender:f.audience.owner,encrypted:true,verification:{shieldColour:0},content:{'com.ynx.social.moment':{protocol:RESTRICTED_MOMENT_PROTOCOL,kind:'moment',owner:f.audience.owner,revision:f.audience.revision,audience:'contacts'}}}];
  await f.consumer.publish({audience:f.audience,text:'comment',transactionId,parent});
  assert.deepEqual((f.sent[0]![1] as Record<string,unknown>)['m.relates_to'],{rel_type:'m.reference',event_id:'$parent'});
});
