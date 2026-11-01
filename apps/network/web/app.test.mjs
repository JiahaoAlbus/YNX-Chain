import './shell.test.mjs';
import './i18n.test.mjs';
import './overview.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,settle,A,B,R1,R2,view,record,htmlIDs} from './test-support.mjs';

const historical=receipt=>({historical:true,authority:false,receipt});
const list=receipts=>({classification:'historical-local-projection',authority:false,receipts});
const native={native:{version:'fixture',id:'native-self',code:'OK',peer:{uid:501,pid:123,credentialSource:'fixture-Xucred',nativeIPCVerified:true,browserIdentityVerified:false},result:{status:{service:'fixture-native'}}},browserIdentityVerified:false,note:'Self-client only.'};

test('T-P09 client actual HTML bindings exist; protected actions wait for status handshake',async()=>{
 const e=environment({pendingStatus:true});assert.equal(e.node('lookup-button').disabled,true);assert.equal(e.node('native-refresh').disabled,true);assert.equal(e.requests.length,1);
 e.take('/api/status').resolve({paired:true,callerOsIdentityVerified:false,anchorConfigured:false});await settle();
 assert.equal(e.node('lookup-button').disabled,false);assert.equal(e.node('pair-form').hidden,true);assert.equal(htmlIDs.size>30,true);
});
test('T-P09-02 tx edits and failed replacement never display old verified evidence',async()=>{
 const e=environment();await settle();const first=e.emit('lookup-form','submit');const request=e.take('/api/client-receipt');assert.deepEqual(JSON.parse(request.options.body),{txId:A});request.resolve(record());await first;
 assert.equal(e.node('level-tag').textContent,'INCLUSION_VERIFIED');assert.equal(e.node('meta-tx').textContent,A);
 e.node('tx-id').value=B;e.emit('tx-id','input');assert.equal(e.node('level-tag').textContent,'尚未查询');assert.equal(e.node('evidence-meta').hidden,true);
 const second=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve({error:'RPC_HTTP_ERROR'},502);await second;
 assert.equal(e.node('level-tag').textContent,'尚未查询');assert.equal(e.node('meta-tx').textContent,'');assert.equal(e.node('raw-panel').hidden,true);
});
test('T-P09-02 late changed tx and older same-tx request cannot replace current evidence',async()=>{
 const e=environment();await settle();const old=e.emit('lookup-form','submit'),late=e.take('/api/client-receipt');e.node('tx-id').value=B;e.emit('tx-id','input');assert.equal(late.options.signal.aborted,true);
 const current=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(record(B,'RPC_ONLY'));await current;late.resolve(record(A));await old;
 assert.equal(e.node('meta-tx').textContent,B);assert.equal(e.node('level-tag').textContent,'RPC_ONLY');
 const same1=e.emit('lookup-form','submit'),sameOld=e.take('/api/client-receipt');const same2=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(record(B,'RPC_ONLY'));await same2;sameOld.resolve(record(B));await same1;assert.equal(e.node('level-tag').textContent,'RPC_ONLY');
});
test('T-P09-02 proof import binds tx and failed import clears prior data',async()=>{
 const e=environment();await settle();e.node('proof-file').files=[{name:'proof.json',size:10,text:async()=>'{"source":"fixture"}'}];const job=e.emit('proof-file','change');await settle();e.take('/api/verify').resolve(view(B));await job;
 assert.equal(e.node('evidence-meta').hidden,true);assert.match(e.node('notice').textContent,/RECEIPT_TX_MISMATCH/);
 const first=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(record());await first;e.node('proof-file').files=[{name:'broken.json',size:5,text:async()=>'{bad'}];await e.emit('proof-file','change');assert.equal(e.node('level-tag').textContent,'尚未查询');assert.equal(e.node('raw-report').textContent,'');
});
test('T-P09-03 revoke/expiry abort all in-flight channels and prevent delayed publication',async()=>{
 const e=environment({autoConnected:false});await settle();const node=e.take('/api/node-report'),ipc=e.take('/api/native-status'),history=e.take('/api/receipts');const old=e.emit('lookup-form','submit'),proof=e.take('/api/client-receipt');const revoke=e.emit('revoke','click');
 for(const pending of [node,ipc,history,proof])assert.equal(pending.options.signal.aborted,true);
 e.take('/api/revoke').resolve({revoked:true});await revoke;proof.resolve(record());node.resolve({classification:'RPC_ONLY',source:'late',reports:{}});ipc.resolve(native);history.resolve(list([{receiptId:R1,txId:A,observedAt:'now',reportedLevel:'STATE_VERIFIED'}]));await old;await settle();
 assert.equal(e.node('evidence-meta').hidden,true);assert.equal(e.node('lookup-button').disabled,true);assert.equal(e.node('receipt-list').children.length,0);assert.equal(e.node('native-raw').textContent,'');assert.equal(e.node('node-source').textContent,'');
 const e2=environment();await settle();const job=e2.emit('lookup-form','submit');e2.take('/api/client-receipt').resolve({error:'PAIRING_REQUIRED'},401);await job;assert.equal(e2.node('evidence-meta').hidden,true);assert.equal(e2.node('lookup-button').disabled,true);assert.match(e2.node('pair-state').textContent,/过期/);
});
test('T-P09 full pair->node/proof/native->saved historical receipt->revoke flow',async()=>{
 const e=environment({ticket:false,autoConnected:false});e.node('pair-code').value='one-use-local-code';const paired=e.emit('pair-form','submit');e.take('/api/pair/challenge').resolve({challenge:'one-use-challenge'});await settle();const pair=e.take('/api/pair');assert.deepEqual(JSON.parse(pair.options.body),{challenge:'one-use-challenge',code:'one-use-local-code'});pair.resolve({ticket:'fresh-ticket',expires:'2099-01-01T00:00:00Z'});await settle();
 e.take('/api/node-report').resolve({classification:'RPC_ONLY',source:'fixed-rpc',reports:{status:{status:'reported',source:'rpc/status',data:{height:12}},latestBlock:{status:'unavailable',source:'rpc/block',code:'STATUS_HEIGHT_NOT_SUPPLIED'},validators:{status:'reported',source:'rpc/validators',data:{validators:[]}}}});e.take('/api/native-status').resolve(native);e.take('/api/receipts').resolve(list([]));await paired;
 assert.equal(e.node('pair-code').value,'');assert.match(e.node('node-state').textContent,/2\/3/);assert.match(e.node('node-latestBlock-state').textContent,/STATUS_HEIGHT_NOT_SUPPLIED/);assert.match(e.node('native-peer').textContent,/UID 501/);assert.match(e.node('native-note').textContent,/浏览器 OS 身份：未验证/);
 const lookup=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(record(A,'INCLUSION_VERIFIED',{view:view(A,'INCLUSION_VERIFIED',{abciResultVerified:true,executionOutcome:'partial',abciExecutionCode:'0',selectedMemberResultVerified:true,selectedMemberOutcome:'rejected',fundsVerified:false})}));await settle();e.take('/api/receipts').resolve(list([{receiptId:R1,txId:A,observedAt:'2026-10-31T10:00:00Z',reportedLevel:'INCLUSION_VERIFIED'}]));await lookup;
 assert.match(e.node('execution-result').textContent,/partial/);assert.match(e.node('member-result').textContent,/rejected/);assert.match(e.node('funds-result').textContent,/尚未验证/);assert.equal(e.node('receipt-list').children.length,1);
 const reopen=e.node('receipt-list').children[0].emit('click');e.take('/api/receipt').resolve(historical(record()));await reopen;assert.match(e.node('level-tag').textContent,/历史记录/);assert.equal(e.rows.some(row=>row.classList.contains('reached')),false);assert.match(e.node('meta-level').textContent,/当前未重新核验/);assert.match(e.node('funds-result').textContent,/不证明当前/);
 const revoke=e.emit('revoke','click');e.take('/api/revoke').resolve({revoked:true});await revoke;assert.equal(e.storage.has('ynxNetworkTicket'),false);assert.equal(e.node('lookup-button').disabled,true);
});
test('T-P09 proof source unavailable stays explicit RPC_ONLY without hidden tx report success',async()=>{
 const e=environment();await settle();const lookup=e.emit('lookup-form','submit');const snapshot=record(A,'RPC_ONLY',{reportCollection:{status:'unavailable',code:'RPC_HTTP_ERROR',source:'rpc/tx'},proofCollection:{status:'unavailable',code:'PROOF_NOT_SUPPLIED',source:'rpc/proof'}});delete snapshot.report;e.take('/api/client-receipt').resolve(snapshot);await lookup;
 assert.equal(e.node('level-tag').textContent,'RPC_ONLY');assert.match(e.node('collection-proof').textContent,/PROOF_NOT_SUPPLIED/);assert.match(e.node('collection-report').textContent,/RPC_HTTP_ERROR/);assert.equal(e.node('raw-panel').hidden,true);assert.equal(e.node('raw-report').textContent,'');assert.match(e.node('execution-result').textContent,/尚未验证/);
});
test('T-P09 historical authority/ID/tx mismatches cannot restore a current level',async()=>{
 for(const [kind,body]of [['authority',{historical:true,authority:true,receipt:record()}],['id',historical(record(A,'INCLUSION_VERIFIED',{receiptId:R2}))],['tx',historical(record(A,'INCLUSION_VERIFIED',{view:view(B)}))]]){
  const e=environment();await settle();e.node('receipt-id').value=R1;const open=e.emit('history-form','submit');e.take('/api/receipt').resolve(body);await open;assert.equal(e.node('evidence-meta').hidden,true,kind);assert.equal(e.node('level-tag').textContent,'尚未查询',kind);
 }
});
test('T-P09 helper restart rejects stored ticket; fresh pairing reads original saved receipt',async()=>{
 const storage=new Map([['ynxNetworkTicket','previous-helper-ticket']]);const e=environment({storage,pendingStatus:true,autoConnected:false});assert.equal(e.node('lookup-button').disabled,true);e.take('/api/status').resolve({error:'PAIRING_REQUIRED'},401);await settle();assert.equal(storage.has('ynxNetworkTicket'),false);assert.equal(e.requests.length,0);
 e.node('pair-code').value='current-helper-code';const pair=e.emit('pair-form','submit');e.take('/api/pair/challenge').resolve({challenge:'current'});await settle();e.take('/api/pair').resolve({ticket:'new-helper-ticket'});await settle();e.take('/api/status').resolve({paired:true,callerOsIdentityVerified:false});await settle();e.take('/api/node-report').resolve({classification:'RPC_ONLY',reports:{status:{status:'unavailable'},latestBlock:{status:'unavailable'},validators:{status:'unavailable'}}});e.take('/api/native-status').resolve({native:null,browserIdentityVerified:false,code:'NATIVE_UNAVAILABLE'});e.take('/api/receipts').resolve(list([{receiptId:R1,txId:A,observedAt:'2026-10-31T10:00:00Z',reportedLevel:'INCLUSION_VERIFIED'}]));await pair;
 const saved=e.node('receipt-list').children[0].emit('click');const request=e.take('/api/receipt');assert.equal(request.options.headers.Authorization,'Bearer new-helper-ticket');request.resolve(historical(record()));await saved;assert.match(e.node('level-tag').textContent,/历史/);assert.equal(e.rows.some(r=>r.classList.contains('reached')),false);
});
test('T-P09 superseded historical load, bad proof flags and native browser claims fail closed',async()=>{
 const e=environment();await settle();e.node('receipt-id').value=R1;const history=e.emit('history-form','submit'),late=e.take('/api/receipt');e.node('tx-id').value=B;e.emit('tx-id','input');late.resolve(historical(record()));await history;assert.equal(e.node('tx-id').value,B);assert.equal(e.node('evidence-meta').hidden,true);
 const lookup=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(record(B,'RPC_ONLY',{view:view(B,'RPC_ONLY',{abciResultVerified:true,executionOutcome:'succeeded'})}));await lookup;assert.equal(e.node('evidence-meta').hidden,true);assert.match(e.node('notice').textContent,/INVALID_PROOF_FLAGS/);
 e.manual('/api/native-status');const refresh=e.emit('native-refresh','click');e.take('/api/native-status').resolve({...native,browserIdentityVerified:true});await refresh;assert.match(e.node('native-state').textContent,/未取得/);assert.equal(e.node('native-raw').textContent,'');
});
test('T-P09 history pagination and stale list refresh preserve receipt IDs without granting authority',async()=>{
 const e=environment();await settle();const rows=Array.from({length:21},(_,i)=>({receiptId:(i+1).toString(16).padStart(64,'0'),txId:A,observedAt:'2026-10-31T10:00:00Z',reportedLevel:'INCLUSION_VERIFIED'}));e.manual('/api/receipts');const one=e.emit('history-refresh','click'),late=e.take('/api/receipts');const two=e.emit('history-refresh','click');e.take('/api/receipts').resolve(list(rows));await two;late.resolve(list([]));await one;
 assert.equal(e.node('receipt-list').children.length,20);assert.match(e.node('history-page').textContent,/1\/2/);await e.emit('history-next','click');assert.equal(e.node('receipt-list').children.length,1);assert.match(e.node('history-page').textContent,/2\/2/);assert.equal(e.node('history-next').disabled,true);assert.equal(e.node('evidence-meta').hidden,true);
});
test('T-P09 local ticket expiry clears protected results and late responses',async()=>{
 const e=environment({ticket:false});e.node('pair-code').value='code';const pair=e.emit('pair-form','submit');e.take('/api/pair/challenge').resolve({challenge:'challenge'});await settle();e.take('/api/pair').resolve({ticket:'timer-ticket',expires:'2099-01-01T00:00:00Z'});await pair;assert.equal(e.timers.size,1);
 const job=e.emit('lookup-form','submit'),late=e.take('/api/client-receipt');e.fireTimers();late.resolve(record());await job;assert.equal(e.node('lookup-button').disabled,true);assert.equal(e.node('evidence-meta').hidden,true);assert.equal(e.storage.has('ynxNetworkTicket'),false);
});

