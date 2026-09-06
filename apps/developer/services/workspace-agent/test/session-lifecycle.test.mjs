import assert from "node:assert/strict";
import test from "node:test";
import { createSessionLifecycle } from "../src/session-lifecycle.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test("drain includes startup admitted before maintenance and awaits final persistence exactly once", async () => {
  const lifecycle = createSessionLifecycle(), startup = deferred(), saved = deferred(), events = [], state = {};
  const start = lifecycle.start(async () => { await startup.promise; events.push("started"); });
  const drain = lifecycle.drain(() => lifecycle.finish(state, async () => { events.push("saving"); await saved.promise; events.push("saved"); }));
  assert.deepEqual(lifecycle.status(), { starting: 1, finishing: 0, cleanupFailures: 0 });
  await assert.rejects(lifecycle.start(() => events.push("new-work")), { code: "service_maintenance" });
  startup.resolve(); await start; await new Promise(resolve => setImmediate(resolve));
  assert.equal(lifecycle.status().finishing, 1);
  const duplicate = lifecycle.finish(state, () => events.push("duplicate-save"));
  saved.resolve(); await Promise.all([drain, duplicate]);
  assert.deepEqual(events, ["started", "saving", "saved"]);
  assert.deepEqual(lifecycle.status(), { starting: 0, finishing: 0, cleanupFailures: 0 });
});

test("a cleanup failure remains observable and makes maintenance fail", async () => {
  const lifecycle = createSessionLifecycle();
  await lifecycle.finish({}, async () => { throw new Error("disk full"); });
  assert.equal(lifecycle.status().cleanupFailures, 1);
  await assert.rejects(lifecycle.drain(() => {}), { code: "interactive_cleanup_failed" });
});
