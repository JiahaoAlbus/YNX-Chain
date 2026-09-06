import assert from "node:assert/strict";
import test from "node:test";
import { createModelRouter } from "../src/router.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
function controlled(options = {}) {
  const running = [], calls = [];
  const router = createModelRouter({ maxConcurrent: 2, maxHostedConcurrent: 1,
    maxQueuedPerOwner: 2, ownerForRequest: () => "authenticated", ...options,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.prompt || body.input);
      return new Promise((resolve, reject) => {
        const done = () => resolve(String(url).includes("openai.com")
          ? new Response(JSON.stringify({ output_text: "provider result" }))
          : new Response('data: {"text":"hosted result"}\n\n'));
        running.push(done);
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    } });
  const send = (ownerId, label, extra = {}) => router.generate({
    ownerId, provider: "ynx-hosted", prompt: label, ...extra,
  });
  return { router, running, calls, send };
}

test("authenticated owner quota cannot consume another owner's BYOK slot", async () => {
  const { router, running, send } = controlled();
  assert.throws(() => router.generate({ prompt: "no owner" }), e => e.code === "model_owner_required");
  const a = send("alice", "alice active"), a2 = send("alice", "alice queued one"), a3 = send("alice", "alice queued two");
  await assert.rejects(send("alice", "alice over quota"), e => e.status === 429 && e.code === "model_owner_queue_full");
  const b = send("bob", "bob external", { provider: "openai", apiKey: "only-bobs-key-12345" });
  await tick();
  assert.equal(router.catalog().active, 2);
  assert.equal(router.catalog().hostedActive, 1);
  assert.equal(router.catalog().byoActive, 1);
  assert.equal(JSON.stringify(router.catalog()).includes("alice"), false);
  running.shift()(); running.shift()();
  await Promise.all([a, b]); await tick();
  running.shift()(); await a2; await tick();
  running.shift()(); await a3; await tick();
  assert.equal(router.catalog().active, 0);
  assert.equal(router.catalog().queued, 0);
});

test("a busy owner's backlog gets one turn before other waiting owners", async () => {
  const { running, calls, send } = controlled({ maxConcurrent: 1, maxQueuedPerOwner: 8 });
  const jobs = [send("alice", "alice 1"), send("alice", "alice 2"), send("alice", "alice 3"), send("bob", "bob 1"), send("carol", "carol 1")];
  for (let n = 0; n < jobs.length; n++) { await tick(); running.shift()(); }
  await Promise.all(jobs);
  assert.deepEqual(calls.map(s => s.trim()), ["alice 1", "alice 2", "bob 1", "carol 1", "alice 3"]);
});

test("queue expiry and cancellation remove only that owner's request", async () => {
  const { router, running, calls, send } = controlled({ maxConcurrent: 1, queueTimeoutMs: 25 });
  const active = send("alice", "active request");
  const controller = new AbortController();
  const cancelled = send("bob", "cancel queued", { signal: controller.signal });
  const expired = send("carol", "expire queued");
  const cancelledCheck = assert.rejects(cancelled, e => e.code === "model_request_cancelled");
  const expiredCheck = assert.rejects(expired, e => e.code === "model_queue_timeout" && e.status === 504);
  controller.abort();
  await Promise.all([cancelledCheck, expiredCheck]);
  assert.equal(router.catalog().queued, 0);
  assert.equal(calls.length, 1);
  running.shift()(); await active; await tick();
  const after = send("carol", "after expiration");
  await tick(); running.shift()(); await after;
});

test("provider changes cannot bypass an owner's queued request capacity", async () => {
  const { running, send } = controlled({ maxQueued: 1, maxQueuedPerOwner: 1 });
  const a = send("alice", "hosted active");
  const b = send("bob", "hosted waiting");
  await assert.rejects(send("bob", "external bypass", { provider: "openai", apiKey: "only-bobs-key-12345" }), e => e.code === "model_owner_queue_full");
  await tick(); running.shift()(); await a; await tick(); running.shift()(); await b;
});

test("100 distinct owners complete within bounded execution without identity leakage", async () => {
  let active = 0, peak = 0;
  const router = createModelRouter({ maxConcurrent: 4, maxHostedConcurrent: 2,
    maxQueued: 128, fetchImpl: async () => {
      active += 1; peak = Math.max(peak, active); await tick(); active -= 1;
      return new Response('data: {"text":"synthetic response"}\n\n');
    } });
  const results = await Promise.all(Array.from({ length: 100 }, (_, index) =>
    router.generate({ ownerId: `owner-${index}`, prompt: `request ${index}` })));
  await tick();
  assert.equal(results.length, 100);
  assert.equal(peak, 2);
  assert.equal(router.catalog().queued, 0);
  assert.equal(router.catalog().active, 0);
  assert.equal(JSON.stringify(results).includes("owner-"), false);
});
