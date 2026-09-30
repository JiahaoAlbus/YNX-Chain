import assert from "node:assert/strict";
import test from "node:test";
import { WalletConnectPairingJournal } from "./securityStore";
import { WalletConnectRuntime, walletConnectRuntimeConfig } from "./runtime";

test("WalletConnect uses the authorized public project ID unless explicitly disabled", () => {
  assert.deepEqual(walletConnectRuntimeConfig({}), {projectId:"41857128a14a593ca4e4a7cb7c838d71",relayUrl:"wss://relay.walletconnect.com"});
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

test("delayed custody cannot sign or deliver an old approval after disconnect, delete or same-id replacement",async()=>{
  for(const action of ["disconnect","delete","replace","namespace"]){
    const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"d".repeat(32)},(async()=>client) as any);await runtime.start();
    const topic="e".repeat(64),account="0x"+"a".repeat(40),event=pendingRequest(topic,7);
    client.active[topic]={topic,peer:{metadata:{url:"https://example.com"}},namespaces:{eip155:{accounts:[`eip155:6423:${account}`],methods:["eth_accounts"],events:[]}}};
    client.handlers.get("session_request")!(event);
    const review={topic,requestId:7,account,method:"eth_accounts",params:[],peer:{metadata:{url:"https://example.com"}},expiresAt:new Date(Date.now()+60000).toISOString()};
    const lease=runtime.bindReviewedRequest(review,runtime.snapshot().request);
    let release!:()=>void,signs=0;const authenticated=new Promise<void>(resolve=>{release=resolve});
    const approval=(async()=>{await authenticated;lease.assertCurrent();signs++;await lease.respond("old signature")})();
    if(action==="disconnect")await runtime.disconnect(topic);
    if(action==="delete")client.handlers.get("session_delete")!({topic});
    if(action==="replace"){runtime.clearSensitiveReview();client.handlers.get("session_request")!(pendingRequest(topic,7));}
    if(action==="namespace")client.active[topic].namespaces.eip155.methods=[];
    release();await assert.rejects(approval,/authorization changed/);assert.equal(signs,0);
    assert.equal(client.responses.some(r=>Object.hasOwn(r.response,"result")),false);
    if(action==="replace"){await lease.reject();assert.equal(runtime.snapshot().request?.id,7);}
  }
});
test("temporary transport failure does not revoke a still-current review and delivery stays on its exact request",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"d".repeat(32)},(async()=>client) as any);await runtime.start();
  const topic="e".repeat(64),account="0x"+"a".repeat(40),event=pendingRequest(topic,17);
  client.active[topic]={topic,peer:{metadata:{url:"https://example.com"}},namespaces:{eip155:{accounts:[`eip155:6423:${account}`],methods:["eth_accounts"],events:[]}}};client.handlers.get("session_request")!(event);
  const lease=runtime.bindReviewedRequest({topic,requestId:17,account,method:"eth_accounts",params:[],peer:{metadata:{url:"https://example.com"}},expiresAt:new Date(Date.now()+60000).toISOString()},runtime.snapshot().request);
  client.failResponses=true;lease.assertCurrent();await assert.rejects(lease.respond("approved response"));
  assert.equal(client.responses[0].topic,topic);assert.equal(client.responses[0].response.id,17);assert.equal(runtime.snapshot().request,null);
  await assert.rejects(lease.respond("duplicate response"));assert.equal(client.responses.length,1);
});

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

