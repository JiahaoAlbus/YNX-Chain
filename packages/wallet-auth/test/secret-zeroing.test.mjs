import assert from "node:assert/strict";
import test from "node:test";
import { withSecretBytes } from "../src/crypto.js";

const SECRET="0".repeat(63)+"1";

test("temporary secret bytes are zeroed after successful key use",()=>{
  let retained;
  const marker=withSecretBytes(SECRET,bytes=>{retained=bytes;assert.equal(bytes[31],1);return "done"});
  assert.equal(marker,"done");
  assert.ok(retained.every(byte=>byte===0));
});

test("temporary secret bytes are zeroed when key use throws",()=>{
  let retained;
  assert.throws(()=>withSecretBytes(SECRET,bytes=>{retained=bytes;throw new Error("operation failed")}),/operation failed/);
  assert.ok(retained.every(byte=>byte===0));
});
