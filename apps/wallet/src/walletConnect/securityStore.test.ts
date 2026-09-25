import assert from "node:assert/strict";
import test from "node:test";
import { createWalletConnectRequestReview, createWalletConnectSessionApproval, reviewWalletConnectSessionProposal, WalletConnectRequestReplayStore, type WalletConnectSessionApproval } from "@ynx-chain/wallet-auth";
import { WalletConnectFinalizationUnknownError, WalletConnectSecurityStore } from "./securityStore";
import { WalletConnectRuntime } from "./runtime";
import { persistAndPublishWalletConnectSession } from "./sessionApproval";
import { WalletOperationLifecycle } from "../security/operationLifecycle";

class MemoryStorage{value:string|null=null;async getItem(){return this.value}async setItem(_key:string,value:string){this.value=value}async removeItem(){this.value=null}}
class FailingStorage extends MemoryStorage{fail=false;override async setItem(key:string,value:string){if(this.fail)throw new Error("secure storage unavailable");await super.setItem(key,value)}}
class AmbiguousStorage extends MemoryStorage{throwAfterWrite=false;override async setItem(key:string,value:string){await super.setItem(key,value);if(this.throwAfterWrite)throw new Error("secure storage acknowledgement lost")}}
function gate(){let release!:()=>void,entered!:()=>void;return{wait:new Promise<void>(resolve=>{release=resolve}),entered:new Promise<void>(resolve=>{entered=resolve}),release:()=>release(),notify:()=>entered()}}
class DelayedFinalizationStorage extends MemoryStorage{pause=gate();override async setItem(key:string,value:string){if(this.value!==null&&JSON.parse(this.value).pendingTopics?.length&&JSON.parse(value).pendingTopics?.length===0){this.pause.notify();await this.pause.wait}await super.setItem(key,value)}}
class UncertainFinalizationStorage extends MemoryStorage{mode:"committed"|"pending"="committed";armed=false;failRead=false;override async setItem(key:string,value:string){if(this.armed&&this.value!==null&&JSON.parse(this.value).pendingTopics?.length&&JSON.parse(value).pendingTopics?.length===0){this.armed=false;if(this.mode==="committed")await super.setItem(key,value);this.failRead=true;throw new Error("finalization write acknowledgement lost")}await super.setItem(key,value)}override async getItem(){if(this.failRead){this.failRead=false;throw new Error("secure storage read temporarily unavailable")}return super.getItem()}}
const account=`0x${"1".repeat(40)}`,topic="a".repeat(64),namespaces={eip155:{chains:["eip155:6423"],methods:["eth_accounts"],events:["accountsChanged"],accounts:[`eip155:6423:${account}`]}} as const;
const proposalTime=new Date("2026-09-20T00:00:00.000Z"),proposalSeconds=Math.floor(proposalTime.getTime()/1000);
const proposalReview=reviewWalletConnectSessionProposal({id:1,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{id:1,expiryTimestamp:proposalSeconds+86_400,relays:[{protocol:"irn"}],proposer:{publicKey:"c".repeat(64),metadata:{name:"dApp",description:"test",url:"https://example.com",icons:["https://example.com/icon.png"]}},requiredNamespaces:{eip155:{chains:["eip155:6423"],methods:["eth_accounts"],events:["accountsChanged"]}},optionalNamespaces:{},pairingTopic:"b".repeat(64)}},{account,now:proposalTime});
const approval=createWalletConnectSessionApproval(proposalReview,{approved:true,topic},new Date(proposalTime.getTime()+1_000)) as WalletConnectSessionApproval;
test("cold restart never promotes a staged grant after both cleanup paths fail",async()=>{
  const storage=new FailingStorage(),original=new WalletConnectSecurityStore(storage as any);
  await original.stageSession(approval);
  storage.fail=true;
  await assert.rejects(original.removeSession(topic),/secure storage unavailable/);
  const relayDisconnect=async()=>{throw new Error("Relay unavailable")};
  await assert.rejects(relayDisconnect(),/Relay unavailable/);
  storage.fail=false;
  const restarted=new WalletConnectSecurityStore(storage as any);
  assert.deepEqual(await restarted.pendingSessionTopics(),[topic]);
  assert.equal(await restarted.session(topic),null);
  assert.deepEqual((await restarted.load()).sessions,[]);
  assert.equal(await restarted.reconcileSession(topic,namespaces as any,account),"missing");
  const result=await restarted.reconcileActiveSessions([{topic,namespaces:namespaces as any}],account);
  assert.deepEqual(result.disconnectTopics,[topic]);
  assert.deepEqual(result.prunedTopics,[]);
  await assert.rejects(restarted.reserveRequest({topic,id:1,params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[]}}},account,proposalTime),/no longer authorized/);
  await assert.rejects(restarted.saveSession(approval),/pending session cannot be promoted/);
  assert.deepEqual(await restarted.pendingSessionTopics(),[topic]);
  await restarted.removeSession(topic);
  assert.deepEqual(await restarted.pendingSessionTopics(),[]);
});