test('T-P09 stale previous-session 401 cannot erase a fresh confirmed ticket',async()=>{
 const e=environment({ticket:'old-ticket',pendingStatus:true});const old=e.take('/api/status');e.node('pair-code').value='new-code';const pair=e.emit('pair-form','submit');assert.equal(old.options.signal.aborted,true);e.take('/api/pair/challenge').resolve({challenge:'new'});await settle();e.take('/api/pair').resolve({ticket:'fresh'});await settle();e.take('/api/status').resolve({paired:true,callerOsIdentityVerified:false});await pair;old.resolve({error:'PAIRING_REQUIRED'},401);await settle();assert.equal(e.storage.get('ynxNetworkTicket'),'fresh');assert.equal(e.node('lookup-button').disabled,false);
});
test('T-P09 no false pair-complete after a protected auto-refresh rejects the new ticket',async()=>{
 const e=environment({ticket:false,autoConnected:false});e.node('pair-code').value='code';const pair=e.emit('pair-form','submit');e.take('/api/pair/challenge').resolve({challenge:'new'});await settle();e.take('/api/pair').resolve({ticket:'soon-expired'});await settle();e.take('/api/node-report').resolve({error:'PAIRING_REQUIRED'},401);e.take('/api/native-status').resolve(native);e.take('/api/receipts').resolve(list([]));await pair;assert.equal(e.storage.has('ynxNetworkTicket'),false);assert.equal(e.node('lookup-button').disabled,true);assert.doesNotMatch(e.node('notice').textContent,/配对完成/);
});
test('T-P09 old historical STATE label is plain metadata while live unsupported state is rejected',async()=>{
 const e=environment();await settle();const lookup=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(record(A,'STATE_VERIFIED',{view:view(A,'STATE_VERIFIED',{fundsVerified:false})}));await lookup;assert.equal(e.node('evidence-meta').hidden,true);assert.match(e.node('notice').textContent,/STATE_NOT_PROVEN/);
 e.node('receipt-id').value=R1;const reopen=e.emit('history-form','submit');e.take('/api/receipt').resolve(historical(record(A,'STATE_VERIFIED')));await reopen;assert.match(e.node('level-tag').textContent,/历史记录 · STATE_VERIFIED/);assert.equal(e.rows.some(row=>row.classList.contains('reached')),false);assert.match(e.node('funds-result').textContent,/不证明当前/);
});
test('T-P09 node refresh drops older reports and clears raw data on current failure',async()=>{
 const e=environment();await settle();e.manual('/api/node-report');const first=e.emit('node-refresh','click'),late=e.take('/api/node-report');const second=e.emit('node-refresh','click');e.take('/api/node-report').resolve({classification:'RPC_ONLY',source:'new-source',reports:{status:{status:'reported',source:'new/status',data:{height:14}},latestBlock:{status:'unavailable',code:'STATUS_HEIGHT_NOT_SUPPLIED'},validators:{status:'unavailable'}}});await second;late.resolve({classification:'RPC_ONLY',source:'old-source',reports:{status:{status:'reported',data:{height:13}},latestBlock:{status:'unavailable'},validators:{status:'unavailable'}}});await first;assert.equal(e.node('node-source').textContent,'new-source');assert.match(e.node('node-status-raw').textContent,/14/);
 const failed=e.emit('node-refresh','click');e.take('/api/node-report').resolve({error:'RPC_UNAVAILABLE'},502);await failed;assert.equal(e.node('node-status-raw').textContent,'');assert.match(e.node('node-state').textContent,/未完成/);
});

