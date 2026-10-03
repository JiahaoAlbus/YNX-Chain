import test from "node:test";
import assert from "node:assert/strict";
import {replayAwareAppend,recoverLastFailed,isFailure,type SimulationInput} from "./simulation";

const now=(timestamp:string)=>new Date(timestamp);

test("simulation replay detection keeps one canonical record for same idempotency key",()=>{
  const base:SimulationInput={
    kind:"authorization",
    cardId:"card_1",
    merchant:"YNX Demo Merchant",
    amountMinor:1200,
    currency:"YNXT",
    idempotencyKey:"auth-ynxt-001",
    txHash:"0x1111111111111111111111111111111111111111111111111111111111111111",
    chainId:"0x1917",
  };

  const first=replayAwareAppend([],base,"first",now("2026-08-20T00:00:00.000Z"));
  assert.throws(()=>replayAwareAppend(first.next,{...base,amountMinor:1300},"second",now("2026-08-20T00:00:01.000Z")),/IDEMPOTENCY_CONFLICT/);
  const second=replayAwareAppend(first.next,base,"second",now("2026-08-20T00:00:01.000Z"));

  assert.equal(first.next.length,1);
  assert.equal(second.next.length,1);
  assert.equal(second.duplicate,true);
  assert.equal(second.entry,first.entry);
  assert.equal(second.next,first.next);
  assert.equal(second.entry.status,"accepted");
});

test("recoverLastFailed preserves failed outcomes without authoritative evidence",()=>{
  const first=replayAwareAppend([],{
    kind:"refund",
    cardId:"card_1",
    merchant:"YNX Demo Merchant",
    amountMinor:500,
    currency:"YNXT",
    idempotencyKey:"refund-ynxt-001",
    txHash:"0x1111111111111111111111111111111111111111111111111111111111112222",
    chainId:"0x1917",
  },"first",now("2026-08-20T00:00:00.000Z"));

  const failed=[{...first.entry,status:"failed",reason:"declined",createdAt:first.entry.createdAt,updatedAt:first.entry.updatedAt}];
  const recovered=recoverLastFailed(failed);
  const record=recovered[0];

  assert.equal(recovered.length,1);
  assert.equal(record.status,"failed");
  assert.equal(isFailure(record),true);
  assert.equal(record.reason,"declined");
});

test("same-millisecond events remain distinct and unsafe minor amounts reject",()=>{
  const base:SimulationInput={kind:"authorization",cardId:"card_1",merchant:"Demo",amountMinor:1,currency:"YNXT",idempotencyKey:"auth-key-1"};
  const first=replayAwareAppend([],base,"local simulation",now("2026-08-20T00:00:00.000Z"));
  const second=replayAwareAppend(first.next,{...base,idempotencyKey:"auth-key-2"},"local simulation",now("2026-08-20T00:00:00.000Z"));
  assert.notEqual(first.entry.id,second.entry.id);
  assert.throws(()=>replayAwareAppend([],{...base,amountMinor:Number.MAX_SAFE_INTEGER+1},"invalid"),/safe minor/);
});

test("failed same-key retry cannot turn into a recovered outcome",()=>{
  const input:SimulationInput={kind:"refund",cardId:"card_1",merchant:"Demo",amountMinor:1,currency:"YNXT",idempotencyKey:"refund-key-1"};
  const first=replayAwareAppend([],input,"local simulation");
  const failed={...first.entry,status:"failed" as const,reason:"original denial"};
  const result=replayAwareAppend([failed],input,"unproven retry");
  assert.equal(result.entry,failed);assert.equal(result.entry.status,"failed");
});
