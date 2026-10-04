import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {ApprovalReviewQueue} from "../src/approval-review-queue.mjs";

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