test("a fresh SDK runtime quarantines the durable pending topic before serving requests",async()=>{
  const storage=new MemoryStorage(),first=new WalletConnectSecurityStore(storage as any);
  await first.stageSession(approval);
  const restarted=new WalletConnectSecurityStore(storage as any),handlers=new Map<string,(value:any)=>void>(),responses:any[]=[];
  const active={[topic]:{topic,namespaces,peer:{metadata:{name:"dApp",url:"https://example.com"}}}};
  const client={on(event:string,listener:(value:any)=>void){handlers.set(event,listener)},getActiveSessions:()=>active,
    pair:async()=>{},rejectSession:async()=>{},approveSession:async()=>active[topic],
    respondSessionRequest:async(value:any)=>{responses.push(value)},disconnectSession:async()=>{throw new Error("Relay unavailable")}};
  const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any);
  await runtime.start();
  for(const pending of await restarted.pendingSessionTopics())runtime.quarantineSession(pending);
  assert.deepEqual(runtime.snapshot().sessions,[]);
  handlers.get("session_request")!({topic,id:9,params:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(runtime.snapshot().request,null);
  assert.equal(responses[0].response.error.code,5000);
  assert.equal(await restarted.session(topic),null);
});

test("final approval commit readback accepts a lost write acknowledgement",async()=>{
  const storage=new AmbiguousStorage(),store=new WalletConnectSecurityStore(storage as any);
  await store.stageSession(approval);
  storage.throwAfterWrite=true;
  await store.finalizeStagedSession(topic,approval.sessionBinding,()=>{});
  const restarted=new WalletConnectSecurityStore(storage as any);
  assert.deepEqual(await restarted.pendingSessionTopics(),[]);
  assert.equal((await restarted.session(topic))?.sessionBinding,approval.sessionBinding);
});

test("pre-commit lease loss leaves no active grant",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);
  await store.stageSession(approval);
  await assert.rejects(store.finalizeStagedSession(topic,approval.sessionBinding,()=>{throw new Error("account changed")}),/account changed/);
  assert.equal(await new WalletConnectSecurityStore(storage as any).session(topic),null);
  assert.deepEqual(await store.pendingSessionTopics(),[topic]);
});

test("legacy v2 approved sessions remain active when state advances to v3",async()=>{
  const storage=new MemoryStorage();storage.value=JSON.stringify({version:2,sessions:[approval],replay:[],outbox:[]});
  const store=new WalletConnectSecurityStore(storage as any);
  assert.equal((await store.session(topic))?.sessionBinding,approval.sessionBinding);
  await store.saveSession(approval);
  assert.equal(JSON.parse(storage.value!).version,3);
  assert.deepEqual(JSON.parse(storage.value!).pendingTopics,[]);
});

test("unknown finalization remains quarantined until a fresh store resolves committed or pending state",async()=>{
  for(const mode of ["committed","pending"] as const){
    const storage=new UncertainFinalizationStorage();storage.mode=mode;const store=new WalletConnectSecurityStore(storage as any),handlers=new Map<string,(event:any)=>void>();
    const active={[topic]:{topic,namespaces,peer:{metadata:{name:"dApp",url:"https://example.com"}}}};
    const client={on(event:string,handler:(event:any)=>void){handlers.set(event,handler)},getActiveSessions:()=>active,pair:async()=>{},rejectSession:async()=>{},approveSession:async()=>active[topic],respondSessionRequest:async()=>{},disconnectSession:async()=>{throw new Error("Relay unavailable")}};
    const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any);await runtime.start();storage.armed=true;
    await assert.rejects(persistAndPublishWalletConnectSession(runtime,store,approval),WalletConnectFinalizationUnknownError);
    assert.deepEqual(runtime.quarantinedTopics(),[topic]);assert.deepEqual(runtime.snapshot().sessions,[]);
    const restarted=new WalletConnectSecurityStore(storage as any);
    assert.equal((await restarted.session(topic))?.topic??null,mode==="committed"?topic:null);
    assert.deepEqual(await restarted.pendingSessionTopics(),mode==="pending"?[topic]:[]);
    const freshRuntime=new WalletConnectRuntime({projectId:"b".repeat(32)},(async()=>client) as any);await freshRuntime.start();
    for(const pending of await restarted.pendingSessionTopics())freshRuntime.quarantineSession(pending);
    assert.deepEqual(freshRuntime.snapshot().sessions.map(item=>item.topic),mode==="committed"?[topic]:[]);
  }
});