test("delayed lock rejection targets the captured request and preserves a fresh proposal and request",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),rejected:number[]=[];
  client.respondSessionRequest=async(value:any)=>{client.responses.push(value);await gate};
  client.rejectSession=async(value?:any)=>{rejected.push(value.id)};
  const oldRequest=pendingRequest("1".repeat(64),21),oldProposal=pendingProposal();
  client.handlers.get("session_request")!(oldRequest);client.handlers.get("session_proposal")!(oldProposal);
  const locking=runtime.rejectPendingForLock();
  assert.equal(runtime.snapshot().request,null);assert.equal(runtime.snapshot().proposal,null);
  const freshRequest=pendingRequest("2".repeat(64),22),freshProposal={...pendingProposal(),id:oldProposal.id+1};
  client.handlers.get("session_request")!(freshRequest);client.handlers.get("session_proposal")!(freshProposal);
  release();await locking;
  assert.equal(runtime.snapshot().request,freshRequest);assert.equal(runtime.snapshot().proposal,freshProposal);
  assert.deepEqual(rejected,[oldProposal.id]);assert.equal(client.responses[0].response.id,21);assert.equal(client.responses[0].topic,oldRequest.topic);
});

test("an obsolete review failure never rejects a newer SDK event even with the same topic and ID",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();
  const old=pendingRequest("3".repeat(64),23);client.handlers.get("session_request")!(old);
  runtime.clearSensitiveReview();const fresh=pendingRequest(old.topic,old.id);client.handlers.get("session_request")!(fresh);
  await runtime.rejectReviewedEvent(old as any,5103,"Old review failed.");
  assert.equal(runtime.snapshot().request,fresh);assert.equal(client.responses.length,0);
  await runtime.rejectReviewedEvent(fresh as any,5103,"Current review failed.");
  assert.equal(runtime.snapshot().request,null);assert.equal(client.responses.length,1);assert.equal(client.responses[0]!.response.id,23);
});

test("unlock restores only an undecided same-account event and invalidates its old approval lease",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();
  const topic="4".repeat(64),account="0x"+"a".repeat(40),event=pendingRequest(topic,24);
  client.active[topic]={topic,peer:{metadata:{url:"https://example.com"}},namespaces:{eip155:{accounts:[`eip155:6423:${account}`],methods:["eth_accounts"],events:[]}}};
  client.handlers.get("session_request")!(event);
  const review={topic,requestId:24,account,method:"eth_accounts",params:[],peer:{metadata:{url:"https://example.com"}},expiresAt:new Date(Date.now()+60000).toISOString()};
  const old=runtime.bindReviewedRequest(review,runtime.snapshot().request);runtime.pauseForLock(account);
  assert.equal(runtime.snapshot().request,null);assert.throws(old.assertCurrent);
  assert.equal(await runtime.resumeAfterUnlock(account),true);assert.equal(runtime.snapshot().request,event);
  assert.throws(old.assertCurrent);await old.reject();assert.equal(runtime.snapshot().request,event);assert.equal(client.responses.length,0);
  const fresh=runtime.bindReviewedRequest(review,runtime.snapshot().request);await fresh.respond([account]);assert.equal(client.responses[0].response.id,24);
});

test("locked requests never resume after account switch, session drift, expiry or an already completed decision",async()=>{
  for(const action of ["account","namespace","expired","delete","decided"]){
    const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();
    const topic="5".repeat(64),account="0x"+"a".repeat(40),event=pendingRequest(topic,25);
    client.active[topic]={topic,peer:{metadata:{url:"https://example.com"}},namespaces:{eip155:{accounts:[`eip155:6423:${account}`],methods:["eth_accounts"],events:[]}}};client.handlers.get("session_request")!(event);
    if(action==="decided")await runtime.respond([account]);runtime.pauseForLock(account);
    if(action==="namespace")client.handlers.get("session_update")!({topic,params:{namespaces:{}}});
    if(action==="expired")client.active[topic].expiry=1;
    if(action==="delete")client.handlers.get("session_delete")!({topic});
    assert.equal(await runtime.resumeAfterUnlock(action==="account"?"0x"+"b".repeat(40):account),false);assert.equal(runtime.snapshot().request,null);
    assert.equal(client.responses.filter(r=>Object.hasOwn(r.response,"result")).length,action==="decided"?1:0);
  }
});

