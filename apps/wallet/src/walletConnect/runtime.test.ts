import assert from "node:assert/strict";
import test from "node:test";
import { WalletConnectRuntime, walletConnectRuntimeConfig } from "./runtime";

test("WalletConnect is explicitly disabled without a project ID", () => {
  assert.equal(walletConnectRuntimeConfig({}), null);
  assert.equal(walletConnectRuntimeConfig({ EXPO_PUBLIC_REOWN_PROJECT_ID: "" }), null);
  assert.equal(walletConnectRuntimeConfig({ EXPO_PUBLIC_REOWN_PROJECT_ID: " " }), null);
});
test("WalletConnect accepts one bounded external project ID", () => assert.deepEqual(walletConnectRuntimeConfig({ EXPO_PUBLIC_REOWN_PROJECT_ID: "A".repeat(32) }), { projectId: "a".repeat(32),relayUrl:"wss://relay.walletconnect.com" }));
test("an explicitly configured all-zero ID is format-valid but is never the example default", () => {
  assert.deepEqual(walletConnectRuntimeConfig({ EXPO_PUBLIC_REOWN_PROJECT_ID: "0".repeat(32) }), { projectId: "0".repeat(32), relayUrl: "wss://relay.walletconnect.com" });
});
test("WalletConnect rejects malformed project IDs without contacting a relay", () => {
  for (const value of ["x", "a".repeat(31), "a".repeat(33), "../secret", "a".repeat(31) + "-"]) assert.throws(() => walletConnectRuntimeConfig({ EXPO_PUBLIC_REOWN_PROJECT_ID: value }));
});

function fakeClient() {
  const handlers = new Map<string,(event:any)=>void>();
  const active:Record<string,any>={};
  const responses:any[]=[],disconnects:string[]=[];
  return {
    handlers,active,responses,disconnects,sessionReads:0,failResponses:false,failRejections:false,failDisconnect:false,
    pair:async()=>{},approveSession:async function(value:any){const topic="a".repeat(64),session={topic,namespaces:value.namespaces,peer:{metadata:{name:"dApp",url:"https://example.com"}}};this.active[topic]=session;return session},rejectSession:async function(){if(this.failRejections)throw new Error("reject unavailable")},respondSessionRequest:async function(value:any){this.responses.push(value);if(this.failResponses)throw new Error("response unavailable")},disconnectSession:async function(value:any){this.disconnects.push(value.topic);if(this.failDisconnect)throw new Error("disconnect unavailable");delete this.active[value.topic]},getActiveSessions:function(){this.sessionReads+=1;return active},
    on(event:string,listener:(event:any)=>void){handlers.set(event,listener);return this},
  };
}

test("failed initialization is explicitly retryable without caching a rejected promise or duplicating listeners",async()=>{
  let attempts=0;const client=fakeClient();
  const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>{attempts+=1;if(attempts===1)throw new Error("relay unavailable");return client}) as any);
  await assert.rejects(runtime.start(),/relay unavailable/);
  assert.equal(runtime.snapshot().retryAvailable,true);
  await assert.rejects(runtime.start(),/relay unavailable/);
  assert.equal(attempts,1);
  await runtime.retryStart();
  assert.equal(attempts,2);
  assert.equal(runtime.snapshot().phase,"ready");
  assert.deepEqual([...client.handlers.keys()].sort(),["session_delete","session_expire","session_proposal","session_request","session_update"]);
  await runtime.start();
  assert.equal(attempts,2);
  assert.equal(client.handlers.size,5);
});

test("initialization retries are bounded",async()=>{
  let attempts=0;const runtime=new WalletConnectRuntime({projectId:"b".repeat(32)},(async()=>{attempts+=1;throw new Error("offline")}) as any);
  await assert.rejects(runtime.start());
  await assert.rejects(runtime.retryStart());
  await assert.rejects(runtime.retryStart());
  assert.equal(attempts,3);
  assert.equal(runtime.snapshot().retryAvailable,false);
  await assert.rejects(runtime.retryStart(),/retry limit/i);
  assert.equal(attempts,3);
});

