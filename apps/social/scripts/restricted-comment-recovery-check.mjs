import assert from 'node:assert/strict';
import {recoverIndexedComment} from '../web/matrix/restricted-comment-recovery.mjs';
const sender='@original:fixture.invalid';
const audience={protocol:'ynx-social-audience/v1',kind:'private',revision:'a'.repeat(64),owner:sender,roomId:'!original:fixture.invalid',members:[sender]};
const parent={protocol:'ynx-social-moment/v1',eventId:'$parent',roomId:audience.roomId,revision:audience.revision,owner:sender};
const intent={transactionId:'original_comment_transaction_001',status:'delivery-unknown',text:'Original encrypted comment',selection:{kind:'private'},file:null,comment:{author:sender,parent,index:{eventId:parent.eventId,audience}}};
const index={eventId:'$comment',transactionId:intent.transactionId,parentEventId:parent.eventId,sender,audience};
const decoded={eventId:index.eventId,text:intent.text,attachment:null,parent:null};
const original=JSON.stringify(intent),results=[];
const run=async(name,changes,expected)=>{
  let reads=0,accepted=false;
  try{
    const result=await recoverIndexedComment({intent,expectedSender:sender,guard:()=>{},loadIndexes:async()=>({indexes:[index]}),consumer:{read:async()=>{++reads;return decoded}},...changes});
    assert.equal(result.transactionId,intent.transactionId);accepted=true;
  }catch(error){if(expected)throw error}
  assert.equal(accepted,expected);assert.equal(JSON.stringify(intent),original);
  results.push({name,status:'PASS',accepted,reads,originalIntentRetained:true});
};
await run('confirmed exact original',{},true);
await run('missing original',{loadIndexes:async()=>({indexes:[]})},false);
await run('different parent',{loadIndexes:async()=>({indexes:[{...index,parentEventId:'$different'}]})},false);
await run('different sender',{loadIndexes:async()=>({indexes:[{...index,sender:'@other:fixture.invalid'}]})},false);
await run('different policy',{loadIndexes:async()=>({indexes:[{...index,audience:{...audience,revision:'b'.repeat(64)}}]})},false);
await run('duplicate transaction',{loadIndexes:async()=>({indexes:[index,index]})},false);
await run('different decrypted text',{consumer:{read:async()=>({...decoded,text:'Substituted'})}},false);
await run('revoked during read',{consumer:{read:async()=>{throw new Error('revoked')}}},false);
await run('cyclic pagination',{loadIndexes:async()=>({indexes:[],after:'c'.repeat(64)})},false);
let requests=0;
await run('original on second page',{loadIndexes:async after=>{++requests;return after?{indexes:[index]}:{indexes:[],after:'d'.repeat(64)}}},true);
assert.equal(requests,2);
console.log(JSON.stringify({qualification:'controlled indexes/decryption; read-only recovery, not real Matrix acceptance',pass:results.length,fail:0,skip:0,results},null,2));
