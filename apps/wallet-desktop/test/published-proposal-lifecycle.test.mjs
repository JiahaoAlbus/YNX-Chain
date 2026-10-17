import assert from "node:assert/strict";
import test from "node:test";
import {DesktopKeyLifecycle} from "../src/key-lifecycle.mjs";
import {WalletConnectTransport} from "../src/walletconnect-transport.mjs";

// Real lifecycle and transport classes; synthetic SDK only, no real account or Relay.
const account="0x"+"a".repeat(40), now=2_000_000_000_000;
for(const lockAfterStart of [false,true])test(`outward connection approval ${lockAfterStart?"quarantines late result after lock":"keeps effect checks without reopening key access"}`,async()=>{
  const handlers=new Map(), result=Promise.withResolvers(), entered=Promise.withResolvers();
  const session={topic:"synthetic-topic",expiry:now/1000+600,peer:{metadata:{url:"https://dapp.example"}},namespaces:{eip155:{accounts:[`eip155:6423:${account}`],methods:["personal_sign"],events:[]}}};
  let disconnected=0;
  const kit={on:(name,handler)=>handlers.set(name,handler),getActiveSessions:()=>({}),approveSession:async()=>{entered.resolve();return result.promise},disconnectSession:async()=>{disconnected++}};
  const transport=new WalletConnectTransport({projectId:"synthetic-only",walletKitFactory:async()=>kit,clock:()=>now});
  await transport.start();
  await handlers.get("session_proposal")({id:1,expiryTimestamp:now/1000+600,params:{proposer:{metadata:{url:"https://dapp.example"}},requiredNamespaces:{eip155:{chains:["eip155:6423"],methods:["personal_sign"],events:[]}}}});
  const lifecycle=new DesktopKeyLifecycle({focused:()=>true,authorizer:{available:()=>true,authenticate:async()=>{},method:"synthetic"}});
  lifecycle.setAccount(account);await lifecycle.unlock();
  const pending=lifecycle.run(async lease=>{
    await lease.deliver(()=>transport.approveSession(1,account,lease.assertEffectCurrent));
    assert.throws(lease.assert,error=>error.data.code==="WALLET_OPERATION_CANCELLED");
  });
  await entered.promise;if(lockAfterStart)lifecycle.lock();result.resolve(session);
  if(lockAfterStart){await assert.rejects(pending,error=>error.data.outcomeUnknown===true);assert.equal(disconnected,1);assert.throws(()=>transport.sessionOrigin(session.topic));}
  else{await pending;assert.equal(disconnected,0);assert.equal(transport.sessionOrigin(session.topic),"https://dapp.example");}
});
