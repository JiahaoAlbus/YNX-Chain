import {recoverIndexedComment} from '../web/matrix/restricted-comment-recovery.mjs';
import {RESTRICTED_MOMENT_PROTOCOL as protocol} from '../web/matrix/restricted-moments.mjs';
const sender='@original:fixture.invalid';
function fixture(){const audience={protocol,kind:'private',revision:'a'.repeat(64),owner:sender,roomId:'!original:fixture.invalid',members:[sender]};const parent={protocol,eventId:'$parent',roomId:audience.roomId,revision:audience.revision,owner:sender};const intent={transactionId:'original_comment_transaction_001',status:'delivery-unknown',text:'Original comment',selection:{kind:'private'},file:null,comment:{author:sender,parent,index:{eventId:parent.eventId,audience}}};const index={eventId:'$original-comment',transactionId:intent.transactionId,parentEventId:parent.eventId,sender,audience};return {intent,index,decoded:{eventId:index.eventId,text:intent.text,attachment:null,parent:null}}}
const results=[];
async function check(name,alter,expectedAccept){const f=fixture();let live=true;let options={intent:f.intent,expectedSender:sender,loadIndexes:async()=>({indexes:[f.index]}),consumer:{read:async()=>f.decoded},guard:()=>{if(!live)throw Error('revoked')}};alter(f,options,()=>{live=false});let receipt=null,error=null;try{receipt=await recoverIndexedComment(options)}catch(e){error=e.message}const accepted=receipt!==null;results.push({name,expectedAccept,accepted,status:accepted===expectedAccept?'PASS':'FAIL',receipt,error})}
await check('canonical baseline',()=>{},true);
await check('wrong original parent protocol',(f)=>{f.intent.comment.parent.protocol='substituted-parent/v99'},false);
await check('wrong audience protocol both sides',(f)=>{f.index.audience.protocol='substituted-audience/v99'},false);
await check('malformed confirmed event ID',(f)=>{f.index.eventId='not-a-matrix-event';f.decoded.eventId=f.index.eventId},false);
await check('whitespace-only original body',(f)=>{f.intent.text='   ';f.decoded.text='   '},false);
await check('index identity changes during read await',(f,o)=>{o.consumer.read=async()=>{await Promise.resolve();f.index.eventId='$substituted-comment';f.index.transactionId='different_transaction_001';f.index.parentEventId='$different-parent';f.index.sender='@other:fixture.invalid';return {...f.decoded,eventId:f.index.eventId}}},false);
await check('explicit decoded wrong protocol and type',(f)=>{f.decoded.protocol='unrelated/v99';f.decoded.kind='moment'},false);
await check('last read await revoke',(f,o,revoke)=>{o.consumer.read=async()=>{await Promise.resolve();revoke();return f.decoded}},false);
await check('65 page bound',(f,o)=>{let n=0;o.loadIndexes=async()=>({indexes:[],after:(++n).toString(16).padStart(64,'0')})},false);
await check('duplicate transaction on separate pages',(f,o)=>{let n=0;o.loadIndexes=async()=>++n===1?{indexes:[f.index],after:'f'.repeat(64)}:{indexes:[f.index]}},false);
console.log(JSON.stringify({qualification:'exact source controlled indexes/decryption; canonical original publish contract; no Matrix/send/upload',pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length,skip:0,results},null,2));if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
