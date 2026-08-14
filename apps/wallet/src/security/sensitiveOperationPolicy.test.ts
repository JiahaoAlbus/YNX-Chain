import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSensitiveOperationActive } from "./sensitiveOperationPolicy";

test("sensitive Wallet operations require the active exact binding and generation",()=>{
  const attempt={generation:4,binding:"ynx1account"},current={generation:4,binding:"ynx1account",active:true};
  assert.doesNotThrow(()=>assertSensitiveOperationActive(attempt,current));
  assert.throws(()=>assertSensitiveOperationActive(attempt,{...current,active:false}),/dismissed|background/);
  assert.throws(()=>assertSensitiveOperationActive(attempt,{...current,generation:5}),/dismissed|background/);
  assert.throws(()=>assertSensitiveOperationActive(attempt,{...current,binding:"ynx1other"}),/binding changed/);
});
