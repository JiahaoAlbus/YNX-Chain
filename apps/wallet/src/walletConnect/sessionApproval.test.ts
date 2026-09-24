import assert from "node:assert/strict";
import test from "node:test";
import type { WalletConnectSessionApproval } from "@ynx-chain/wallet-auth";
import { abortApprovedWalletConnectSession,assertWalletConnectSessionMatchesReview,createPersistAndPublishWalletConnectSession,persistAndPublishWalletConnectSession,retryQuarantinedWalletConnectSession,revokeAndDisconnectWalletConnectSession } from "./sessionApproval";
import { WalletConnectRuntime } from "./runtime";

const approval={topic:"a".repeat(64)} as WalletConnectSessionApproval;
const runtimeHooks={quarantineSession(_topic:string){},releaseQuarantinedSession(_topic:string){},quarantinedTopics:():readonly string[]=>[]};

test("approved session is published only after its local approval is saved",async()=>{
  const order:string[]=[];
  await persistAndPublishWalletConnectSession(
    {...runtimeHooks,refreshSessions(){order.push("publish")},async disconnect(){order.push("disconnect")}},
    {async saveSession(){order.push("save")},async removeSession(){order.push("remove")}},
    approval,
  );
  assert.deepEqual(order,["save","publish"]);
});

test("approval persistence failure disconnects and never publishes the remote session",async()=>{
  const order:string[]=[];
  await assert.rejects(persistAndPublishWalletConnectSession(
    {...runtimeHooks,refreshSessions(){order.push("publish")},async disconnect(topic){order.push(`disconnect:${topic}`)}},
    {async saveSession(){order.push("save");throw new Error("storage unavailable")},async removeSession(){order.push("remove")}},
    approval,
  ),/storage unavailable/);
  assert.deepEqual(order,["save","remove",`disconnect:${approval.topic}`]);
});

test("account lease loss after the storage write removes the grant and disconnects",async()=>{
  const order:string[]=[];let current=true;
  await assert.rejects(persistAndPublishWalletConnectSession(
    {...runtimeHooks,refreshSessions(){order.push("publish")},async disconnect(){order.push("disconnect")}},
    {async saveSession(){order.push("save");current=false},async removeSession(){order.push("remove")}},
    approval,()=>{if(!current)throw new Error("account changed")},
  ),/account changed/);
  assert.deepEqual(order,["save","remove","disconnect"]);
});

test("SDK peer and permissions must match the proposal shown to the user",()=>{
  const account=`0x${"1".repeat(40)}`,publicKey="a".repeat(64);
  const review={peer:{publicKey,metadata:{name:"dApp",description:"Test",url:"https://example.com/",icons:["https://example.com/icon.png"]}},
    namespaces:{eip155:{accounts:[`eip155:6423:${account}`],chains:["eip155:6423"],methods:["personal_sign"],events:["accountsChanged"]}}} as any;
  const session={topic:"a".repeat(64),peer:{publicKey,metadata:{name:"dApp",description:"Test",url:"https://example.com",icons:["https://example.com/icon.png"]}},namespaces:review.namespaces} as any;
  assert.doesNotThrow(()=>assertWalletConnectSessionMatchesReview(session,review));
  assert.throws(()=>assertWalletConnectSessionMatchesReview({...session,peer:{...session.peer,publicKey:"b".repeat(64)}},review),/peer differs/);
  assert.throws(()=>assertWalletConnectSessionMatchesReview({...session,namespaces:{eip155:{...session.namespaces.eip155,methods:["eth_sendTransaction"]}}},review),/permissions differ/);
});

test("partial approval write is removed even when its remote disconnect also fails",async()=>{
  let persisted=false;
  await assert.rejects(persistAndPublishWalletConnectSession(
    {...runtimeHooks,refreshSessions(){assert.fail("must not publish")},async disconnect(){throw new Error("relay unavailable")}},
    {async saveSession(){persisted=true;throw new Error("verification failed")},async removeSession(){persisted=false}},
    approval,
  ),error=>{assert.ok(error instanceof AggregateError);assert.match(String(error.errors[0]),/verification failed/);return true});
  assert.equal(persisted,false);
});

