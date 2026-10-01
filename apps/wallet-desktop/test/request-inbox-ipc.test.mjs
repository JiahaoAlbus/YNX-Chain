import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import {WalletConnectRequestInbox} from "../src/walletconnect-request-inbox.mjs";

const source = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
function installHandler(name, end, context) {
  let handler;
  const start = source.indexOf(`handleWalletIPC("${name}"`);
  runInNewContext(source.slice(start, source.indexOf(end, start)), {
    handleWalletIPC: (_name, value) => { handler = value; }, ...context
  });
  return handler;
}

test("native provider approval retains its existing authority without requiring a Pair inbox entry", async () => {
  let approved = 0;
  const handler = installHandler("wallet:provider-action", "\nasync function handleCallback", {
    sensitiveIPC: async (action, options) => { options.assertCurrent(); return action(); },
    keyAccess: { current: () => ({}) }, walletConnectRequests: new Map(),
    walletConnectInbox: { assertLive: () => { throw new Error("Native requests must not use the Pair inbox"); } },
    walletAuthority: { approve: async id => { assert.equal(id, "native-review"); approved++; return { status: "success" }; } },
    accountChangeInProgress: false
  });
  const result = await handler(null, "native-review", "approve");
  assert.equal(result.status, "success");
  assert.equal(result.responseDelivered, false);
  assert.equal(approved, 1);
});

test("local disconnect ends only its own queued requests before SDK disconnect, without waiting for a delete event", async () => {
  const ended = [], order = [], entries = [{ key: "a", event: { topic: "topic-a" } }, { key: "b", event: { topic: "topic-b" } }];
  const handler = installHandler("wallet:walletconnect-disconnect", '\nhandleWalletIPC("wallet:walletconnect-proposal-action"', {
    safeIPC: action => action(),
    walletConnectInbox: { pending: () => entries, finish: key => { ended.push(key); } },
    terminateWalletConnectReview: async entry => { order.push(`end:${entry.key}`); },
    walletAuthority: { revokeOrigin: async () => { order.push("revoke"); } },
    walletConnect: { sessionOrigin: () => "https://dapp.example", disconnectSession: async () => { order.push("disconnect"); return { disconnected: true }; } },
    mainWindow: null
  });
  const result = await handler(null, "topic-a");
  assert.deepEqual(ended, ["a"]);
  assert.deepEqual(order, ["end:a", "revoke", "disconnect"]);
  assert.equal(result.localPermissionRevoked, true);
});
test("actual provider IPC refuses missing original decision storage before authority signing and keeps rejection distinct",async()=>{
 for(const mode of ["missing","approve","reject"]){const values=new Map(),store={getItem:async key=>structuredClone(values.get(key)),setItem:async(key,value)=>{values.set(key,structuredClone(value));}},inbox=new WalletConnectRequestInbox(),account="0x"+"a".repeat(40);await inbox.start(store);
 const entry=inbox.accept({topic:"topic-a",id:1,params:{chainId:"eip155:6423",request:{method:"personal_sign",params:["0x01",account]}}},{origin:"https://dapp.example",sessionBinding:"bound-session"},account).entry;await inbox.persist();inbox.stage(entry,"review");if(mode==="missing")values.clear();let signed=0;const replies=[],lease={assert(){},deliver:async use=>use()};
 const handler=installHandler("wallet:provider-action","\nasync function handleCallback",{sensitiveIPC:async(action,options)=>{options.assertCurrent();return action();},keyAccess:{current:()=>lease,status:()=>({account})},walletConnectRequests:new Map([["review",{topic:"topic-a",jsonRpcId:1,entryKey:entry.key}]]),walletConnectInbox:inbox,walletAuthority:{approve:async()=>{signed++;return{status:"success",result:"synthetic-signed-result"};},expire(){},reject(){throw Object.assign(new Error("User rejected"),{code:4001});}},rejectProviderRequest(){throw Object.assign(new Error("User rejected"),{code:4001});},walletConnect:{authorizeRequest:()=>({origin:entry.origin,sessionBinding:entry.sessionBinding}),respond:async(topic,id,response)=>{replies.push({topic,id,response});}},accountChangeInProgress:false});
 if(mode==="missing"){await assert.rejects(handler(null,"review","approve"));assert.equal(signed,0);assert.equal(replies.length,0);}else{await handler(null,"review",mode);assert.equal(signed,mode==="approve"?1:0);assert.equal(replies[0].response.status,mode==="approve"?"success":"error");if(mode==="reject")assert.equal(replies[0].response.code,4001);const cold=new WalletConnectRequestInbox();await cold.start(store,[entry.key]);assert.equal(cold.accept({...entry.event,restored:true},{origin:entry.origin,sessionBinding:"bound-session"},account).entry,null);}
 }
});
