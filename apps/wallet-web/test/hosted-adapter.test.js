import assert from "node:assert/strict";
import test from "node:test";
import { createHostedWalletAdapter } from "../src/hosted-adapter.js";
import { HOSTED_WALLET_ORIGIN, hostedEnvelope, parseHostedConnect } from "../src/hosted-protocol.js";

const account = `0x${"ab".repeat(20)}`;
function fixture() {
  let message;
  const popup = { closed: false, sent: [], postMessage(value) { this.sent.push(value); } };
  const browserWindow = {
    location: { origin: "https://finance.ynxweb4.com" },
    addEventListener(name, listener) { if (name === "message") message = listener; },
    removeEventListener() {},
    open(url) { popup.request = parseHostedConnect(new URL(url).hash.slice(9)); return popup; },
    setInterval, clearInterval, setTimeout, clearTimeout,
  };
  const adapter = createHostedWalletAdapter({ window: browserWindow });
  const send = (type, extra = {}) => message({ source: popup, origin: HOSTED_WALLET_ORIGIN, data: hostedEnvelope(popup.request, type, extra) });
  return { adapter, popup, send };
}
test("throwing account listener cannot leave connect pending or prevent other listeners", async t => {
  const { adapter, popup, send } = fixture(), events = [];
  t.after(() => adapter.detach());
  adapter.on("accountsChanged", () => { throw new Error("consumer callback"); });
  adapter.on("accountsChanged", value => events.push(value));
  adapter.on("connect", () => { throw new Error("consumer callback"); });
  const connected = adapter.connect();
  send("ready");
  assert.equal(popup.sent.at(-1).type, "hello");
  send("connected", { replyTo: popup.sent.at(-1).messageId, account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 - 1000 });
  assert.deepEqual(await Promise.race([connected, new Promise((_, reject) => setTimeout(() => reject(new Error("connect pending")), 500))]), [account]);
  assert.deepEqual(events, [[account]]);
  assert.equal(adapter.connected, true);
  assert.ok(popup.request.expiresAt - Date.now() <= 120_000, "the initial handshake stays bounded");
  await adapter.detach();
  assert.deepEqual(events.at(-1), []);
});
test("synchronous detach inside a listener cannot revive an old connection", async t => {
  const { adapter, popup, send } = fixture();
  t.after(() => adapter.detach());
  adapter.on("accountsChanged", accounts => { if (accounts.length) void adapter.detach(); });
  const connected = adapter.connect();
  send("ready");
  send("connected", { replyTo: popup.sent.at(-1).messageId, account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 - 1000 });
  await assert.rejects(connected, { code: "HOSTED_DISCONNECTED" });
  assert.equal(adapter.connected, false);
  assert.deepEqual(await adapter.restore(), []);
});
test("connected approval extends the channel beyond handshake but never beyond one hour", async t => {
  const { adapter, popup, send } = fixture();
  t.after(() => adapter.detach());
  const connected = adapter.connect();
  send("connected", { replyTo: "unsolicited", account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 - 1000 });
  assert.equal(adapter.connected, false, "unsolicited connected is ignored");
  send("ready");
  send("connected", { replyTo: popup.sent.at(-1).messageId, account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 + 60_000 });
  assert.equal(adapter.connected, false, "an unbounded approval envelope is ignored");
  send("connected", { replyTo: popup.sent.at(-1).messageId, account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 - 1000 });
  assert.deepEqual(await connected, [account]);
  await adapter.detach();
});

for (const [reason, code, revokes] of [["HOSTED_POPUP_CLOSED", "HOSTED_POPUP_CLOSED", false], [undefined, "HOSTED_DISCONNECTED", true], ["unknown", "HOSTED_DISCONNECTED", true]]) {
 test(`authenticated lifecycle reason ${reason} clears transport with revocation=${revokes}`, async t => {
  const {adapter,popup,send}=fixture(), accounts=[],disconnects=[];t.after(()=>adapter.detach());
  adapter.on("accountsChanged",value=>accounts.push(value));adapter.on("disconnect",value=>disconnects.push(value));
  const connecting=adapter.connect();send("ready");send("connected",{replyTo:popup.sent.at(-1).messageId,account,chainId:"0x1917",sessionExpiresAt:Date.now()+60000});await connecting;
  const pending=adapter.request({method:"personal_sign",params:["0x01",account]});
  send("disconnected",{reason});await assert.rejects(pending,{code});
  assert.equal(adapter.connected,false);assert.equal(adapter.account,null);assert.deepEqual(await adapter.restore(),[]);
  assert.deepEqual(disconnects,[{code}]);assert.deepEqual(accounts,revokes?[[account],[]]:[[account]]);
  await assert.rejects(adapter.request({method:"personal_sign",params:["0x01",account]}),{code:"HOSTED_DISCONNECTED"});
  const previous=popup.sent.at(-1);send("response",{replyTo:previous.messageId,ok:true,result:"late"});assert.equal(adapter.connected,false);
 });
}

