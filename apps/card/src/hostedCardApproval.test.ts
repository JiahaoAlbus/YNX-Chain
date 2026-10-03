import {secp256k1} from '@noble/curves/secp256k1.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {cardApplicationDetailsHash,createCardApplicationApprovalRequest,createSignedCardApplicationApproval,cardProviderDetailsHash,walletIdentityFromPublicKey,evmAddressFromYNX,createCardApplicationApprovalReturnURL,type CardApplicationApprovalRequest} from '@ynx-chain/wallet-auth-card-provider-v2';
import {createHostedCardApprovalConsumer} from './hostedCardApproval';
import registry from '../vendor/product-session-registry-09e36b150.json';
import vector from '../testdata/card-provider-v2-test-vector.json';
const at=new Date('2026-09-25T12:00:02.000Z');
// Published, deterministic QA scalar only. Not a user Wallet or business proof.
const qaScalar='01'.repeat(32),qaAccount=walletIdentityFromPublicKey(Buffer.from(secp256k1.getPublicKey(Buffer.from(qaScalar,'hex'),true)).toString('hex'));
const details={...vector.request.details,principalOwner:vector.request.details.principalOwner.startsWith('0x')?evmAddressFromYNX(qaAccount):qaAccount};
const {requestBindingHash:ignoredBinding,...baseChallenge}=vector.request.challenge;
const request=createCardApplicationApprovalRequest(registry,{productId:'card',platform:'web',account:qaAccount,challenge:{...baseChallenge,owner:qaAccount,payloadHash:cardProviderDetailsHash(details)} as unknown as CardApplicationApprovalRequest['challenge'],details:details as unknown as Extract<CardApplicationApprovalRequest,{version:'2'}>['details'],requestId:vector.request.requestId,state:vector.request.state},at);
const qaApproval=createSignedCardApplicationApproval({accountSecret:qaScalar,challenge:request.challenge,details:request.details},at);
const resultURL=createCardApplicationApprovalReturnURL(registry,request,{status:'approved',approval:qaApproval},at);
function setup(){
 const storage=new Map<string,string>(),order:string[]=[];
 let context:{owner:string;contextKey:string}|null={owner:request.account,contextKey:'private-session-device-binding'},time=at;
 let record:Record<string,unknown>={id:request.challenge.applicationId,owner:request.account,details:request.details,status:'APPROVAL_REQUIRED'};
 let response:unknown={kind:'card-application-approval',version:request.version,returnUrl:resultURL};
 let rpc=0,prepare=0;
 const consumer=()=>createHostedCardApprovalConsumer({registry,now:()=>time,context:()=>context,storage:{getItem:async key=>storage.get(key)??null,setItem:async(key,value)=>{order.push('persist');storage.set(key,value)}}});
 const transport={reserveCardApplicationApproval(){order.push('reserve');return Promise.resolve({account:evmAddressFromYNX(qaAccount),assertCurrent(){},async request(_url:string){order.push('rpc');rpc++;assert.equal(JSON.parse([...storage.values()][0]).state,'pending');return response}})}};
 const input={applicationId:request.challenge.applicationId,transport,readRecord:async()=>record,prepare:async()=>{order.push('prepare');prepare++;return request},operationId:'operation-one',resultOperationId:'result-one'};
 return {consumer,input,storage,order,setContext:(next:typeof context)=>{context=next},setTime:(next:Date)=>{time=next},setResponse:(next:unknown)=>{response=next},setRecord:(next:Record<string,unknown>)=>{record=next},counts:()=>({rpc,prepare})};
}
test('exact SDK mirror pin, no Card signing implementation',()=>{const bytes=fs.readFileSync(new URL('../vendor/hosted-wallet-adapter-card-9555.js',import.meta.url));assert.equal(bytes.length,26269);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'d42e9cea979cd370efb55a6a628f838c8fd0f4b4d6d466f93f3d17a357b2f26a')});
test('missing negotiated transport fails before challenge',async()=>{const h=setup();await assert.rejects(h.consumer().review({...h.input,transport:null}),/TRANSPORT_UNAVAILABLE/);assert.deepEqual(h.counts(),{rpc:0,prepare:0})});
test('reserve precedes backend/persistence and canonical public QA proof verifies',async()=>{const h=setup(),result=await h.consumer().review(h.input);assert.equal(h.order[0],'reserve');assert.ok(h.order.indexOf('persist')<h.order.indexOf('rpc'));assert.equal(result.result.status,'approved');assert.equal(result.entry.state,'approved');assert.deepEqual(h.counts(),{rpc:1,prepare:1})});
test('unsigned exact USER_REJECTED cannot authorize submit',async()=>{const h=setup();h.setResponse({kind:'card-application-approval',version:request.version,returnUrl:createCardApplicationApprovalReturnURL(registry,request,{status:'rejected',reason:'USER_REJECTED'},at)});const result=await h.consumer().review(h.input);assert.equal(result.result.status,'rejected');await assert.rejects(h.consumer().beforeSubmit(h.input.applicationId,h.input.readRecord),/APPROVAL_REQUIRED/)});
test('wrong carrier version fails closed',async()=>{const h=setup();h.setResponse({kind:'card-application-approval',version:'1',returnUrl:resultURL});await assert.rejects(h.consumer().review(h.input),/RETURN_INVALID/);assert.equal(JSON.parse([...h.storage.values()][0]).state,'failed')});
test('reload recovery has no Wallet call or automatic submit',async()=>{const h=setup();await h.consumer().review(h.input);assert.equal((await h.consumer().recover(h.input.applicationId,h.input.readRecord))?.result?.status,'approved');assert.ok((await h.consumer().beforeSubmit(h.input.applicationId,h.input.readRecord)).approval.signature);assert.equal(h.counts().rpc,1)});
test('changed backend details fence explicit submit',async()=>{const h=setup();await h.consumer().review(h.input);h.setRecord({id:h.input.applicationId,owner:request.account,details:{...request.details,testSpendingLimitMinor:'999'}});await assert.rejects(h.consumer().beforeSubmit(h.input.applicationId,h.input.readRecord),/RECORD_CHANGED/)});
test('private session/device and per-user isolation',async()=>{const h=setup();await h.consumer().review(h.input);h.setContext({owner:request.account,contextKey:'other-device'});await assert.rejects(h.consumer().recover(h.input.applicationId),/CONTEXT_CHANGED/);h.setContext({owner:'another-owner',contextKey:'other'});assert.equal(await h.consumer().recover(h.input.applicationId),null)});
test('expired saved proof is not replayed',async()=>{const h=setup();await h.consumer().review(h.input);h.setTime(new Date('2026-09-25T12:10:00Z'));await assert.rejects(h.consumer().recover(h.input.applicationId));assert.equal(h.counts().rpc,1)});
test('storage failure sends no approval RPC',async()=>{const h=setup();const c=createHostedCardApprovalConsumer({registry,now:()=>at,context:()=>({owner:request.account,contextKey:'private'}),storage:{getItem:async()=>null,setItem:async()=>{throw Error('STORAGE_FAILED')}}});await assert.rejects(c.review(h.input),/STORAGE_FAILED/);assert.equal(h.counts().rpc,0)});
test('late changed-context result leaves old pending fenced',async()=>{const h=setup();const original=h.input.transport.reserveCardApplicationApproval;h.input.transport.reserveCardApplicationApproval=()=>original().then(reserved=>({...reserved,request:async url=>{h.setContext({owner:request.account,contextKey:'changed'});return reserved.request(url)}}));await assert.rejects(h.consumer().review(h.input),/CONTEXT_CHANGED/);assert.equal(JSON.parse([...h.storage.values()][0]).state,'pending')});
test('callback is bound to exact original pending application',async()=>{const h=setup();await h.consumer().review(h.input);assert.equal((await h.consumer().acceptCallback(h.input.applicationId,resultURL)).result.status,'approved');await assert.rejects(h.consumer().acceptCallback('unrelated',resultURL),/PENDING_REQUIRED/);assert.equal(h.counts().rpc,1)});
test('V1 YNXT application consumes an exact approval separately from Provider V2',async()=>{
 const details={nickname:'Public QA Testnet only',useCase:'unit-test',limitWei:'1000000000000000000',riskAccepted:true as const,termsVersion:'card-testnet-v1' as const};
 const pending=createCardApplicationApprovalRequest(registry,{productId:'card',platform:'web',account:qaAccount,challenge:{...baseChallenge,owner:qaAccount,purpose:'create-testnet-card',payloadHash:cardApplicationDetailsHash(details)},details,requestId:vector.request.requestId,state:vector.request.state},at);
 const signed=createSignedCardApplicationApproval({accountSecret:qaScalar,challenge:pending.challenge,details:pending.details},at),returnUrl=createCardApplicationApprovalReturnURL(registry,pending,{status:'approved',approval:signed},at);
 const saved=new Map<string,string>(),record={id:pending.challenge.applicationId,owner:qaAccount,details,challenge:pending.challenge,status:'APPROVAL_REQUIRED'};
 const consumer=createHostedCardApprovalConsumer({registry,now:()=>at,context:()=>({owner:qaAccount,contextKey:'private-v1-device-proof-context'}),storage:{getItem:async key=>saved.get(key)??null,setItem:async(key,value)=>{saved.set(key,value)}}});
 const result=await consumer.review({applicationId:record.id,operationId:'core-submit-one',resultOperationId:'core-result-one',readRecord:async()=>record,prepare:async()=>pending,transport:{reserveCardApplicationApproval:()=>Promise.resolve({account:evmAddressFromYNX(qaAccount),assertCurrent(){},request:async()=>({kind:'card-application-approval',version:'1',returnUrl})})}});
 assert.equal(result.result.version,'1');assert.equal(result.entry.operationId,'core-submit-one');assert.equal((await consumer.beforeSubmit(record.id,async()=>record)).approval.version,'1');
});
test('new private session requires explicit fresh review and retains the old context without reusing approval',async()=>{
 const h=setup();await h.consumer().review(h.input);h.setContext({owner:request.account,contextKey:'renewed-device-session'});
 const fresh=createCardApplicationApprovalRequest(registry,{productId:'card',platform:'web',account:qaAccount,challenge:{...baseChallenge,owner:qaAccount,payloadHash:cardProviderDetailsHash(details)},details,requestId:'44444444-4444-4444-8444-444444444444',state:'55555555-5555-4555-8555-555555555555'},at);
 h.input.prepare=async()=>fresh;
 // Wallet's old callback is not a response to this newly issued request.
 await assert.rejects(h.consumer().review(h.input));
 const archived=[...h.storage.entries()].find(([key])=>key.includes('.history.'));
 assert.ok(archived);assert.equal(JSON.parse(archived![1]).state,'approved');assert.equal(JSON.parse(archived![1]).contextKey,'private-session-device-binding');
});
test('wrong selected Hosted account cannot prepare a challenge or dispatch approval',async()=>{
 const h=setup(),original=h.input.transport.reserveCardApplicationApproval;
 h.input.transport.reserveCardApplicationApproval=()=>original().then(value=>({...value,account:'0x0000000000000000000000000000000000000002'}));
 await assert.rejects(h.consumer().review(h.input),/ACCOUNT_MISMATCH/);assert.deepEqual(h.counts(),{rpc:0,prepare:0});
});