test('T-P09 exact reportText survives large numeric lexical bytes in live and original history',async()=>{
 const raw=' { "hash": "'+A+'", "amount":9007199254740993, "nonce":18446744073709551615 }\n';
 const snapshot=record(A,'RPC_ONLY',{reportText:raw,report:{hash:A,amount:9007199254740992}});const e=environment();await settle();const lookup=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(snapshot);await lookup;
 assert.equal(e.node('raw-report').textContent,raw);assert.match(e.node('raw-report').textContent,/9007199254740993/);assert.match(e.node('raw-label').textContent,/原始/);assert.equal(e.node('level-tag').textContent,'RPC_ONLY');
 e.node('receipt-id').value=R1;const open=e.emit('history-form','submit');e.take('/api/receipt').resolve(historical(snapshot));await open;assert.equal(e.node('raw-report').textContent,raw);assert.match(e.node('raw-label').textContent,/历史快照/);assert.equal(e.rows.some(r=>r.classList.contains('reached')),false);
});
test('T-P09 back-forward restored page discards active proof and re-handshakes before data reads',async()=>{
 const e=environment();await settle();const lookup=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(record());await lookup;assert.equal(e.node('level-tag').textContent,'INCLUSION_VERIFIED');
 e.pageshow();assert.equal(e.node('evidence-meta').hidden,true);assert.equal(e.node('lookup-button').disabled,true);await settle();assert.equal(e.node('lookup-button').disabled,false);assert.equal(e.node('level-tag').textContent,'尚未查询');assert.equal(e.rows.some(row=>row.classList.contains('reached')),false);
});

