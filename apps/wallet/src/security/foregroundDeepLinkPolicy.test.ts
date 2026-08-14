import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDeepLinkForeground } from "./foregroundDeepLinkPolicy";

test("authorization links are admitted only in the exact active foreground",()=>{
  assert.doesNotThrow(()=>assertDeepLinkForeground("active"));
  for(const state of [null,"background","inactive","unknown"])assert.throws(()=>assertDeepLinkForeground(state),/active foreground/);
});
