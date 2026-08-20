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
  const second=replayAwareAppend(first.next,{...base,amountMinor:1300},"second",now("2026-08-20T00:00:01.000Z"));

  assert.equal(first.next.length,1);
  assert.equal(second.next.length,1);
  assert.equal(second.duplicate,true);
  assert.equal(second.entry.status,"duplicate");
});

test("recoverLastFailed marks failed simulation entries as recoverable",()=>{
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
  assert.equal(record.status,"recovered");
  assert.equal(isFailure(record),false);
  assert.match(record.reason,/Recovery/);
});