test('T-P09 pair background completion never overwrites a newer receipt notice',async(t)=>{
 for(const mode of ['historical','new-lookup'])await t.test(mode,async()=>{
  const e=environment({ticket:false,autoConnected:false});e.node('pair-code').value='one-use-code';
  const pairing=e.emit('pair-form','submit');e.take('/api/pair/challenge').resolve({challenge:'challenge'});await settle();e.take('/api/pair').resolve({ticket:'fresh-ticket'});await settle();
  const slowNode=e.take('/api/node-report');e.take('/api/native-status').resolve(native);e.take('/api/receipts').resolve(list([{receiptId:R1,txId:A,observedAt:'2026-10-31T10:00:00Z',reportedLevel:'RPC_ONLY'}]));await settle();
  assert.equal(e.node('lookup-button').disabled,false);
  let lookup;
  if(mode==='historical'){
   const open=e.node('receipt-list').children[0].emit('click');e.take('/api/receipt').resolve(historical(record(A,'RPC_ONLY')));await open;assert.match(e.node('notice').textContent,/历史/);
  }else{
   lookup=e.emit('lookup-form','submit');assert.match(e.node('notice').textContent,/正在读取/);
  }
  const currentNotice=e.node('notice').textContent;
  slowNode.resolve({classification:'RPC_ONLY',source:'slow-source',reports:{status:{status:'unavailable'},latestBlock:{status:'unavailable'},validators:{status:'unavailable'}}});await pairing;
  assert.equal(e.node('notice').textContent,currentNotice,'old pair completion replaced the current receipt notice');
  if(mode==='historical'){assert.match(e.node('level-tag').textContent,/历史记录/);assert.equal(e.rows.some(row=>row.classList.contains('reached')),false);}
  else{e.take('/api/client-receipt').resolve(record(A,'RPC_ONLY'));await settle();e.take('/api/receipts').resolve(list([]));await lookup;}
 });
});


