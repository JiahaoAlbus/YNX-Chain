import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,settle} from './test-support.mjs';
const A='a'.repeat(64),B='b'.repeat(64),D='d'.repeat(64);
const proposal=id=>({id,input:{summary:'Original proposal '+id[0]+' <script>',scope:'network',proposalType:'parameter',proposer:'original-account'},status:'voting',deposit:'18446744073709551615',eligiblePower:'9007199254740993',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),votes:{}});
const meta=()=>({projectionVersion:'YNX-NETWORK-GOVERNANCE-READ/v1',code:'REPORTED',classification:'RPC_ONLY',reportKind:'governance-registry',authority:false,walletApproval:false,nativeEligibility:false,chainFinality:false,source:'ynx-governance-authoritative-state',version:'ynx-governance-api/v1',asOf:new Date().toISOString(),observedAt:new Date().toISOString(),endpoint:'https://rpc.ynxweb4.com/governance/proposals',responseSHA256:D,numericEncoding:'decimal-strings'});
const list=(ids=[A,B])=>({...meta(),proposals:ids.map(proposal),reportedCount:String(ids.length),returnedCount:String(ids.length),limit:'50',truncated:false});
const detail=id=>({...meta(),endpoint:meta().endpoint+'/'+id,proposal:proposal(id)});
async function loaded(options={}){const e=environment({governance:true,...options});await settle();e.take('/api/governance-proposals').resolve(list());await settle();return e;}
function cleared(e){assert.equal(e.node('governance-fields').children.length,0);assert.equal(e.node('governance-raw').textContent,'');assert.equal(e.node('governance-raw-panel').hidden,true);assert.equal(e.node('governance-raw-panel').open,false);assert.equal(e.node('governance-detail-meta').textContent,'');}

test('governance UI reads actual contract routes with current ticket and renders inert exact detail',async()=>{
 const e=await loaded();assert.equal(e.node('governance-list').children.length,2);assert.match(e.node('governance-list').textContent,/<script>/);assert.match(e.node('governance-meta').textContent,/rpc.ynxweb4.com/);assert.equal(e.node('governance-refresh').disabled,false);
 const action=e.node('governance-list').children[0].emit('click'),r=e.take('/api/governance-proposal');assert.deepEqual(JSON.parse(r.options.body),{id:A});assert.equal(r.options.headers.Authorization,'Bearer ticket');r.resolve(detail(A));await action;
 assert.match(e.node('governance-fields').textContent,/18446744073709551615/);assert.match(e.node('governance-fields').textContent,/9007199254740993/);assert.equal(JSON.parse(e.node('governance-raw').textContent).id,A);assert.equal(e.node('governance-raw-panel').hidden,false);assert.equal(e.requests.some(r=>/sign|submit|vote|prepare/.test(r.path)),false);
});
test('governance UI changed selection and list refresh cannot display an older proposal or restored detail',async()=>{
 const e=await loaded(),first=e.node('governance-list').children[0].emit('click'),old=e.take('/api/governance-proposal');const second=e.node('governance-list').children[1].emit('click'),current=e.take('/api/governance-proposal');assert.equal(old.options.signal.aborted,true);current.resolve(detail(B));await second;old.resolve(detail(A));await first;assert.equal(JSON.parse(e.node('governance-raw').textContent).id,B);
 const refresh=e.emit('governance-refresh','click'),r=e.take('/api/governance-proposals');cleared(e);assert.equal(e.node('governance-list').children.length,0);r.resolve({error:'RPC_UNAVAILABLE'},502);await refresh;cleared(e);assert.match(e.node('governance-state').textContent,/暂时不可用/);
});
test('governance UI rejects mismatched detail and revoked late responses without keeping former fields',async()=>{
 const e=await loaded(),first=e.node('governance-list').children[0].emit('click');e.take('/api/governance-proposal').resolve(detail(B));await first;cleared(e);assert.match(e.node('governance-detail-state').textContent,/响应无效/);
 const next=e.node('governance-list').children[0].emit('click'),late=e.take('/api/governance-proposal'),revoke=e.emit('revoke','click');assert.equal(late.options.signal.aborted,true);e.take('/api/revoke').resolve({revoked:true});await revoke;late.resolve(detail(A));await next;cleared(e);assert.equal(e.node('governance-list').children.length,0);assert.equal(e.node('governance-refresh').disabled,true);
});
test('governance UI local expiry clears stale samples and does not issue an automatic replacement read',async()=>{
 let now=Date.now();class Clock extends Date{static now(){return now;}}
 const e=await loaded({clockDate:Clock}),open=e.node('governance-list').children[0].emit('click');e.take('/api/governance-proposal').resolve(detail(A));await open;assert.equal(e.node('governance-list').children.length,2);now+=61000;e.fireTimers();cleared(e);assert.equal(e.node('governance-list').children.length,0);assert.match(e.node('governance-state').textContent,/已过期/);assert.equal(e.requests.length,0);
});
test('governance UI superseded list and false eligibility never produce proposal actions',async()=>{
 const e=environment({governance:true});await settle();const old=e.take('/api/governance-proposals'),refresh=e.emit('governance-refresh','click'),current=e.take('/api/governance-proposals');current.resolve({...list(),nativeEligibility:true});await refresh;old.resolve(list());await settle();assert.equal(e.node('governance-list').children.length,0);assert.match(e.node('governance-state').textContent,/响应无效/);cleared(e);
});

test('governance UI explicitly copies the selected original ID to a local draft without preparing or submitting',async()=>{
 const e=await loaded(),action=e.node('governance-list').children[0].emit('click');e.take('/api/governance-proposal').resolve(detail(A));await action;assert.equal(e.node('governance-use-proposal').disabled,false);await e.emit('governance-use-proposal','click');assert.equal(e.node('native-part-action').value,'vote');assert.equal(e.node('native-part-target').value,A);assert.equal(e.node('native-part-prepare').disabled,true);assert.equal(e.node('native-part-submit').disabled,true);assert.equal(e.requests.length,0);
});