test("SDK approval is not visible until the caller explicitly publishes the persisted session",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"b".repeat(32)},(async()=>client) as any);await runtime.start();
  client.handlers.get("session_proposal")!(pendingProposal());
  const session=await runtime.approveProposal({eip155:{accounts:[],chains:["eip155:6423"],methods:["eth_accounts"],events:[]}} as any);
  assert.equal(session.topic,"a".repeat(64));
  assert.deepEqual(runtime.snapshot().sessions,[]);
  runtime.refreshSessions();
  assert.equal(runtime.snapshot().sessions[0]?.topic,session.topic);
});

test("session update and expiry events refresh the visible session and expose a single reconciliation event",async()=>{
  const client=fakeClient();const runtime=new WalletConnectRuntime({projectId:"c".repeat(32)},(async()=>client) as any);await runtime.start();
  const namespaces={eip155:{accounts:[`eip155:6423:0x${"1".repeat(40)}`],chains:["eip155:6423"],methods:["eth_accounts"],events:["accountsChanged"]}};
  const topic="d".repeat(64);client.active[topic]={topic,namespaces:{}};
  client.handlers.get("session_request")!(pendingRequest(topic));
  client.handlers.get("session_update")!({id:1,topic,params:{namespaces}});
  assert.equal(runtime.snapshot().sessionEvent?.kind,"updated");
  assert.deepEqual(runtime.snapshot().sessionEvent?.namespaces,namespaces);
  assert.equal(runtime.snapshot().request,null);
  assert.deepEqual(client.responses[0],{topic,response:{jsonrpc:"2.0",id:7,error:{code:5103,message:"WalletConnect session updated; resend the request after reconciliation."}}});
  assert.deepEqual(runtime.snapshot().sessions[0]?.namespaces,namespaces);
  client.handlers.get("session_expire")!({topic});
  assert.equal(runtime.snapshot().sessionEvent?.kind,"expired");
  assert.equal(runtime.snapshot().sessionEvent?.revision,2);
  assert.equal(runtime.snapshot().sessions.length,0);
});

const pendingRequest=(topic:string,id=7)=>({topic,id,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"",isScam:false}},params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[]}}});
const pendingProposal=()=>({id:9,verifyContext:{verified:{verifyUrl:"",validation:"UNKNOWN",origin:"",isScam:false}},params:{}});

test("expired and deleted sessions synchronously clear a same-topic pending request",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"d".repeat(32)},(async()=>client) as any);await runtime.start();const topic="e".repeat(64);
  client.handlers.get("session_request")!(pendingRequest(topic));assert.equal(runtime.snapshot().request?.topic,topic);
  client.handlers.get("session_expire")!({topic});assert.equal(runtime.snapshot().request,null);
  client.handlers.get("session_request")!(pendingRequest(topic,8));
  client.handlers.get("session_delete")!({id:10,topic});assert.equal(runtime.snapshot().request,null);
});

test("namespace drift rejection clears the pending request even when the SDK response fails",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"e".repeat(32)},(async()=>client) as any);await runtime.start();const topic="f".repeat(64);
  client.handlers.get("session_request")!(pendingRequest(topic));client.failResponses=true;
  await assert.rejects(runtime.rejectRequestForSession(topic,5103,"scope changed"),/response unavailable/);
  assert.equal(runtime.snapshot().request,null);assert.equal(client.responses.length,1);
});

test("session update synchronously clears and rejects a reviewed request even when the response fails",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"e".repeat(32)},(async()=>client) as any);await runtime.start();const topic="0".repeat(64);
  client.handlers.get("session_request")!(pendingRequest(topic,11));client.failResponses=true;
  client.handlers.get("session_update")!({id:2,topic,params:{namespaces:{}}});
  assert.equal(runtime.snapshot().request,null);
  assert.deepEqual(client.responses[0],{topic,response:{jsonrpc:"2.0",id:11,error:{code:5103,message:"WalletConnect session updated; resend the request after reconciliation."}}});
});