test('designed client publishes only accepted readonly projections and clears export on tx edits',async()=>{
 const e=environment();await settle();
 const confirmed=e.uiEvents.find(event=>event.channel==='status');assert.equal(confirmed.value.paired,true);
 assert.equal(Object.hasOwn(confirmed.value,'ticket'),false);assert.equal(Object.hasOwn(confirmed.value,'code'),false);
 const lookup=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(record());await lookup;
 assert.equal(e.uiEvents.at(-1).channel,'receipt');assert.equal(e.uiEvents.at(-1).value.record.receiptId,R1);
 e.node('tx-id').value=B;e.emit('tx-id','input');assert.equal(e.uiEvents.filter(event=>event.channel==='receipt').at(-1).value,null);
 assert.equal(e.uiEvents.at(-1).channel,'notice');assert.match(e.uiEvents.at(-1).value.key,/交易已更改/);
 const bad=e.emit('lookup-form','submit');e.take('/api/client-receipt').resolve(record(A));await bad;
 assert.equal(e.uiEvents.filter(event=>event.channel==='receipt'&&event.value?.record.txId===B).length,0);
});
test('designed history filter stays local and cannot turn old verified labels into current proof',async()=>{
 const e=environment({autoConnected:false});await settle();e.take('/api/node-report').resolve({classification:'RPC_ONLY',reports:{status:{status:'unavailable'},latestBlock:{status:'unavailable'},validators:{status:'unavailable'}}});e.take('/api/native-status').resolve(native);
 e.take('/api/receipts').resolve(list([{receiptId:R1,txId:A,observedAt:'2026-10-31T10:00:00Z',reportedLevel:'RPC_ONLY'},{receiptId:R2,txId:B,observedAt:'2026-10-31T11:00:00Z',reportedLevel:'INCLUSION_VERIFIED'}]));await settle();
 const before=e.requests.length;e.client.setHistoryFilter('verified');assert.equal(e.node('receipt-list').children.length,1);assert.match(e.node('receipt-list').children[0].textContent,/INCLUSION_VERIFIED/);assert.equal(e.requests.length,before);assert.equal(e.rows.some(row=>row.classList.contains('reached')),false);
 e.client.setHistoryFilter('RPC_ONLY');assert.equal(e.node('receipt-list').children.length,1);assert.match(e.node('receipt-list').children[0].textContent,/RPC_ONLY/);
 e.client.setHistoryFilter('all');assert.equal(e.node('receipt-list').children.length,2);
});