test("lock and account switch during final storage write cannot authorize the new account",async()=>{
  const storage=new DelayedFinalizationStorage(),store=new WalletConnectSecurityStore(storage as any),operations=new WalletOperationLifecycle();
  operations.setAccount("native-account-a");const unlock=operations.scope().begin({requireUnlocked:false});operations.unlock(unlock);unlock.finish();
  await store.stageSession(approval);
  const lease=operations.scope().begin({account:"native-account-a"}),commit=store.finalizeStagedSession(topic,approval.sessionBinding,lease.assert);
  await storage.pause.entered;operations.lock();operations.setAccount("native-account-b");storage.pause.release();await commit;
  assert.throws(lease.assert);lease.finish();
  const restarted=new WalletConnectSecurityStore(storage as any),newAccount=`0x${"2".repeat(40)}`;
  assert.equal(await restarted.reconcileSession(topic,namespaces as any,newAccount),"changed");
  await assert.rejects(restarted.reserveRequest({topic,id:1,params:{}},newAccount,proposalTime),/no longer authorized/);
  const pruned=await restarted.reconcileActiveSessions([{topic,namespaces:namespaces as any}],newAccount);
  assert.deepEqual(pruned.prunedTopics,[topic]);assert.deepEqual(pruned.disconnectTopics,[topic]);
  operations.setAccount("native-account-a");assert.equal(await restarted.session(topic),null);
});
test("session namespace reconciliation keeps exact approval and rejects account or scope drift",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  assert.equal(await store.reconcileSession(topic,namespaces as any,account),"current");
  assert.equal(await store.reconcileSession(topic,{eip155:{...namespaces.eip155,methods:["eth_accounts","eth_sendTransaction"]}} as any,account),"changed");
  assert.equal(await store.reconcileSession(topic,namespaces as any,`0x${"2".repeat(40)}`),"changed");
  await store.removeSession(topic);assert.equal(await store.reconcileSession(topic,namespaces as any,account),"missing");
});

test("full reconciliation catches multiple changed sessions after events were overwritten",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),topic2="e".repeat(64);
  await store.saveSession(approval);
  await store.saveSession({...approval,topic:topic2,sessionBinding:"f".repeat(64)});
  const changed={eip155:{...namespaces.eip155,methods:["eth_accounts","eth_sendTransaction"]}};
  const result=await store.reconcileActiveSessions([{topic,namespaces:changed as any},{topic:topic2,namespaces:changed as any}],account);
  assert.deepEqual(result.disconnectTopics,[topic,topic2]);
  assert.deepEqual(result.prunedTopics,[topic,topic2]);
  assert.deepEqual((await store.load()).sessions,[]);
});

test("full reconciliation prunes approvals for sessions deleted while the UI was closed",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),topic2="e".repeat(64);
  await store.saveSession(approval);
  await store.saveSession({...approval,topic:topic2,sessionBinding:"f".repeat(64)});
  const result=await store.reconcileActiveSessions([{topic,namespaces:namespaces as any}],account);
  assert.deepEqual(result.disconnectTopics,[]);
  assert.deepEqual(result.prunedTopics,[topic2]);
  assert.deepEqual((await store.load()).sessions.map(item=>item.topic),[topic]);
});

test("full reconciliation is bounded to fifty active sessions",async()=>{
  const store=new WalletConnectSecurityStore(new MemoryStorage() as any);
  await assert.rejects(store.reconcileActiveSessions(Array.from({length:51},(_,index)=>({topic:String(index).padStart(64,"0"),namespaces:namespaces as any})),account),/limit exceeded/);
});

test("concurrent session and replay writes are serialized without lost updates",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),other=new WalletConnectSecurityStore(storage as any);
  const replay=new WalletConnectRequestReplayStore([{key:`${topic}:7`,requestDigest:"e".repeat(64),expiresAt:"2099-09-21T00:00:00.000Z",status:"reserved"}]);
  await Promise.all([store.saveSession(approval),other.saveReplay(replay)]);
  const loaded=await store.load();
  assert.deepEqual(loaded.sessions,[approval]);
  assert.deepEqual(loaded.replayStore.snapshot(),replay.snapshot());
});