test("locking while SDK connection approval is pending cannot restore or publish that decided proposal",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),approve=client.approveSession.bind(client);
  client.approveSession=async(value:any)=>{await gate;return approve(value)};
  client.handlers.get("session_proposal")!(pendingProposal());
  const approving=runtime.approveProposal({eip155:{accounts:[],methods:[],events:[]}} as any);
  assert.equal(runtime.snapshot().proposal,null);runtime.pauseForLock("0x"+"a".repeat(40));
  assert.equal(await runtime.resumeAfterUnlock("0x"+"a".repeat(40)),false);
  release();await assert.rejects(approving,/authorization changed/);assert.equal(client.disconnects.length,1);assert.equal(runtime.snapshot().sessions.length,0);
});

test("first arrival while locked retains one authorized request and proposal for fresh review only",async()=>{
  for(const action of ["same","account","namespace","expired","delete"]){
    const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();
    const account="0x"+"a".repeat(40),topic="6".repeat(64),event=pendingRequest(topic,26),proposal={...pendingProposal(),params:{expiryTimestamp:Math.floor(Date.now()/1000)+60}};
    client.active[topic]={topic,peer:{metadata:{url:"https://example.com"}},namespaces:{eip155:{accounts:[`eip155:6423:${account}`],methods:["eth_accounts"],events:[]}}};
    runtime.pauseForLock(account);client.handlers.get("session_request")!(event);client.handlers.get("session_proposal")!(proposal);
    runtime.pauseForLock(account);assert.equal(runtime.snapshot().request,null);assert.equal(runtime.snapshot().proposal,null);assert.equal(client.responses.length,0);
    client.handlers.get("session_request")!(pendingRequest(topic,27));assert.equal(client.responses[0].response.id,27);
    if(action==="namespace")client.handlers.get("session_update")!({topic,params:{namespaces:{}}});
    if(action==="expired")client.active[topic].expiry=1;
    if(action==="delete")client.handlers.get("session_delete")!({topic});
    await runtime.resumeAfterUnlock(action==="account"?"0x"+"b".repeat(40):account);
    assert.equal(runtime.snapshot().request,action==="same"?event:null);
    assert.equal(runtime.snapshot().proposal,action==="account"?null:proposal);
    assert.equal(client.responses.some(r=>Object.hasOwn(r.response,"result")),false);
  }
});

test("completed local request decisions cannot be approved again after response transport failure",async()=>{
  const client=fakeClient(),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>client) as any);await runtime.start();const topic="9".repeat(64);client.failResponses=true;
  client.handlers.get("session_request")!(pendingRequest(topic,14));
  await assert.rejects(runtime.respond("0x1"),/response unavailable/);assert.equal(runtime.snapshot().request,null);
  client.handlers.get("session_request")!(pendingRequest(topic,15));
  await assert.rejects(runtime.rejectRequest(),/response unavailable/);assert.equal(runtime.snapshot().request,null);
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

const pairingUri=(topic:string)=>`wc:${topic}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`;
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

test("pair deadline releases busy state, quarantines late proposals and permits a fresh retry",async()=>{
  const client=fakeClient(),cleanups:string[]=[],rejected:number[]=[];let finish!:()=>void;
  client.pair=()=>new Promise<void>(resolve=>{finish=resolve});
  Object.assign(client,{core:{pairing:{disconnect:async({topic}:any)=>{cleanups.push(topic)}}}});
  client.rejectSession=async(value?:any)=>{rejected.push(value.id)};
  const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,10);await runtime.start();
  const old="1".repeat(64),fresh="2".repeat(64);
  await assert.rejects(runtime.pair(pairingUri(old)),/timed out/);
  assert.equal(runtime.snapshot().pairing,false);await tick();assert.equal(runtime.snapshot().pairingCleanup,"sdk-confirmed");
  await assert.rejects(runtime.pair(pairingUri(old)),/fresh QR/);
  client.pair=async()=>{};await runtime.pair(pairingUri(fresh));
  const proposal={...pendingProposal(),id:91,params:{...pendingProposal().params,pairingTopic:old}};
  client.handlers.get("session_proposal")!(proposal);assert.equal(runtime.snapshot().proposal,null);
  finish();await tick();assert.equal(cleanups.filter(topic=>topic===old).length,2);assert.deepEqual(rejected,[91]);
  const current={...proposal,id:92,params:{...proposal.params,pairingTopic:fresh}};
  client.handlers.get("session_proposal")!(current);assert.equal(runtime.snapshot().proposal,current);
});

