import test from 'node:test';
import assert from 'node:assert/strict';
import {NativePayBusinessClient,nativePaySummary,nativePayFailureCode} from './pay-business-client.mjs';
import {runNativePayCLI} from './cli.mjs';

test('late invoice and stale Source responses cannot replace current selection or expose stale private facts',async()=>{
 let finish,live=true;const pay={readInvoice:async(_merchant,id)=>id==='first'?new Promise(r=>finish=r):{invoiceId:id,paidAtoms:'0'}};
 const client=new NativePayBusinessClient({pay,current(){if(!live)throw Object.assign(Error(),{code:'SOURCE_RETIRED'})}});
 const first=client.openInvoice('merchant','first');await client.openInvoice('merchant','second');finish({invoiceId:'first',paidAtoms:'100'});
 await assert.rejects(first,{code:'NATIVE_PAY_SELECTION_CHANGED'});assert.equal(client.snapshot().bill.invoiceId,'second');
 live=false;await assert.rejects(client.openInvoice('merchant','second'),{code:'SOURCE_RETIRED'});assert.equal(client.snapshot().bill,null);
});
test('UNKNOWN recovery uses only retained invoice operation and never a signer or fund submit',async()=>{
 let reads=0,reconciles=0;const hash='0x'+'1'.repeat(64),pay={async readInvoice(){reads++;return {operations:{[hash]:{status:'unknown'}},paidAtoms:'0',termsMember:'not-in-summary'}},async reconcileOperation(_m,_id,original){assert.equal(original,hash);reconciles++}};
 const client=new NativePayBusinessClient({pay,current(){}}),state=await client.recoverInvoice('merchant','invoice',hash);
 assert.equal(state.queryOnly,true);assert.equal(reads,2);assert.equal(reconciles,1);assert.equal(nativePaySummary(state).bill.termsMember,undefined);
 await assert.rejects(client.recoverInvoice('merchant','invoice','0x'+'2'.repeat(64)),{code:'NATIVE_PAY_ORIGINAL_HASH_REQUIRED'});assert.equal(reconciles,1);
});
test('read remains usable with unavailable Main, while approval effects stay explicitly unavailable',async()=>{
 const client=new NativePayBusinessClient({pay:{async readInvoice(){return {paidAtoms:'0'}}},current(){}});
 assert.equal((await client.openInvoice('merchant','invoice')).phase,'ready');
 await assert.rejects(client.reviewPayment('merchant','invoice'),{code:'NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE'});
 await assert.rejects(client.submitPayment('merchant','invoice','original'),{code:'NATIVE_PAY_MAIN_PAY_REVIEW_UNAVAILABLE'});
});
test('generic Core review and a QA approval callback cannot dispatch Pay funds',async()=>{
 let calls=0;
 const main={requestPQTypedAction(){calls++;},requestPQBroadcast(){calls++;},reject(){},transactionSender:{submissions:{intentStore:{async readPQOriginals(){return [];},async unresolvedPreparation(){return false;}}}}};
 const client=new NativePayBusinessClient({main,pay:{merchantTermsReview(){calls++;},readInvoiceIntent(){calls++;},submitSettlement(){calls++;}},current(){},withSubmissionApproval(_ref,send){calls++;return send();}});
 for(const work of [()=>client.submitMerchantTerms('intent','hash'),()=>client.submitPayment('merchant','invoice','hash'),()=>client.submitRefund('merchant','invoice','hash')])await assert.rejects(work(),{code:'NATIVE_PAY_MAIN_PAY_REVIEW_UNAVAILABLE'});
 assert.equal(calls,0);
});
test('Wallet provider Source refusal remains precise instead of numeric 4100',async()=>{
 const error=Object.assign(Error('Source missing'),{code:4100,data:{code:'PQ_PAY_BROADCAST_SOURCE_NOT_SUPPLIED'}});
 assert.equal(nativePayFailureCode(error),'PQ_PAY_BROADCAST_SOURCE_NOT_SUPPLIED');
 const client=new NativePayBusinessClient({pay:{async readInvoice(){throw error;}},current(){}});
 await assert.rejects(client.openInvoice('merchant','invoice'),e=>e===error);
 assert.equal(client.snapshot().reason,'PQ_PAY_BROADCAST_SOURCE_NOT_SUPPLIED');
});
test('normal CLI has no approve/keys/default authority and diagnostics perform no runtime import',async()=>{
 const output=[];assert.equal(await runNativePayCLI(['--diagnose'],{write:s=>output.push(JSON.parse(s))}),0);assert.equal(output[0].submission,false);
 await assert.rejects(runNativePayCLI(['pay-submit','m','i','h']),{code:'NATIVE_PAY_SOURCE_UNAVAILABLE'});
 await assert.rejects(runNativePayCLI(['--runtime','/not-loaded','approve','yes']),{code:'NATIVE_PAY_COMMAND_INVALID'});
});
test('notification final read carries original notification current to the actual dispatch fence',async()=>{
 let reads=0,writes=0,scopeLive=true;
 const client=new NativePayBusinessClient({current(){},
  pay:{async readInvoice(_m,_i,current){reads++;if(reads===2)scopeLive=false;current();writes++;return{merchant:'merchant',invoiceId:'invoice'};},async readInvoiceEvents(_m,_i,current){current();return{events:[]};}},
  readNotificationScope:async()=>({current(){if(!scopeLive)throw Error('NOTIFICATION_SOURCE_RETIRED');}}),
  notificationInbox:{stage(){},pending(){return[];}}});
 await assert.rejects(client.syncNotifications('merchant','invoice'),/NOTIFICATION_SOURCE_RETIRED/);
 assert.equal(reads,2);assert.equal(writes,1);
});