test("approval construction failure closes the already-approved SDK session",async()=>{
  const order:string[]=[];
  await assert.rejects(createPersistAndPublishWalletConnectSession(
    {...runtimeHooks,refreshSessions(){order.push("publish")},async disconnect(topic){order.push(`disconnect:${topic}`)}},
    {async saveSession(){order.push("save")},async removeSession(){order.push("remove")}},
    approval.topic,
    ()=>{throw new Error("invalid approval binding")},
  ),/invalid approval binding/);
  assert.deepEqual(order,["remove",`disconnect:${approval.topic}`]);
});

test("approval persistence failure is disconnected exactly once by the persistence owner",async()=>{
  const order:string[]=[];
  await assert.rejects(createPersistAndPublishWalletConnectSession(
    {...runtimeHooks,refreshSessions(){order.push("publish")},async disconnect(topic){order.push(`disconnect:${topic}`)}},
    {async saveSession(){order.push("save");throw new Error("storage unavailable")},async removeSession(){order.push("remove")}},
    approval.topic,
    ()=>approval,
  ),/storage unavailable/);
  assert.deepEqual(order,["save","remove",`disconnect:${approval.topic}`]);
});

test("runtime keeps a newly approved SDK session hidden and closes it when persistence fails",async()=>{
  const handlers=new Map<string,(event:any)=>void>(),active:Record<string,any>={},disconnected:string[]=[];
  const client={
    on(event:string,listener:(event:any)=>void){handlers.set(event,listener)},pair:async()=>{},rejectSession:async()=>{},respondSessionRequest:async()=>{},getActiveSessions:()=>active,
    approveSession:async(value:any)=>{const session={topic:approval.topic,namespaces:value.namespaces,peer:{metadata:{name:"dApp",url:"https://example.com"}}};active[session.topic]=session;return session},
    disconnectSession:async({topic}:{topic:string})=>{disconnected.push(topic);delete active[topic]},
  };
  const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any);await runtime.start();
  handlers.get("session_proposal")!({id:1,params:{},verifyContext:{verified:{}}});
  await runtime.approveProposal(runtime.snapshot().proposal!,{eip155:{accounts:[],chains:["eip155:6423"],methods:["eth_accounts"],events:[]}} as any);
  assert.deepEqual(runtime.snapshot().sessions,[]);
  let persisted=false;
  await assert.rejects(persistAndPublishWalletConnectSession(runtime,{async saveSession(){persisted=true;throw new Error("storage unavailable")},async removeSession(){persisted=false}},approval),/storage unavailable/);
  assert.equal(persisted,false);
  assert.deepEqual(disconnected,[approval.topic]);
  assert.deepEqual(runtime.snapshot().sessions,[]);
});

