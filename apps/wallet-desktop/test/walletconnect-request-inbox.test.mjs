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
function durableStorage(){const values=new Map();return{values,getItem:async key=>structuredClone(values.get(key)),setItem:async(key,value)=>{values.set(key,structuredClone(value));}};}
test("cold inbox restores the original unlocked review deadline without re-signing and binds account/session/wire",async()=>{
 const store=durableStorage(),first=fixture(),e=event();delete e.params.request.expiryTimestamp;const authorized={origin,sessionBinding:"original-session"};await first.inbox.start(store);const original=first.inbox.accept(e,authorized,account).entry;await first.inbox.persist();
 const cold=fixture();cold.tick(1_030_000);await cold.inbox.start(store,[original.key]);const resumed=cold.inbox.accept({...e,restored:true},authorized,account).entry;assert.equal(resumed.expiresAt,original.expiresAt);assert.equal(resumed.stage,"received");
 const key=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},method:"isolated-qa"}});key.setFocused(true);key.setAccount(account);let signs=0;await assert.rejects(key.run(()=>signs++));await key.unlock();assert.equal(signs,0);await key.run(async lease=>{await cold.inbox.markDecided(resumed,lease.assert);signs++;});assert.equal(signs,1);cold.inbox.finish(resumed.key);await cold.inbox.persist();
 const afterDecision=fixture();await afterDecision.inbox.start(store,[original.key]);assert.equal(afterDecision.inbox.accept({...e,restored:true},authorized,account).entry,null);
 for(const changed of [{...authorized,sessionBinding:"changed"},{...authorized,origin:"https://changed.example"}]){const isolated=fixture();await isolated.inbox.start(durableStorage());assert.throws(()=>isolated.inbox.accept({...e,restored:true},changed,account));}
});
test("cold inbox never creates a new application TTL from SDK wire expiry or a missing durable record",async()=>{
 const store=durableStorage(),first=fixture(),authorized={origin,sessionBinding:"session"},e=event();e.params.request.expiryTimestamp=5000;await first.inbox.start(store);const original=first.inbox.accept(e,authorized,account).entry;await first.inbox.persist();
 const cold=fixture();cold.tick(original.expiresAt+1);await cold.inbox.start(store,[original.key]);assert.throws(()=>cold.inbox.accept({...e,restored:true},authorized,account));
 const missing=fixture();await missing.inbox.start(durableStorage());assert.throws(()=>missing.inbox.accept({...e,restored:true},authorized,account));
});
test("missing or unconfirmed decision storage prevents the key side effect and reject remains terminal across restart",async()=>{
 const store=durableStorage(),{inbox}=fixture();await inbox.start(store);const entry=inbox.accept(event(),{origin},account).entry;await inbox.persist();store.values.clear();let signs=0;await assert.rejects(async()=>{await inbox.markDecided(entry);signs++;});assert.equal(signs,0);
 const good=durableStorage(),next=fixture();await next.inbox.start(good);const fresh=next.inbox.accept(event("topic-next",2),{origin},account).entry;await next.inbox.persist();await next.inbox.markDecided(fresh);next.inbox.finish(fresh.key);await next.inbox.persist();const restarted=fixture();await restarted.inbox.start(good,[fresh.key]);assert.equal(restarted.inbox.accept({...event("topic-next",2),restored:true},{origin},account).entry,null);
 const retry=restarted.inbox.accept(event("topic-next",3),{origin},account).entry;assert.equal(retry.event.id,3);
});
