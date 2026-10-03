import test from "node:test";
import assert from "node:assert/strict";
import {cancel,completeFromSandboxReceipt,createDraft,degrade,requestApproval,restoreForWallet,submitForBackend,updateDraft} from "./registration";
const wallet="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",now=new Date("2026-08-21T06:00:00.000Z");
const draft=()=>updateDraft(createDraft(wallet,now),{nickname:"Testnet travel",useCase:"Practice YNXT sandbox flows",spendingLimitYnxt:"25",riskAccepted:true,controls:{online:true,international:false,frozen:false}},now);
test("cached ACTIVE and SUBMITTED require backend readback while retaining original fields/key/receipt",()=>{
  const submitted=submitForBackend(requestApproval(draft(),"approval-1",now),"submit-1",now);
  const active=completeFromSandboxReceipt(submitted,{idempotencyKey:"receipt-1",approved:true,receipt:"sandbox-receipt-12345678"},now);
  for(const original of [submitted,active]) {
    const restored=restoreForWallet(JSON.parse(JSON.stringify(original)),wallet)!;
    assert.equal(restored.status,"DEGRADED");assert.equal(restored.reason,"BACKEND_READBACK_REQUIRED");
    assert.equal(restored.id,original.id);assert.equal(restored.idempotencyKey,original.idempotencyKey);
    assert.equal(restored.nickname,original.nickname);assert.equal(restored.backendReceipt,original.backendReceipt);
    assert.deepEqual(restored.audit,original.audit);
  }
});
test("malformed stored application controls/audit cannot enter a user journey",()=>{
  assert.equal(restoreForWallet({...draft(),controls:null},wallet),null);
  assert.equal(restoreForWallet({...draft(),audit:[{event:"ACTIVE"}]},wallet),null);
  assert.equal(restoreForWallet({...draft(),spendingLimitYnxt:"Infinity"},wallet),null);
});
test("wallet-bound registration transitions only with an explicit sandbox receipt",()=>{const approval=requestApproval(draft(),"approval-1",now),submitted=submitForBackend(approval,"submit-1",now),active=completeFromSandboxReceipt(submitted,{idempotencyKey:"receipt-1",approved:true,receipt:"sandbox-receipt-12345678"},now);assert.equal(approval.status,"APPROVAL_REQUIRED");assert.equal(submitted.status,"SUBMITTED");assert.equal(active.status,"ACTIVE");assert.equal(active.audit.length,4);});
test("registration is idempotent, recoverable and isolated per wallet",()=>{const approval=requestApproval(draft(),"approval-1",now);assert.equal(requestApproval(approval,"approval-1",now),approval);const degraded=degrade(submitForBackend(approval,"submit-1",now),"No backend receipt","degraded-1",now);assert.equal(degraded.status,"DEGRADED");assert.equal(restoreForWallet(degraded,wallet)?.id,degraded.id);assert.equal(restoreForWallet(degraded,"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),null);assert.equal(cancel(draft(),"cancel-1",now).status,"CANCELLED");assert.throws(()=>completeFromSandboxReceipt(submitForBackend(approval,"submit-1",now),{idempotencyKey:"receipt-2",approved:true},now),/verified sandbox receipt/i);});