test("a stale replay snapshot cannot undo a consumed decision",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,16);
  const stale=(await store.load()).replayStore;
  await store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1));
  await assert.rejects(store.saveReplay(stale),/cannot be replaced/);
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"consumed");
});

test("request reservation validates the current session inside the shared storage queue",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input={topic,id:17,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[],expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:05:00.000Z")/1000)}}};
  const review=await store.reserveRequest(input,account,decisionTime);assert.equal(review.requestId,17);
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"reserved");
  assert.equal((await store.outbox())[0]?.stage,"reviewing");
  await assert.rejects(store.reserveRequest(input,account,decisionTime),/already reviewed/);
  await store.removeSession(topic);await assert.rejects(store.reserveRequest({...input,id:18},account,decisionTime),/no longer authorized/);
});

test("closing after reservation recovers a durable error across a new store instance",async()=>{
  const storage=new MemoryStorage(),first=new WalletConnectSecurityStore(storage as any);await first.saveSession(approval);
  const input={topic,id:22,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[],expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:05:00.000Z")/1000)}}};
  await first.reserveRequest(input,account,decisionTime);
  const restored=new WalletConnectSecurityStore(storage as any),record=await restored.recoverReviewingResponse(`${topic}:22`,new Date(decisionTime.getTime()+1));
  assert.equal(record.stage,"ready");assert.equal(record.decision,"rejected");assert.equal((await restored.load()).replayStore.snapshot()[0]?.status,"consumed");
  assert.deepEqual((await restored.readyResponses(decisionTime))[0]?.response,{jsonrpc:"2.0",id:22,error:{code:-32002,message:"Wallet review was interrupted. Review a fresh request."}});
  await assert.rejects(restored.reserveRequest(input,account,decisionTime),/already reviewed/);
});

test("approving a durable review replaces its pending record in one decision write",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input={topic,id:27,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[],expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:05:00.000Z")/1000)}}};
  const review=await store.reserveRequest(input,account,decisionTime);
  const authorized=await store.commitRequestDecision(review,true,new Date(decisionTime.getTime()+1));
  assert.equal(authorized.stage,"authorized");assert.equal((await store.outbox()).length,1);
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"consumed");
});

test("failed decision write leaves the durable review available for recovery",async()=>{
  const storage=new FailingStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input={topic,id:28,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[],expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:05:00.000Z")/1000)}}};
  const review=await store.reserveRequest(input,account,decisionTime);storage.fail=true;
  await assert.rejects(store.commitRequestDecision(review,true,new Date(decisionTime.getTime()+1)),/unavailable/);
  storage.fail=false;assert.equal((await store.outbox())[0]?.stage,"reviewing");
  assert.equal((await store.recoverReviewingResponse(`${topic}:28`,new Date(decisionTime.getTime()+2))).stage,"ready");
});

test("lost reservation acknowledgement still leaves a recoverable review record",async()=>{
  const storage=new AmbiguousStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input={topic,id:24,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[],expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:05:00.000Z")/1000)}}};
  storage.throwAfterWrite=true;await assert.rejects(store.reserveRequest(input,account,decisionTime),/acknowledgement lost/);storage.throwAfterWrite=false;
  assert.equal((await store.outbox())[0]?.stage,"reviewing");
  const response=await new WalletConnectSecurityStore(storage as any).recoverReviewingResponse(`${topic}:24`,new Date(decisionTime.getTime()+1));
  assert.equal(response.stage,"ready");assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"consumed");
});

test("session update persists a generic response across restart before Relay delivery",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input=legacyInput(34),review=await store.reserveRequest(input,account,decisionTime);
  const record=await store.rejectPendingForSessionUpdate(input,account,new Date(decisionTime.getTime()+1));
  assert.equal(record.stage,"ready");assert.equal(record.decision,"rejected");assert.equal(record.requestDigest,review.requestDigest);
  assert.deepEqual(record.response,{jsonrpc:"2.0",id:34,error:{code:5103,message:"WalletConnect session updated; resend the request after reconciliation."}});
  const restored=new WalletConnectSecurityStore(storage as any);
  assert.equal((await restored.readyResponses(decisionTime))[0]?.responseDigest,record.responseDigest);
  assert.equal((await restored.load()).replayStore.snapshot()[0]?.status,"consumed");
});