test("lock or component disposal clears proposal and request even when remote rejection is unavailable",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();
  client.handlers.get("session_proposal")!(pendingProposal());client.handlers.get("session_request")!(pendingRequest("1".repeat(64)));client.failResponses=true;client.failRejections=true;
  await runtime.rejectPendingForLock();assert.equal(runtime.snapshot().proposal,null);assert.equal(runtime.snapshot().request,null);
});

test("completed local request decisions cannot be approved again after response transport failure",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();const topic="9".repeat(64);client.failResponses=true;
  client.handlers.get("session_request")!(pendingRequest(topic,14));
  await assert.rejects(runtime.respond("0x1"),/response unavailable/);assert.equal(runtime.snapshot().request,null);
  client.handlers.get("session_request")!(pendingRequest(topic,15));
  await assert.rejects(runtime.rejectRequest(),/response unavailable/);assert.equal(runtime.snapshot().request,null);
});

test("stored response retries exact bytes after relay failure without another pending review",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();const topic="a".repeat(64);
  client.handlers.get("session_request")!(pendingRequest(topic,21));
  const response={jsonrpc:"2.0" as const,id:21,result:[`0x${"1".repeat(40)}`]};
  client.failResponses=true;
  await assert.rejects(runtime.sendStoredResponse(topic,response),/response unavailable/);
  assert.equal(runtime.snapshot().request,null);
  client.failResponses=false;
  await runtime.sendStoredResponse(topic,response);
  assert.deepEqual(client.responses,[{topic,response},{topic,response}]);
});

test("proposal rejection clears local approval UI even when relay response fails",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();client.failRejections=true;
  client.handlers.get("session_proposal")!(pendingProposal());
  await assert.rejects(runtime.rejectProposal(),/reject unavailable/);assert.equal(runtime.snapshot().proposal,null);
});

test("manual disconnect clears its pending request on both remote success and failure",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"1".repeat(32)},(async()=>client) as any);await runtime.start();const topic="2".repeat(64);
  client.handlers.get("session_request")!(pendingRequest(topic));await runtime.disconnect(topic);assert.equal(runtime.snapshot().request,null);
  client.handlers.get("session_request")!(pendingRequest(topic,10));client.failDisconnect=true;
  await assert.rejects(runtime.disconnect(topic),/could not disconnect/);assert.equal(runtime.snapshot().request,null);
});

test("batch disconnect attempts two stale sessions once and refreshes once",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"3".repeat(32)},(async()=>client) as any),first="4".repeat(64),second="5".repeat(64);
  client.active[first]={topic:first,namespaces:{}};client.active[second]={topic:second,namespaces:{}};await runtime.start();client.sessionReads=0;
  client.handlers.get("session_request")!(pendingRequest(second,12));
  await runtime.disconnectSessions([first,second]);
  assert.deepEqual(client.disconnects,[first,second]);
  assert.equal(client.sessionReads,1);
  assert.equal(runtime.snapshot().request,null);
  assert.deepEqual(client.responses[0],{topic:second,response:{jsonrpc:"2.0",id:12,error:{code:5103,message:"WalletConnect session authorization changed; resend after reconnecting."}}});
  assert.deepEqual(runtime.snapshot().sessions,[]);
});

test("batch disconnect still closes every session once when pending-request response fails",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"6".repeat(32)},(async()=>client) as any),first="7".repeat(64),second="8".repeat(64);
  client.active[first]={topic:first,namespaces:{}};client.active[second]={topic:second,namespaces:{}};await runtime.start();client.sessionReads=0;client.failResponses=true;
  client.handlers.get("session_request")!(pendingRequest(first,13));
  await runtime.disconnectSessions([first,second]);
  assert.equal(runtime.snapshot().request,null);
  assert.equal(client.responses.length,1);
  assert.deepEqual(client.disconnects,[first,second]);
  assert.equal(client.sessionReads,1);
  assert.deepEqual(runtime.snapshot().sessions,[]);
});
