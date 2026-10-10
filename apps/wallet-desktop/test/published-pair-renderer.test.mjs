import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {ApprovalReviewQueue} from "../src/approval-review-queue.mjs";
import {SESSION_COPY} from "../src/wallet-locale-sessions.mjs";

test("Relay waiting copy exists for every existing Wallet session locale",()=>{
  assert.equal(Object.keys(SESSION_COPY).length,12);
  for(const copy of Object.values(SESSION_COPY))for(const key of ["WalletConnect not started","The Relay connection is not yet confirmed. Your wallet and accounts remain accessible."]){
    assert.equal(typeof copy[key],"string");assert.ok(copy[key].length>0);
  }
  assert.match(SESSION_COPY["zh-Hans"]["The Relay connection is not yet confirmed. Your wallet and accounts remain accessible."],/尚未确认/);
});

test("normal connection title and detail distinguish Relay proof from startup failure",async()=>{
  const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
  const start=source.indexOf("function renderWalletConnect(payload)");
  const render=payload=>{
    const context={pairCancel:{},pairButton:{},walletConnectTitle:{},walletConnectDetail:{},copyUI:(node,text)=>{node.textContent=text},payload};
    runInNewContext(source.slice(start,source.indexOf("async function refreshWalletConnectSessions",start))+"\nrenderWalletConnect(payload)",context);
    return context;
  };
  const waiting="The Relay connection is not yet confirmed. Your wallet and accounts remain accessible.";
  const unavailable="The connection service is unavailable. Your wallet and accounts remain accessible.";
  const cases=[
    [{configured:true,started:true,relayConnected:false,code:"WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED"},"Connecting to WalletConnect…",waiting,false],
    [{configured:true,started:false,relayConnected:false,code:"WALLETCONNECT_RELAY_CONNECTION_NOT_PROVED"},"WalletConnect not started",waiting,true],
    [{configured:true,started:true,relayConnected:true,code:null},"Ready to connect an app","0 connected apps. You review every signature and transaction.",false],
    [{configured:true,started:false,relayConnected:false,code:"WALLETCONNECT_START_FAILED"},"WalletConnect unavailable",unavailable,true],
    [{configured:true,started:true,relayConnected:true,code:"WALLETCONNECT_REVIEW_WRITE_UNCONFIRMED"},"WalletConnect unavailable",unavailable,true],
    [{configured:false,started:false,relayConnected:false,code:"WALLETCONNECT_PROJECT_ID_UNAVAILABLE"},"Cross-device connections are coming","WalletConnect is not enabled in this build. You can still connect directly from supported YNX apps.",true]
  ];
  for(const [state,title,detail,disabled] of cases)for(const wrapped of [false,true]){
    const value={...state,activeSessionCount:0,pairing:false,pair:{phase:"idle"}},h=render(wrapped?{ok:true,value}:value);
    assert.equal(h.walletConnectTitle.textContent,title);assert.equal(h.walletConnectDetail.textContent,detail);
    assert.equal(h.pairButton.disabled,disabled);assert.equal(h.pairCancel.hidden,true);
  }
});

test("normal connection renderer keeps cancellation available while pairing and shows terminal fresh-QR guidance",async()=>{
  const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
  const start=source.indexOf("function renderWalletConnect(payload)");
  for(const phase of ["pairing","proposal-received","canceled","timed-out","failed"]){
    const pairCancel={},pairButton={},walletConnectTitle={},walletConnectDetail={};
    runInNewContext(source.slice(start,source.indexOf("async function refreshWalletConnectSessions",start))+"\nrenderWalletConnect(status)",{
      pairCancel,pairButton,walletConnectTitle,walletConnectDetail,
      copyUI:(node,text)=>{node.textContent=text},status:{configured:true,started:true,relayConnected:true,activeSessionCount:0,pairing:phase==="pairing",pair:{phase}},
    });
    assert.equal(pairCancel.hidden,phase!=="pairing");assert.equal(pairButton.disabled,phase==="pairing");
    if(["canceled","timed-out","failed"].includes(phase))assert.match(walletConnectDetail.textContent,/fresh QR/);
    if(phase==="proposal-received")assert.match(walletConnectDetail.textContent,/Review before approving/);
  }
});

test("blur preserves an unexpired public review without resuming or reusing an in-flight key decision",()=>{
  let now=1000;const queue=new ApprovalReviewQueue({now:()=>now});
  queue.enqueue("provider",{id:"original",expiresAt:new Date(2000).toISOString()});
  const original=queue.current;queue.suspend();assert.equal(queue.current,original);
  assert.equal(queue.begin(original.key),original);queue.suspend();assert.equal(queue.begin(original.key),null);
  queue.finish(original.key);assert.equal(queue.current,null);
  queue.enqueue("provider",{id:"expires",expiresAt:new Date(2000).toISOString()});now=2000;queue.suspend();assert.equal(queue.current,null);
});
