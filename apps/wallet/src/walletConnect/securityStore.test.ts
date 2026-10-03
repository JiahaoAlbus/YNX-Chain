import assert from "node:assert/strict";
import test from "node:test";
import type { WalletConnectSessionApproval } from "@ynx-chain/wallet-auth";
import { WalletConnectSecurityStore } from "./securityStore";

class MemoryStorage{value:string|null=null;async getItem(){return this.value}async setItem(_key:string,value:string){this.value=value}async removeItem(){this.value=null}}
const account=`0x${"1".repeat(40)}`,topic="a".repeat(64),namespaces={eip155:{chains:["eip155:6423"],methods:["eth_accounts"],events:["accountsChanged"],accounts:[`eip155:6423:${account}`]}} as const;
const approval={kind:"walletconnect_session_approval",protocolVersion:2,topic,proposalId:1,proposalDigest:"b".repeat(64),peer:{publicKey:"c".repeat(64),metadata:{name:"dApp",description:"test",url:"https://example.com",icons:[]}},verification:{origin:"https://example.com",validation:"UNKNOWN",verifyUrl:"",isScam:false},relays:["irn"],namespaces,account,approvedAt:"2026-09-20T00:00:00.000Z",expiresAt:"2026-09-21T00:00:00.000Z",sessionBinding:"d".repeat(64)} as WalletConnectSessionApproval;
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
for(const reconcile of [false,true])test(`retired view cannot ${reconcile?"reconcile away another account's sessions":"save a proposal"} after its serialized read`,async()=>{
 const storage=new MemoryStorage(),store=new WalletConnectSecurityStore(storage as any);await store.saveSession(approval);const original=storage.value;
 const read=storage.getItem.bind(storage);let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let blocked=false;
 storage.getItem=async()=>{const value=await read();if(!blocked){blocked=true;await pending;}return value;};let current=true;
 const guard=()=>{if(!current)throw Error("view retired");};
 const job=reconcile?store.reconcileActiveSessions([],account,guard):store.saveSession({...approval,topic:"e".repeat(64)},guard);
 await new Promise(resolve=>setImmediate(resolve));current=false;release();await assert.rejects(job,/view retired/);assert.equal(storage.value,original);assert.equal((await store.load()).sessions.length,1);
});
