import assert from "node:assert/strict";
import test from "node:test";
import { currentWalletConnectDelivery } from "./deliveryGuard";

const account=`0x${"1".repeat(40)}`,topic="a".repeat(64),binding="b".repeat(64);
const namespace={eip155:{accounts:[`eip155:6423:${account}`],chains:["eip155:6423"],methods:["eth_accounts"],events:[]}};
const session={topic,namespaces:namespace};
const record={topic,requestId:7,account,sessionBinding:binding} as any;

test("delivery guard accepts only one stable current session snapshot",async()=>{
  const snapshot={phase:"ready",sessions:[session],sessionEvent:null} as any;
  const runtime={snapshot:()=>snapshot},store={session:async()=>({account,sessionBinding:binding}),reconcileSession:async()=>"current" as const};
  assert.equal(await currentWalletConnectDelivery(runtime as any,store as any,record,account),true);
});

test("namespace update while the final storage check waits prevents delivery",async()=>{
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve});
  let snapshot={phase:"ready",sessions:[session],sessionEvent:{revision:1}} as any;
  const runtime={snapshot:()=>snapshot},store={session:async()=>({account,sessionBinding:binding}),reconcileSession:async()=>{entered();await gate;return "current" as const}};
  const pending=currentWalletConnectDelivery(runtime as any,store as any,record,account);
  await started;
  snapshot={phase:"ready",sessions:[{topic,namespaces:{eip155:{...namespace.eip155,methods:[]}}}],sessionEvent:{revision:2}};
  release();assert.equal(await pending,false);
});

test("same topic and id with a replacement request cannot receive the prior response",async()=>{
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve});
  const original={topic,id:7,params:{request:{method:"eth_accounts",params:[]}}},replacement={topic,id:7,params:{request:{method:"eth_sendTransaction",params:[]}}};
  let snapshot={phase:"ready",sessions:[session],sessionEvent:null,request:original} as any;
  const runtime={snapshot:()=>snapshot},store={session:async()=>({account,sessionBinding:binding}),reconcileSession:async()=>{entered();await gate;return "current" as const}};
  const pending=currentWalletConnectDelivery(runtime as any,store as any,record,account,original as any);
  await started;snapshot={...snapshot,request:replacement};release();
  assert.equal(await pending,false);
});

test("relay retry may deliver an exact stored response after pending clears but rejects a replacement",async()=>{
  let snapshot={phase:"ready",sessions:[session],sessionEvent:null,request:null} as any;
  const runtime={snapshot:()=>snapshot},store={session:async()=>({account,sessionBinding:binding}),reconcileSession:async()=>"current" as const};
  assert.equal(await currentWalletConnectDelivery(runtime as any,store as any,record,account),true);
  snapshot={...snapshot,request:{topic,id:7,params:{request:{method:"eth_sendTransaction"}}}};
  assert.equal(await currentWalletConnectDelivery(runtime as any,store as any,record,account),false);
});
