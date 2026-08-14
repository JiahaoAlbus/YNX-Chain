import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSensitiveOperationActive, ExclusiveAttemptGate } from "./sensitiveOperationPolicy";

test("sensitive Wallet operations require the active exact binding and generation",()=>{
  const attempt={generation:4,binding:"ynx1account"},current={generation:4,binding:"ynx1account",active:true};
  assert.doesNotThrow(()=>assertSensitiveOperationActive(attempt,current));
  assert.throws(()=>assertSensitiveOperationActive(attempt,{...current,active:false}),/dismissed|background/);
  assert.throws(()=>assertSensitiveOperationActive(attempt,{...current,generation:5}),/dismissed|background/);
  assert.throws(()=>assertSensitiveOperationActive(attempt,{...current,binding:"ynx1other"}),/binding changed/);
});

test("exclusive sensitive attempt gate rejects reentry until the first attempt releases",()=>{
  const gate=new ExclusiveAttemptGate(),release=gate.tryBegin();
  assert.equal(typeof release,"function");
  assert.equal(gate.tryBegin(),null);
  release?.();release?.();
  assert.equal(typeof gate.tryBegin(),"function");
});