function demandFixture() {
  let message;
  const popups=[], memory=new Map();
  const window={location:{origin:"https://finance.ynxweb4.com"},sessionStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)},
    addEventListener:(_name,listener)=>{message=listener;},removeEventListener(){},setInterval,clearInterval,setTimeout,clearTimeout,
    open(url){const popup={closed:false,sent:[],request:parseHostedConnect(new URL(url).hash.slice(9)),postMessage(value){this.sent.push(value);}};popups.push(popup);return popup;}};
  const adapter=createHostedWalletAdapter({window});
  const send=(popup,type,extra={})=>message({source:popup,origin:HOSTED_WALLET_ORIGIN,data:hostedEnvelope(popup.request,type,extra)});
  const grant={id:"g".repeat(32),epoch:1,account,expiresAt:Date.now()+60000};
  const approve=popup=>{send(popup,"ready");send(popup,"connected",{replyTo:popup.sent.at(-1).messageId,account,chainId:"0x1917",sessionExpiresAt:grant.expiresAt,grant});};
  return {adapter,popups,send,approve,grant,window};
}
test('durable grant hint opens a fresh window synchronously and binds resumed signing to its handshake',async t=>{
  const f=demandFixture();t.after(()=>f.adapter.detach());const initial=f.adapter.connect();f.approve(f.popups[0]);await initial;
  const old=f.popups[0];old.closed=true;
  const signing=f.adapter.request({method:"personal_sign",params:["0x01",account]});
  assert.equal(f.popups.length,2,'opening precedes any asynchronous wait');
  const next=f.popups[1];assert.notEqual(next.request.nonce,old.request.nonce);
  f.send(old,"connected",{replyTo:old.sent[0].messageId,account,chainId:"0x1917",sessionExpiresAt:f.grant.expiresAt,grant:f.grant});
  assert.equal(next.sent.length,0,'old window cannot complete new handshake');
  f.send(next,"ready");assert.deepEqual(next.sent[0].resume,{id:f.grant.id,epoch:1,account});
  f.send(next,"connected",{replyTo:next.sent[0].messageId,account,chainId:"0x1917",sessionExpiresAt:f.grant.expiresAt,grant:f.grant});
  await new Promise(resolve=>setTimeout(resolve,0));
  const request=next.sent.at(-1);assert.equal(request.type,"request");
  f.send(next,"response",{replyTo:request.messageId,ok:false,code:"USER_REJECTED"});await assert.rejects(signing,{code:"USER_REJECTED"});
  assert.equal(f.adapter.connected,true,'rejecting a signature does not revoke connection');
  const again=f.adapter.request({method:"personal_sign",params:["0x01",account]});f.send(next,"response",{replyTo:next.sent.at(-1).messageId,ok:true,result:"approved"});assert.equal(await again,"approved");
});
test('resume verifies Wallet-owned grant instead of trusting a cached account or old epoch',async t=>{
  for(const code of ["HOSTED_GRANT_REVOKED_OR_EXPIRED","HOSTED_ACCOUNT_CHANGED"]){
    const f=demandFixture();t.after(()=>f.adapter.detach());const first=f.adapter.connect();f.approve(f.popups[0]);await first;f.popups[0].closed=true;
    const signing=f.adapter.request({method:"personal_sign",params:["0x01",account]});const next=f.popups[1];f.send(next,"ready");f.send(next,"rejected",{replyTo:next.sent[0].messageId,code});
    await assert.rejects(signing,{code});assert.equal(f.adapter.selection,null);assert.equal(next.sent.length,1,'no signature request follows denied resume');
  }
});
test('reserved popup rejection is retained across an asynchronous challenge and is retried only by another click',async t=>{
  const f=demandFixture();t.after(()=>f.adapter.detach());const first=f.adapter.connect();f.approve(f.popups[0]);await first;f.popups[0].closed=true;
  const opening=f.window.open;f.window.open=()=>null;
  await assert.rejects(f.adapter.reserve(),{code:"HOSTED_POPUP_BLOCKED"});
  await assert.rejects(f.adapter.request({method:"personal_sign",params:["0x01",account]}),{code:"HOSTED_POPUP_BLOCKED"});assert.equal(f.popups.length,1);
  f.window.open=opening;const retry=f.adapter.reserve();f.approve(f.popups[1]);await retry;
});
test('reloaded DApp hint is not live authority and explicit reconnect still needs Wallet validation',async t=>{
  const f=demandFixture();t.after(()=>f.adapter.detach());const first=f.adapter.connect();f.approve(f.popups[0]);await first;
  const second=createHostedWalletAdapter({window:f.window});t.after(()=>second.detach());assert.equal(second.connected,false);assert.deepEqual(await second.request({method:"eth_accounts"}),[]);
  const pending=second.connect();const next=f.popups[1];f.send(next,"ready");assert.equal(next.sent.at(-1).resume.id,f.grant.id);
  f.send(next,"rejected",{replyTo:next.sent.at(-1).messageId,code:"HOSTED_GRANT_REVOKED_OR_EXPIRED"});await assert.rejects(pending,{code:"HOSTED_GRANT_REVOKED_OR_EXPIRED"});
});