test("session update reconstructs a bounded-default request after the clock advances",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input=boundedDefaultInput(42),review=await store.reserveRequest(input,account,decisionTime);
  const record=await store.rejectPendingForSessionUpdate(input,account,new Date(decisionTime.getTime()+2_000));
  assert.equal(record.requestDigest,review.requestDigest);assert.equal(record.expiresAt,review.expiresAt);
  assert.deepEqual(record.response,{jsonrpc:"2.0",id:42,error:{code:5103,message:"WalletConnect session updated; resend the request after reconciliation."}});
});

test("session update cannot rewrite approved execution or an attempted Relay response",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input=legacyInput(35),review=await store.reserveRequest(input,account,decisionTime),key=`${topic}:35`;
  await store.commitRequestDecision(review,true,new Date(decisionTime.getTime()+1));
  await assert.rejects(store.rejectPendingForSessionUpdate(input,account,new Date(decisionTime.getTime()+2)),/cannot be safely replaced/);
  await store.beginRequestExecution(key,new Date(decisionTime.getTime()+2));
  await assert.rejects(store.rejectPendingForSessionUpdate(input,account,new Date(decisionTime.getTime()+3)),/cannot be safely replaced/);
  await store.completeRequestResponse(key,{jsonrpc:"2.0",id:35,result:[account]},new Date(decisionTime.getTime()+3));
  await assert.rejects(store.rejectPendingForSessionUpdate(input,account,new Date(decisionTime.getTime()+4)),/cannot be safely replaced/);
  await store.recordDeliveryAttempt(key,new Date(decisionTime.getTime()+5));
  await assert.rejects(store.rejectPendingForSessionUpdate(input,account,new Date(decisionTime.getTime()+6)),/cannot be safely replaced/);
  assert.deepEqual((await store.readyResponses(decisionTime))[0]?.response,{jsonrpc:"2.0",id:35,result:[account]});
});

test("session update preserves an exact persisted rejection before its first Relay attempt",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input=legacyInput(40),review=await store.reserveRequest(input,account,decisionTime);
  const original=await store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1));
  const retained=await store.rejectPendingForSessionUpdate(input,account,new Date(decisionTime.getTime()+2));
  assert.equal(retained.responseDigest,original.responseDigest);
  assert.deepEqual(retained.response,original.response);
});

test("session update enforces the request budget before inspecting a saved review",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input=legacyInput(39);await store.reserveRequest(input,account,decisionTime);
  await assert.rejects(store.rejectPendingForSessionUpdate({...input,padding:"x".repeat(70_000)},account,decisionTime),/exceeds policy/);
  assert.equal((await store.outbox())[0]?.stage,"reviewing");
});

test("session update rejects a reused request id with a different request digest",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input=legacyInput(37);await store.reserveRequest(input,account,decisionTime);
  const different={...input,params:{...input.params,request:{...input.params.request,expiryTimestamp:input.params.request.expiryTimestamp-1}}};
  await assert.rejects(store.rejectPendingForSessionUpdate(different,account,new Date(decisionTime.getTime()+1)),/does not match its saved review/);
  assert.equal((await store.outbox())[0]?.stage,"reviewing");
});

test("failed Relay delivery leaves the exact session update response ready after cold restart",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const record=await store.rejectPendingForSessionUpdate(legacyInput(38),account,decisionTime);
  const claim=await store.recordDeliveryAttempt(record.key,new Date(decisionTime.getTime()+1));
  const restored=new WalletConnectSecurityStore(storage as any),ready=(await restored.readyResponses(decisionTime))[0];
  assert.equal(ready?.attempts,1);
  assert.equal(ready?.responseDigest,claim.responseDigest);
  assert.deepEqual(ready?.response,record.response);
  await restored.recordDeliveryAttempt(record.key,new Date(decisionTime.getTime()+2));
  assert.equal((await restored.readyResponses(decisionTime))[0]?.attempts,2);
});

test("namespace drift quarantines a persisted session update response before retry",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  await store.rejectPendingForSessionUpdate(legacyInput(36),account,decisionTime);
  const changed={eip155:{...namespaces.eip155,methods:["eth_accounts","personal_sign"]}};
  const result=await store.reconcileActiveSessions([{topic,namespaces:changed as any}],account);
  assert.deepEqual(result.disconnectTopics,[topic]);
  assert.equal((await store.outbox())[0]?.stage,"quarantined");
  assert.deepEqual(await store.readyResponses(decisionTime),[]);
});

test("revoking a session quarantines an unfinished review without invalidating storage",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input={topic,id:25,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[],expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:05:00.000Z")/1000)}}};
  await store.reserveRequest(input,account,decisionTime);await store.removeSession(topic);
  assert.equal((await new WalletConnectSecurityStore(storage as any).outbox())[0]?.stage,"quarantined");
  await assert.rejects(store.recoverReviewingResponse(`${topic}:25`,decisionTime),/not recoverable/);
});