test("lease loss after a durable grant plus two cleanup failures cannot reauthorize the session on sheet reentry",async()=>{
  const handlers=new Map<string,(event:any)=>void>(),active:Record<string,any>={},responses:any[]=[];
  let storageFails=true,relayFails=true,persisted=false;
  const client={
    on(event:string,listener:(event:any)=>void){handlers.set(event,listener)},pair:async()=>{},rejectSession:async()=>{},
    respondSessionRequest:async(value:any)=>{responses.push(value)},getActiveSessions:()=>active,
    approveSession:async(value:any)=>{const session={topic:approval.topic,namespaces:value.namespaces,peer:{metadata:{name:"dApp",url:"https://example.com"}}};active[session.topic]=session;return session},
    disconnectSession:async({topic}:{topic:string})=>{if(relayFails)throw new Error("relay unavailable");delete active[topic]},
  };
  const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any);await runtime.start();
  handlers.get("session_proposal")!({id:1,params:{},verifyContext:{verified:{}}});
  await runtime.approveProposal(runtime.snapshot().proposal!,{eip155:{accounts:[],chains:["eip155:6423"],methods:["eth_accounts"],events:[]}} as any);
  const store={async saveSession(){persisted=true},async removeSession(){if(storageFails)throw new Error("secure storage unavailable");persisted=false}};
  let leaseChecks=0;
  await assert.rejects(persistAndPublishWalletConnectSession(runtime,store,approval,()=>{if(++leaseChecks===2)throw new Error("selected account changed")}),error=>{
    assert.ok(error instanceof AggregateError);assert.equal(error.errors.length,3);assert.match(String(error.errors[0]),/selected account changed/);assert.match(error.message,/cleanup is pending/);return true;
  });
  assert.equal(leaseChecks,2);assert.equal(persisted,true);assert.deepEqual(runtime.quarantinedTopics(),[approval.topic]);
  await runtime.restore();assert.deepEqual(runtime.snapshot().sessions,[]);
  handlers.get("session_request")!({topic:approval.topic,id:7,params:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(runtime.snapshot().request,null);assert.equal(responses.length,1);assert.equal(responses[0].response.error.code,5000);
  storageFails=false;relayFails=false;
  await retryQuarantinedWalletConnectSession(runtime,store,approval.topic);
  assert.equal(persisted,false);assert.deepEqual(runtime.quarantinedTopics(),[]);assert.deepEqual(runtime.snapshot().sessions,[]);
  await assert.rejects(retryQuarantinedWalletConnectSession(runtime,store,approval.topic),/not awaiting cleanup/);
});

test("final UI lease loss after publication quarantines a saved grant when both cleanup paths fail",async()=>{
  const handlers=new Map<string,(event:any)=>void>(),active:Record<string,any>={},responses:any[]=[];
  let persisted=false,storageFails=true,relayFails=true;
  const client={
    on(event:string,listener:(event:any)=>void){handlers.set(event,listener)},pair:async()=>{},rejectSession:async()=>{},
    respondSessionRequest:async(value:any)=>{responses.push(value)},getActiveSessions:()=>active,
    approveSession:async(value:any)=>{const session={topic:approval.topic,namespaces:value.namespaces,peer:{metadata:{name:"dApp",url:"https://example.com"}}};active[session.topic]=session;return session},
    disconnectSession:async({topic}:{topic:string})=>{if(relayFails)throw new Error("Relay cleanup failed");delete active[topic]},
  };
  const runtime=new WalletConnectRuntime({projectId:"b".repeat(32)},(async()=>client) as any);await runtime.start();
  handlers.get("session_proposal")!({id:2,params:{},verifyContext:{verified:{}}});
  await runtime.approveProposal(runtime.snapshot().proposal!,{eip155:{accounts:[],chains:["eip155:6423"],methods:["eth_accounts"],events:[]}} as any);
  const store={async saveSession(){persisted=true},async removeSession(){if(storageFails)throw new Error("local cleanup failed");persisted=false}};
  await persistAndPublishWalletConnectSession(runtime,store,approval);
  assert.equal(persisted,true);assert.deepEqual(runtime.snapshot().sessions.map(session=>session.topic),[approval.topic]);
  await assert.rejects(abortApprovedWalletConnectSession(runtime,store,approval.topic,new Error("selected account changed after publication")),error=>{
    assert.ok(error instanceof AggregateError);assert.equal(error.errors.length,3);
    assert.match(String(error.errors[0]),/selected account changed after publication/);return true;
  });
  assert.equal(persisted,true);assert.deepEqual(runtime.quarantinedTopics(),[approval.topic]);
  await runtime.restore();assert.deepEqual(runtime.snapshot().sessions,[]);
  handlers.get("session_request")!({topic:approval.topic,id:8,params:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(runtime.snapshot().request,null);assert.equal(responses[0].response.error.code,5000);
  storageFails=false;relayFails=false;
  await retryQuarantinedWalletConnectSession(runtime,store,approval.topic);
  assert.equal(persisted,false);assert.deepEqual(runtime.quarantinedTopics(),[]);assert.deepEqual(runtime.snapshot().sessions,[]);
});

test("manual disconnect removes local approval even when the remote disconnect fails",async()=>{
  const order:string[]=[];
  await assert.rejects(revokeAndDisconnectWalletConnectSession(
    {async disconnect(){order.push("disconnect");throw new Error("relay unavailable")}},
    {async removeSession(){order.push("remove")}},
    approval.topic,
  ),/relay unavailable/);
  assert.deepEqual(order,["remove","disconnect"]);
});
