import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import {documentMessageTarget,readCurrentDappDocument,RUNTIME_DOCUMENT_PROBE,validBrowserDocumentId} from "../src/extension-bridge.js";
import {SensitiveAuthorizationGuard} from "../src/extension-sensitive-policy.js";

const ORIGIN="https://dapp.example",ID="ynx-aaaaaaaa-1111-4111-8111-111111111111",DOC="FF2F212A00379D284FE8558A23819E2D",NONCE="a".repeat(64),source=await readFile(new URL("../extension/content-script.js",import.meta.url),"utf8");
test("browser document formats match Chromium's observed token and Firefox's explicit UUID contract",()=>{
  // Literal browser-owned InjectionResult.documentId from the fbf installed QA.
  assert.equal(validBrowserDocumentId(DOC),true);
  assert.deepEqual(documentMessageTarget({documentId:DOC}),{frameId:0,documentId:DOC});
  const firefox="11111111-2222-3333-4444-555555555555";
  assert.equal(validBrowserDocumentId(firefox),false);
  assert.equal(validBrowserDocumentId(firefox,{firefox:true}),true);
  assert.equal(validBrowserDocumentId(DOC,{firefox:true}),false);
  assert.deepEqual(documentMessageTarget({browserContext:"firefox-container-1",documentId:firefox}),{frameId:0,documentId:firefox});
  assert.deepEqual(documentMessageTarget({browserContext:"firefox-default"}),{frameId:0});
  for(const invalid of[undefined,null,"",DOC.slice(1),DOC+"A","0".repeat(32),"G".repeat(32)," "+DOC,`{${firefox}}`,firefox])assert.equal(validBrowserDocumentId(invalid),false);
  for(const invalid of["",DOC,firefox+"x",`{${firefox}}`])assert.equal(validBrowserDocumentId(invalid,{firefox:true}),false);
  assert.throws(()=>documentMessageTarget({documentId:firefox}),{code:"DOCUMENT_CHANGED"});
  assert.throws(()=>documentMessageTarget({}),{code:"DOCUMENT_CHANGED"});
});
function content(t,{send=async()=>({ok:true,result:[]})}={}){
  const listeners={},packets=[],replies=[],timers=new Set();let receiver;
  const window={addEventListener:(name,fn)=>{listeners[name]=fn},postMessage:data=>replies.push(data)};window.top=window;
  const context=vm.createContext({window,document:{prerendering:false},location:{origin:ORIGIN},crypto:webcrypto,Date,chrome:{runtime:{id:"fixture",sendMessage:message=>{packets.push(message);return send(message)},onMessage:{addListener:fn=>{receiver=fn}}}},setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);timers.add(id);return id},clearTimeout:id=>{clearTimeout(id);timers.delete(id)}});vm.runInContext(source,context);t.after(()=>{for(const id of timers)clearTimeout(id)});
  return{context,packets,replies,request:(extra={})=>listeners.message({source:window,origin:ORIGIN,data:{type:"YNX_PAGE_REQUEST_V1",version:1,requestId:ID,origin:ORIGIN,method:"eth_accounts",params:[],...extra}}),event:name=>listeners[name](),receive:(message,sender={id:"fixture"})=>{let value;receiver(message,sender,result=>{value=result});return value}};
}
const probe=(challenge=NONCE)=>({type:RUNTIME_DOCUMENT_PROBE,version:1,origin:ORIGIN,challenge});
test("real isolated content binds internal requests to a full nonce and cannot accept a page-supplied identity",async t=>{
  const c=content(t);c.request({documentNonce:NONCE});assert.equal(c.packets.length,0);c.request();await new Promise(resolve=>setImmediate(resolve));
  const nonce=c.packets[0].documentNonce;assert.match(nonce,/^[0-9a-f]{64}$/);assert.equal(c.receive(probe()).documentNonce,nonce);assert.equal(c.replies[0].requestId,ID);assert.equal(JSON.stringify(c.replies).includes(nonce),false);
  assert.equal(c.receive(probe(),{id:"other-extension"}),undefined);assert.equal(c.receive({...probe(),extra:true}),undefined);c.context.window.top={};assert.equal(c.receive(probe()),undefined);
});
test("pagehide and bfcache pageshow reject old replies/events and rotate the content activation",async t=>{
  let resolve;const c=content(t,{send:()=>new Promise(done=>{resolve=done})});c.request();const old=c.packets[0].documentNonce;c.event("pagehide");assert.equal(c.receive(probe()),undefined);c.event("pageshow");const next=c.receive(probe()).documentNonce;assert.notEqual(next,old);
  resolve({ok:true,result:["stale"]});await new Promise(done=>setImmediate(done));assert.equal(c.replies.length,0);
  const event={type:"YNX_DAPP_EVENT_V1",version:1,origin:ORIGIN,event:"accountsChanged",payload:[],documentNonce:old};c.receive(event);assert.equal(c.replies.length,0);c.receive({...event,documentNonce:next});assert.equal(c.replies.length,1);
});
test("initial pageshow preserves a document-start request and its original reply",async t=>{
  let resolve;const c=content(t,{send:()=>new Promise(done=>{resolve=done})});c.request();const nonce=c.packets[0].documentNonce;c.event("pageshow");assert.equal(c.receive(probe()).documentNonce,nonce);resolve({ok:true,result:[]});await new Promise(done=>setImmediate(done));assert.equal(c.replies.length,1);assert.equal(c.replies[0].requestId,ID);
});
test("document probe binds an exact fresh challenge and browser document target, failing closed on every response mismatch",async()=>{
  const lease={tabId:4,origin:ORIGIN,documentId:DOC},targets=[];let previous;
  const good=async(id,message,target)=>{assert.equal(id,4);targets.push(target);assert.match(message.challenge,/^[0-9a-f]{64}$/);assert.notEqual(message.challenge,previous);previous=message.challenge;return{version:1,origin:ORIGIN,challenge:message.challenge,documentNonce:NONCE}};
  assert.equal(await readCurrentDappDocument({tabs:{sendMessage:good}},lease),NONCE);assert.equal(await readCurrentDappDocument({tabs:{sendMessage:good}},lease),NONCE);assert.deepEqual(targets[0],{frameId:0,documentId:DOC});
  for(const patch of[{challenge:NONCE},{origin:"https://other.example"},{version:2},{documentNonce:"abcd"},{documentId:DOC}])await assert.rejects(readCurrentDappDocument({tabs:{sendMessage:async(id,m,target)=>({...await good(id,m,target),...patch})}},lease),{code:"DOCUMENT_CHANGED"});
  await assert.rejects(readCurrentDappDocument({tabs:{sendMessage:()=>new Promise(()=>{})}},lease,{timeoutMs:5}),{code:"DOCUMENT_CHANGED"});
});
test("the final document check follows account and permission awaits rather than trusting an earlier response",async()=>{
  let current=NONCE;const account="0x1111111111111111111111111111111111111111",guard=new SensitiveAuthorizationGuard({getTab:async()=>({id:1,url:ORIGIN,incognito:false}),getAccount:async()=>{current="b".repeat(64);return{account}},getPermission:async()=>({origin:ORIGIN,account,chainId:"0x1917",grantedAt:1}),getDocument:async()=>current});
  const lease=guard.capture({tabId:1,origin:ORIGIN,documentNonce:NONCE,account,grantedAt:1,deadlineAt:Date.now()+5000});await assert.rejects(guard.assert(lease),{code:"DOCUMENT_CHANGED"});
  assert.throws(()=>new SensitiveAuthorizationGuard({}),TypeError);
});
