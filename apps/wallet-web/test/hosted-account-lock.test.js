import assert from "node:assert/strict";
import test from "node:test";
import { withHostedAccountLock } from "../src/hosted-account-lock.js";

const account = `0x${"42".repeat(20)}`;
test("missing Web Locks support fails closed for transaction work", async () => {
  await assert.rejects(withHostedAccountLock(account, () => "sent", null), { code: "HOSTED_ACCOUNT_LOCK_UNAVAILABLE" });
});
test("same account cannot enter a second signer while the first is still reviewing", async () => {
  let held = false, release;
  const locks = { async request(_name, _options, callback) { if (held) return callback(null); held = true; try { return await callback({ name: _name }); } finally { held = false; } } };
  const first = withHostedAccountLock(account, () => new Promise(resolve => { release = resolve; }), locks);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(withHostedAccountLock(account, () => "second signed", locks), { code: "HOSTED_ACCOUNT_BUSY" });
  release("first signed");
  assert.equal(await first, "first signed");
});
test("transaction errors preserve their original code and uncertainty data", async () => {
  const locks = { request(_name, _options, callback) { return callback({}); } };
  const failure = Object.assign(new Error("durability uncertain"), { code: -32002, data: { status: "transaction_durability_uncertain" } });
  await assert.rejects(withHostedAccountLock(account, () => { throw failure; }, locks), error => error === failure);
  await assert.rejects(withHostedAccountLock(account, () => Promise.reject(new TypeError("original")), locks), { name: "TypeError", message: "original" });
  await assert.rejects(withHostedAccountLock(account, () => "sent", { request() { throw new Error("api failed"); } }), { code: "HOSTED_ACCOUNT_LOCK_UNAVAILABLE" });
});