test("invalid pre-review request receives one bounded durable error for its approved session",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input={topic,id:23,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:1",request:{method:"eth_accounts",params:[]}}};
  await assert.rejects(store.reserveRequest(input,account,decisionTime),/eip155:6423/);
  const record=await store.rejectUnreviewedRequest(input,account,decisionTime);
  assert.equal(record.method,"wallet_request_unreviewed");assert.deepEqual(record.response,{jsonrpc:"2.0",id:23,error:{code:-32602,message:"Invalid or unsupported WalletConnect request."}});
  assert.equal((await new WalletConnectSecurityStore(storage as any).readyResponses(decisionTime))[0]?.key,`${topic}:23`);
  assert.equal((await store.rejectUnreviewedRequest(input,account,decisionTime)).responseDigest,record.responseDigest);
  await assert.rejects(store.rejectUnreviewedRequest({...input,params:{...input.params,chainId:"eip155:2"}},account,decisionTime),/identity was already used/);
});

test("oversized invalid request receives a bounded durable error without storing its payload",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input={topic,id:29,params:{chainId:"eip155:1",request:{method:"eth_accounts",params:["x".repeat(70_000)]}}};
  const record=await store.rejectUnreviewedRequest(input,account,decisionTime);
  assert.equal(record.stage,"ready");assert.equal(record.response?.id,29);
  assert.ok((storage.value?.length??0)<10_000);
  assert.equal((await store.rejectUnreviewedRequest({...input,params:{...input.params,request:{...input.params.request,params:["y".repeat(70_000)]}}},account,decisionTime)).responseDigest,record.responseDigest);
});

test("invalid request with an accessor is rejected without invoking the accessor",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  let invoked=false;const input={topic,id:32,params:{chainId:"eip155:1"}} as Record<string,unknown>;
  Object.defineProperty(input,"payload",{enumerable:true,get(){invoked=true;throw new Error("untrusted getter ran")}});
  const record=await store.rejectUnreviewedRequest(input,account,decisionTime);
  assert.equal(invoked,false);assert.equal(record.stage,"ready");
});

test("legacy reserved replay without outbox recovers only a generic rejection",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,30);
  const recovered=await new WalletConnectSecurityStore(storage as any).recoverOrphanReservation(legacyInput(30),account,new Date(decisionTime.getTime()+1));
  assert.equal(recovered.stage,"ready");assert.equal(recovered.decision,"rejected");assert.equal(recovered.requestDigest,review.requestDigest);
  assert.deepEqual(recovered.response,{jsonrpc:"2.0",id:30,error:{code:-32002,message:"Wallet review was interrupted. Review a fresh request."}});
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"consumed");
  await assert.rejects(store.recoverOrphanReservation(legacyInput(30),account,decisionTime),/not recoverable/);
});

test("legacy bounded-default orphan recovers after the clock advances",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),replay=new WalletConnectRequestReplayStore(),input=boundedDefaultInput(43);
  const review=createWalletConnectRequestReview(input,{session:approval,now:decisionTime,replayStore:replay});
  await store.saveSession(approval);await store.saveReplay(replay);
  const recovered=await store.recoverOrphanReservation(input,account,new Date(decisionTime.getTime()+2_000));
  assert.equal(recovered.requestDigest,review.requestDigest);assert.equal(recovered.expiresAt,review.expiresAt);
  assert.equal(recovered.stage,"ready");
});

test("legacy orphan cannot answer a different request reusing the same topic and id",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await reservedReview(store,31);
  const changed={...legacyInput(31),params:{...legacyInput(31).params,request:{method:"eth_accounts",params:[],expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:04:00.000Z")/1000)}}};
  await assert.rejects(store.recoverOrphanReservation(changed,account,new Date(decisionTime.getTime()+1)),/does not match/);
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"reserved");assert.deepEqual(await store.outbox(),[]);
});

test("legacy orphan rejects oversized replay before reconstructing a review",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await reservedReview(store,33);
  await assert.rejects(store.recoverOrphanReservation({...legacyInput(33),payload:"x".repeat(70_000)},account,new Date(decisionTime.getTime()+1)),/exceeds policy/);
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"reserved");assert.deepEqual(await store.outbox(),[]);
});