test("cancel and account lock settle pairing promptly even when cleanup fails, with no late review",async()=>{
  for(const action of ["cancel","lock"]){
    const client=fakeClient();let finish!:()=>void;
    client.pair=()=>new Promise<void>(resolve=>{finish=resolve});
    Object.assign(client,{core:{pairing:{disconnect:async()=>{throw new Error("relay unavailable")}}}});
    const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,100);await runtime.start();
    const topic="3".repeat(64),pairing=runtime.pair(pairingUri(topic));await tick();
    const rejected=assert.rejects(pairing,/canceled/);
    if(action==="lock")runtime.pauseForLock("0x"+"a".repeat(40));else runtime.cancelPair();
    await rejected;await tick();assert.equal(runtime.snapshot().pairing,false);assert.equal(runtime.snapshot().pairingCleanup,"unconfirmed");
    finish();await tick();client.handlers.get("session_proposal")!({...pendingProposal(),params:{...pendingProposal().params,pairingTopic:topic}});
    await runtime.resumeAfterUnlock("0x"+"c".repeat(40));assert.equal(runtime.snapshot().proposal,null);
  }
});

test("SDK pair rejection recovers and rejects malformed URI before transport",async()=>{
 const client=fakeClient();let calls=0;client.pair=async()=>{calls++;throw new Error("transport failed")};
 const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,100);await runtime.start();
 await assert.rejects(runtime.pair("wc:invalid"));assert.equal(calls,0);
 await assert.rejects(runtime.pair(pairingUri("4".repeat(64))),/transport failed/);assert.equal(runtime.snapshot().pairing,false);
 await tick();assert.equal(runtime.snapshot().pairingCleanup,"unconfirmed");
 client.pair=async()=>{};await runtime.pair(pairingUri("5".repeat(64)));assert.equal(runtime.snapshot().pairing,false);
});

test("a canceled visible proposal is removed before transport cleanup and cannot approve later",async()=>{
 const client=fakeClient();client.pair=()=>new Promise<void>(()=>{});
 Object.assign(client,{core:{pairing:{disconnect:async()=>{}}}});
 const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,100);await runtime.start();
 const topic="6".repeat(64),pairing=runtime.pair(pairingUri(topic));await tick();
 client.handlers.get("session_proposal")!({...pendingProposal(),params:{...pendingProposal().params,pairingTopic:topic}});
 assert.ok(runtime.snapshot().proposal);await pairing;runtime.cancelPair();
 assert.equal(runtime.snapshot().proposal,null);await assert.rejects(runtime.approveProposal({}),/No WalletConnect proposal/);
});

test("SDK cleanup timeout is explicitly unconfirmed and never keeps pair busy",async()=>{
 const client=fakeClient();client.pair=()=>new Promise<void>(()=>{});
 Object.assign(client,{core:{pairing:{disconnect:()=>new Promise<void>(()=>{})}}});
 const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,10);await runtime.start();
 await assert.rejects(runtime.pair(pairingUri("7".repeat(64))),/timed out/);
 assert.equal(runtime.snapshot().pairing,false);assert.equal(runtime.snapshot().pairingCleanup,"pending");
 await new Promise(resolve=>setTimeout(resolve,3050));assert.equal(runtime.snapshot().pairingCleanup,"unconfirmed");
});