test('manual history refresh controls recover after success and source failure',async()=>{
 const e=environment();await settle();e.manual('/api/receipts');
 for(const status of [200,502]){const job=e.emit('history-refresh','click');const busy=e.node('history-refresh').disabled;e.take('/api/receipts').resolve(status===200?list([]):{error:'RPC_HTTP_ERROR'},status);await job;assert.equal(e.node('history-refresh').disabled,false,'completed history read must not leave refresh disabled');assert.equal(busy,true,'pending history read must disable its refresh');}
});
test('manual native refresh controls disable only during the current read',async()=>{
 const e=environment();await settle();e.manual('/api/native-status');const job=e.emit('native-refresh','click');const busy=e.node('native-refresh').disabled;assert.equal(e.node('participation-refresh').disabled,true);assert.equal(e.node('resource-refresh').disabled,true);e.take('/api/native-status').resolve(native);await job;assert.equal(busy,true);assert.equal(e.node('native-refresh').disabled,false);assert.equal(e.node('participation-refresh').disabled,false);assert.equal(e.node('resource-refresh').disabled,false);
});
test('manual node refresh controls disable only during the current read',async()=>{
 const e=environment();await settle();e.manual('/api/node-report');const job=e.emit('node-refresh','click');const busy=e.node('node-refresh').disabled;assert.equal(e.node('overview-refresh').disabled,true);e.take('/api/node-report').resolve({classification:'RPC_ONLY',reports:{status:{status:'unavailable'},latestBlock:{status:'unavailable'},validators:{status:'unavailable'}}});await job;assert.equal(busy,true);assert.equal(e.node('node-refresh').disabled,false);assert.equal(e.node('overview-refresh').disabled,false);
});

