import test from "node:test";
import assert from "node:assert/strict";
import { WalletConnectRequestInbox } from "../src/walletconnect-request-inbox.mjs";
import { DesktopKeyLifecycle } from "../src/key-lifecycle.mjs";
import { ApprovalReviewQueue } from "../src/approval-review-queue.mjs";
const account = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", origin = "https://qa.example";
const event = (topic = "topic-a", id = 1) => ({ topic, id, params: { chainId: "eip155:6423", request: { method: "personal_sign", params: ["0x01", account], expiryTimestamp: 1100 } } });
function fixture(options = {}) {
  let now = 1_000_000; const timers = new Map(), ended = [];
  const inbox = new WalletConnectRequestInbox({ now: () => now, schedule: (fn, delay) => { const key = {}; timers.set(key, { fn, at: now + delay }); return key; }, unschedule: key => timers.delete(key), onExpire: (entry, code) => ended.push({ key: entry.key, code }), ...options });
  return { inbox, ended, tick(time) { now = time; for (const timer of [...timers.values()]) if (timer.at <= now) timer.fn(); } };
}
test("locked reception preserves public requests and blur retains explicit approval without key execution", async () => {
  const { inbox } = fixture(), key = new DesktopKeyLifecycle({ authorizer: { available: () => true, authenticate: async () => {}, method: "isolated-qa" } }); key.setFocused(true); key.setAccount(account);
  const { entry } = inbox.accept(event(), { origin }, account);
  let executionCount = 0;
  await assert.rejects(() => key.run(async () => executionCount++), error => error.code === 4100);
  assert.equal(executionCount, 0); assert.equal(inbox.pending().length, 1);
  await key.unlock(); await key.run(() => inbox.stage(entry, "review-a"), { assertCurrent: () => inbox.assertLive(entry) });
  const queue = new ApprovalReviewQueue(); queue.enqueue("provider", { id: "review-a" }); key.setFocused(false); queue.suspend();
  assert.equal(queue.current.review.id, "review-a"); assert.equal(entry.stage, "review"); assert.equal(executionCount, 0);
  key.setFocused(true); await key.unlock(); assert.equal(executionCount, 0);
  await key.run(async lease => { lease.assert(); executionCount++; }, { assertCurrent: () => inbox.assertLive(entry) });
  assert.equal(executionCount, 1); inbox.finish(entry.key);
  assert.equal(inbox.accept(event(), { origin }, account).duplicate, true);
});
test("topic and ID are independent; conflicting duplicates end once without replacing reviewed bytes", () => {
  const { inbox, ended } = fixture(); const a = inbox.accept(event(), { origin }, account).entry;
  assert.equal(inbox.accept(event(), { origin }, account).entry, a);
  assert.notEqual(inbox.accept(event("topic-b"), { origin }, account).entry.key, a.key);
  const changed = event(); changed.params.request.params[0] = "0x02";
  assert.equal(inbox.accept(changed, { origin }, account).duplicate, true);
  assert.deepEqual(ended, [{ key: a.key, code: "WALLETCONNECT_REQUEST_ID_CONFLICT" }]); assert.equal(a.event.params.request.params[0], "0x01");
  assert.equal(inbox.accept(event(), { origin }, account).entry, null);
});
test("original deadlines, origin quotas and restored deadline checks survive new traffic", () => {
  const { inbox, tick, ended } = fixture({ perOrigin: 2 }); const first = inbox.accept(event(), { origin }, account).entry;
  inbox.accept(event("topic-a", 2), { origin }, account);
  assert.throws(() => inbox.accept(event("topic-a", 3), { origin }, account), error => error.data.code === "WALLETCONNECT_REQUEST_LIMIT");
  const restored = event("topic-c"); delete restored.params.request.expiryTimestamp; restored.restored = true;
  assert.throws(() => inbox.accept(restored, { origin: "https://other.example" }, account), error => error.data.code === "WALLETCONNECT_RESTORED_DEADLINE_UNKNOWN");
  tick(first.expiresAt); assert.equal(ended.length, 2); assert.equal(inbox.pending().length, 0);
  assert.throws(() => inbox.assertLive(first), error => error.data.code === "WALLETCONNECT_REQUEST_EXPIRED");
});
test("expiration during an asynchronous signing lease prevents the outward effect", async () => {
  const { inbox, tick } = fixture(), entry = inbox.accept(event(), { origin }, account).entry;
  const key = new DesktopKeyLifecycle({ authorizer: { available: () => true, authenticate: async () => {}, method: "isolated-qa" } }); key.setFocused(true); await key.unlock(); let sent = false;
  await assert.rejects(() => key.run(async lease => { await Promise.resolve(); tick(entry.expiresAt); await lease.deliver(async () => { sent = true; }); }, { assertCurrent: () => inbox.assertLive(entry) }), error => error.data.code === "WALLETCONNECT_REQUEST_EXPIRED");
  assert.equal(sent, false);
});