test("expired review and replay are pruned together before the request id is reused",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);
  const input={topic,id:26,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[],expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:00:11.000Z")/1000)}}};
  await store.reserveRequest(input,account,decisionTime);
  const later=new Date("2026-09-20T00:00:12.000Z"),fresh={...input,params:{...input.params,request:{...input.params.request,expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:05:00.000Z")/1000)}}};
  const review=await store.reserveRequest(fresh,account,later);
  assert.equal(review.requestId,26);assert.equal((await store.outbox()).length,1);assert.equal((await store.outbox())[0]?.requestDigest,review.requestDigest);
  assert.equal((await store.load()).replayStore.snapshot().length,1);
});

test("oversized state is rejected before secure storage is mutated",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);
  const oversized={...approval,peer:{...approval.peer,metadata:{...approval.peer.metadata,name:"x".repeat(512_000)}}};
  await assert.rejects(store.saveSession(oversized as WalletConnectSessionApproval),/exceeds policy/);
  assert.equal(storage.value,null);
});

const decisionTime=new Date("2026-09-20T00:00:10.000Z");
async function reservedReview(store:WalletConnectSecurityStore,id:number){
  const replay=new WalletConnectRequestReplayStore(),review=createWalletConnectRequestReview(legacyInput(id),{session:approval,now:decisionTime,replayStore:replay});
  await store.saveSession(approval);await store.saveReplay(replay);return review;
}
function legacyInput(id:number){return{topic,id,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[],expiryTimestamp:Math.floor(Date.parse("2026-09-20T00:05:00.000Z")/1000)}}}}
function boundedDefaultInput(id:number){return{topic,id,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"https://example.com",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[]}}}}

test("replay consumption and rejected response are committed atomically",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,7);
  const record=await store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1));
  assert.equal(record.stage,"ready");assert.equal(record.decision,"rejected");assert.deepEqual(record.response,{jsonrpc:"2.0",id:7,error:{code:5000,message:"User rejected the request."}});
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"consumed");
  assert.equal((await store.readyResponses(decisionTime))[0]?.key,`${topic}:7`);
  await assert.rejects(store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+2)),/already contains/);
});

test("preparation failure persists its exact rejection instead of stranding a reservation",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,18);
  const record=await store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1),{code:-32000,message:"Transaction preflight failed."});
  assert.deepEqual(record.response,{jsonrpc:"2.0",id:18,error:{code:-32000,message:"Transaction preflight failed."}});
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"consumed");
  assert.equal((await store.readyResponses(decisionTime))[0]?.responseDigest,record.responseDigest);
});

test("approved response moves through execution and delivery without changing exact bytes",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,8),key=`${topic}:8`;
  await store.commitRequestDecision(review,true,new Date(decisionTime.getTime()+1));
  assert.equal((await store.beginRequestExecution(key,new Date(decisionTime.getTime()+2))).stage,"executing");
  const ready=await store.completeRequestResponse(key,{jsonrpc:"2.0",id:8,result:[account]},new Date(decisionTime.getTime()+3));
  const exact=JSON.stringify(ready.response),attempted=await store.recordDeliveryAttempt(key,new Date(decisionTime.getTime()+4));
  assert.equal(attempted.attempts,1);assert.equal(JSON.stringify(attempted.response),exact);
  const delivered=await store.markResponseDelivered(key,{attempt:attempted.attempts,responseDigest:attempted.responseDigest!},new Date(decisionTime.getTime()+5));
  assert.equal(delivered.stage,"delivered");assert.equal(JSON.stringify(delivered.response),exact);
  assert.deepEqual(await store.readyResponses(decisionTime),[]);
});

test("an older delivery attempt cannot mark a newer retry as delivered",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,21),key=`${topic}:21`;
  await store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1));
  const first=await store.recordDeliveryAttempt(key,new Date(decisionTime.getTime()+2));
  const second=await store.recordDeliveryAttempt(key,new Date(decisionTime.getTime()+3));
  await assert.rejects(store.markResponseDelivered(key,{attempt:first.attempts,responseDigest:first.responseDigest!},new Date(decisionTime.getTime()+4)),/claim is stale/);
  assert.equal((await store.readyResponses(decisionTime))[0]?.attempts,2);
  await store.markResponseDelivered(key,{attempt:second.attempts,responseDigest:second.responseDigest!},new Date(decisionTime.getTime()+5));
});

test("session removal quarantines undelivered response and clears its payload",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);const review=await reservedReview(store,9);await store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1));
  await store.removeSession(topic);const [record]=await store.outbox();assert.equal(record?.stage,"quarantined");assert.equal(record?.response,null);assert.equal(record?.responseDigest,null);
});