test('native read failure publishes unavailable rather than leaving local module displays unread',async()=>{
 const e=environment();await settle();e.manual('/api/native-status');const job=e.emit('resource-refresh','click');assert.equal(e.node('participation-refresh').disabled,true);e.take('/api/native-status').resolve({error:'NATIVE_UNAVAILABLE'},503);await job;const event=e.uiEvents.filter(event=>event.channel==='native').at(-1);assert.equal(event.value.code,'NATIVE_UNAVAILABLE');assert.equal(event.value.native,null);assert.equal(event.value.browserIdentityVerified,false);assert.equal(e.node('resource-refresh').disabled,false);
});

test('foreground refresh is bounded, does not overlap and never re-pairs an expired session',async()=>{
 const e=environment({intervals:true});await settle();await settle();assert.equal(e.intervals.length,1);assert.equal(e.intervals[0].ms,15000);e.manual('/api/node-report');
 e.tick();assert.equal(e.requests.length,1);e.tick();assert.equal(e.requests.length,1);e.take('/api/node-report').resolve({classification:'RPC_ONLY',reports:{status:{status:'unavailable'},latestBlock:{status:'unavailable'},validators:{status:'unavailable'}}});await settle();
 e.visibility('hidden');e.tick();assert.equal(e.requests.length,0);e.visibility('visible');assert.equal(e.requests.length,1);e.take('/api/node-report').resolve({error:'SESSION_EXPIRED'},401);await settle();e.tick();assert.equal(e.requests.length,0);assert.equal(e.storage.has('ynxNetworkTicket'),false);assert.equal(e.uiEvents.filter(x=>x.channel==='networkClock').length>0,true);
});
test('pair denial is visible to the active shell and retains no session',async()=>{
 const e=environment({ticket:false});e.node('pair-code').value='bad-code';const job=e.emit('pair-form','submit');e.take('/api/pair/challenge').resolve({challenge:'c'});await settle();e.take('/api/pair').resolve({error:'APPROVAL_DENIED'},403);await job;const notice=e.uiEvents.filter(x=>x.channel==='notice').at(-1);assert.equal(notice.value.error,true);assert.match(notice.value.params.error,/APPROVAL_DENIED/);assert.equal(e.storage.has('ynxNetworkTicket'),false);
});
