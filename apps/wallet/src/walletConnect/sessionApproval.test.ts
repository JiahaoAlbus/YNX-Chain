import assert from "node:assert/strict";
import test from "node:test";
import type { WalletConnectSessionApproval } from "@ynx-chain/wallet-auth";
import { assertWalletConnectSessionMatchesReview,createPersistAndPublishWalletConnectSession,persistAndPublishWalletConnectSession,revokeAndDisconnectWalletConnectSession } from "./sessionApproval";
import { WalletConnectRuntime } from "./runtime";

const approval={topic:"a".repeat(64)} as WalletConnectSessionApproval;

test("approved session is published only after its local approval is saved",async()=>{
  const order:string[]=[];
  await persistAndPublishWalletConnectSession(
    {refreshSessions(){order.push("publish")},async disconnect(){order.push("disconnect")}},
    {async saveSession(){order.push("save")},async removeSession(){order.push("remove")}},
    approval,
  );
  assert.deepEqual(order,["save","publish"]);
});

test("approval persistence failure disconnects and never publishes the remote session",async()=>{
  const order:string[]=[];
  await assert.rejects(persistAndPublishWalletConnectSession(
    {refreshSessions(){order.push("publish")},async disconnect(topic){order.push(`disconnect:${topic}`)}},
    {async saveSession(){order.push("save");throw new Error("storage unavailable")},async removeSession(){order.push("remove")}},
    approval,
  ),/storage unavailable/);
  assert.deepEqual(order,["save","remove",`disconnect:${approval.topic}`]);
});

test("account lease loss after the storage write removes the grant and disconnects",async()=>{
  const order:string[]=[];let current=true;
  await assert.rejects(persistAndPublishWalletConnectSession(
    {refreshSessions(){order.push("publish")},async disconnect(){order.push("disconnect")}},
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
    {refreshSessions(){assert.fail("must not publish")},async disconnect(){throw new Error("relay unavailable")}},
    {async saveSession(){persisted=true;throw new Error("verification failed")},async removeSession(){persisted=false}},
    approval,
  ),/verification failed/);
  assert.equal(persisted,false);
});

test("approval construction failure closes the already-approved SDK session",async()=>{
  const order:string[]=[];
  await assert.rejects(createPersistAndPublishWalletConnectSession(
    {refreshSessions(){order.push("publish")},async disconnect(topic){order.push(`disconnect:${topic}`)}},
    {async saveSession(){order.push("save")},async removeSession(){order.push("remove")}},
    approval.topic,
    ()=>{throw new Error("invalid approval binding")},
  ),/invalid approval binding/);
  assert.deepEqual(order,[`disconnect:${approval.topic}`]);
});

test("approval persistence failure is disconnected exactly once by the persistence owner",async()=>{
  const order:string[]=[];
  await assert.rejects(createPersistAndPublishWalletConnectSession(
    {refreshSessions(){order.push("publish")},async disconnect(topic){order.push(`disconnect:${topic}`)}},
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

test("manual disconnect removes local approval even when the remote disconnect fails",async()=>{
  const order:string[]=[];
  await assert.rejects(revokeAndDisconnectWalletConnectSession(
    {async disconnect(){order.push("disconnect");throw new Error("relay unavailable")}},
    {async removeSession(){order.push("remove")}},
    approval.topic,
  ),/relay unavailable/);
  assert.deepEqual(order,["remove","disconnect"]);
});