test("legacy v1 state migrates on mutation and tampered response fails closed",async()=>{
  const storage=new MemoryStorage();storage.value=JSON.stringify({version:1,sessions:[],replay:[]});const store=new WalletConnectSecurityStore(storage as any);assert.deepEqual(await store.outbox(),[]);await store.saveSession(approval);assert.equal(JSON.parse(storage.value!).version,3);
  const review=await reservedReview(store,10);await store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1));const state=JSON.parse(storage.value!);state.outbox[0].response.error.message="changed";storage.value=JSON.stringify(state);await assert.rejects(store.outbox(),/digest is invalid/);
});

test("failed atomic decision write leaves replay reserved and creates no response",async()=>{
  const storage=new FailingStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,11);storage.fail=true;
  await assert.rejects(store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1)),/unavailable/);storage.fail=false;
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"reserved");assert.deepEqual(await store.outbox(),[]);
});

test("lost acknowledgement after atomic decision preserves a recoverable exact response",async()=>{
  const storage=new AmbiguousStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,19);
  storage.throwAfterWrite=true;
  await assert.rejects(store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1)),/acknowledgement lost/);
  storage.throwAfterWrite=false;
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"consumed");
  assert.deepEqual((await store.readyResponses(decisionTime))[0]?.response,{jsonrpc:"2.0",id:19,error:{code:5000,message:"User rejected the request."}});
  await assert.rejects(store.commitRequestDecision(review,true,new Date(decisionTime.getTime()+2)),/already contains/);
});

test("interrupted execution becomes one durable uncertainty response without signing again",async()=>{
  const storage=new MemoryStorage(),first=new WalletConnectSecurityStore(storage as any),review=await reservedReview(first,20),key=`${topic}:20`;
  await first.commitRequestDecision(review,true,new Date(decisionTime.getTime()+1));
  await first.beginRequestExecution(key,new Date(decisionTime.getTime()+2));
  const recovered=await new WalletConnectSecurityStore(storage as any).recoverIncompleteResponse(key,new Date(decisionTime.getTime()+3));
  assert.equal(recovered.stage,"ready");assert.deepEqual(recovered.response,{jsonrpc:"2.0",id:20,error:{code:-32002,message:"Wallet signing outcome was interrupted. Review a fresh request."}});
  await assert.rejects(first.recoverIncompleteResponse(key,new Date(decisionTime.getTime()+4)),/not recoverable/);
  assert.equal((await first.readyResponses(decisionTime))[0]?.responseDigest,recovered.responseDigest);
});

test("invalid execution result stays quarantinable and cannot become relay-ready",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,12),key=`${topic}:12`;await store.commitRequestDecision(review,true,new Date(decisionTime.getTime()+1));await store.beginRequestExecution(key,new Date(decisionTime.getTime()+2));
  await assert.rejects(store.completeRequestResponse(key,{jsonrpc:"2.0",id:12,result:[`0x${"2".repeat(40)}`]},new Date(decisionTime.getTime()+3)),/response is invalid/);
  assert.equal((await store.outbox())[0]?.stage,"executing");await store.quarantineTopic(topic,new Date(decisionTime.getTime()+4));assert.equal((await store.outbox())[0]?.stage,"quarantined");
});

test("session revocation wins over a stale reviewed request",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,13);await store.removeSession(topic);
  await assert.rejects(store.commitRequestDecision(review,true,new Date(decisionTime.getTime()+1)),/no longer authorized/);
  assert.equal((await store.load()).replayStore.snapshot()[0]?.status,"reserved");assert.deepEqual(await store.outbox(),[]);
});

test("state read rejects a ready response detached from its current session",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,14);await store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1));const state=JSON.parse(storage.value!);state.sessions=[];storage.value=JSON.stringify(state);
  await assert.rejects(new WalletConnectSecurityStore(storage as any).readyResponses(decisionTime),/session binding is invalid/);
});

test("replacing a topic binding clears sensitive delivered response payloads",async()=>{
  const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any),review=await reservedReview(store,15),key=`${topic}:15`;await store.commitRequestDecision(review,false,new Date(decisionTime.getTime()+1));const attempt=await store.recordDeliveryAttempt(key,new Date(decisionTime.getTime()+2));await store.markResponseDelivered(key,{attempt:attempt.attempts,responseDigest:attempt.responseDigest!},new Date(decisionTime.getTime()+3));
  await store.saveSession({...approval,sessionBinding:"f".repeat(64)} as WalletConnectSessionApproval);const [record]=await store.outbox();assert.equal(record?.stage,"quarantined");assert.equal(record?.response,null);
});