test("valid proposal received during deferred SDK pair survives automatic lock/unlock as the same event",async()=>{
 const client=fakeClient();client.pair=()=>new Promise<void>(()=>{});const cleanups:string[]=[];
 Object.assign(client,{core:{pairing:{disconnect:async({topic}:any)=>{cleanups.push(topic)}}}});
 const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,100);await runtime.start();
 const topic="8".repeat(64),pairing=runtime.pair(pairingUri(topic));await tick();
 const proposal={...pendingProposal(),params:{...pendingProposal().params,pairingTopic:topic,expiryTimestamp:Math.floor(Date.now()/1000)+60}};
 client.handlers.get("session_proposal")!(proposal);runtime.pauseForLock("0x"+"a".repeat(40));await pairing;
 assert.equal(runtime.snapshot().proposal,null);await runtime.resumeAfterUnlock("0x"+"a".repeat(40));assert.equal(runtime.snapshot().proposal,proposal);assert.deepEqual(cleanups,[]);
});

test("persistent quarantine is written before transport and blocks old proposals after cold restart",async()=>{
 const values=new Map<string,string>();const storage={getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:string)=>{values.set(key,value)},deleteItem:async(key:string)=>{values.delete(key)}};
 const journal=new WalletConnectPairingJournal(storage),client=fakeClient();client.pair=async()=>{assert.deepEqual(await journal.load(),["9".repeat(64)]);throw new Error("relay failed")};
 const first=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,100,journal);await first.start();await assert.rejects(first.pair(pairingUri("9".repeat(64))));
 const secondClient=fakeClient(),second=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>secondClient) as any,100,new WalletConnectPairingJournal(storage));await second.start();
 secondClient.handlers.get("session_proposal")!({...pendingProposal(),params:{...pendingProposal().params,pairingTopic:"9".repeat(64)}});assert.equal(second.snapshot().proposal,null);
 await assert.rejects(second.pair(pairingUri("9".repeat(64))),/fresh QR/);await second.pair(pairingUri("a".repeat(64)));
});

test("unverified secure journal write prevents SDK pairing",async()=>{
 let calls=0;const client=fakeClient();client.pair=async()=>{calls++};
 const journal=new WalletConnectPairingJournal({getItem:async()=>null,setItem:async()=>{},deleteItem:async()=>{}});
 const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,100,journal);await runtime.start();
 await assert.rejects(runtime.pair(pairingUri("c".repeat(64))),/could not be verified/);assert.equal(calls,0);
});

test("automatic Modal disposal preserves approved session and cold restoration does not revoke it",async()=>{
 const client=fakeClient(),cleanups:string[]=[];Object.assign(client,{core:{pairing:{disconnect:async({topic}:any)=>{cleanups.push(topic)}}}});
 const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,100);await runtime.start();const topic="d".repeat(64);await runtime.pair(pairingUri(topic));
 client.handlers.get("session_proposal")!({...pendingProposal(),params:{...pendingProposal().params,pairingTopic:topic}});const session=await runtime.approveProposal({});runtime.refreshSessions();runtime.cancelPendingPair();
 assert.ok(client.active[session.topic]);assert.deepEqual(cleanups,[]);assert.deepEqual(client.disconnects,[]);
 const cold=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any);await cold.start();assert.equal(cold.snapshot().sessions[0]?.topic,session.topic);assert.deepEqual(client.disconnects,[]);
});

test("old late proposal cannot replace a newer attempt that has also timed out",async()=>{
 const client=fakeClient();client.pair=()=>new Promise<void>(()=>{});
 const runtime=new WalletConnectRuntime({projectId:"a".repeat(32)},(async()=>client) as any,10);await runtime.start();
 for(const topic of ["e".repeat(64),"f".repeat(64)])await assert.rejects(runtime.pair(pairingUri(topic)),/timed out/);
 for(const topic of ["e".repeat(64),"f".repeat(64)])client.handlers.get("session_proposal")!({...pendingProposal(),params:{...pendingProposal().params,pairingTopic:topic}});
 assert.equal(runtime.snapshot().proposal,null);assert.equal(runtime.snapshot().pairing,false);
});
