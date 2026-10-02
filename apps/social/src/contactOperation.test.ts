import assert from "node:assert/strict";
import test from "node:test";
import { ContactOperation } from "./contactOperation";

test("cancel releases never-settling wait without clearing a new operation", async () => {
  const operations = new ContactOperation();
  let oldSignal!: AbortSignal;
  const old = operations.run(signal => { oldSignal = signal; return new Promise(() => {}); });
  const oldRejected = assert.rejects(old, /delivery is not confirmed/);
  await Promise.resolve();
  operations.cancel();
  let finish!: (value: string) => void;
  const next = operations.run(() => new Promise<string>(resolve => { finish = resolve; }));
  await oldRejected;
  assert.equal(oldSignal.aborted, true);
  await assert.rejects(operations.run(async () => "overlap"), /already being sent/);
  finish("new result");
  assert.equal(await next, "new result");
});

test("never-settling transport has a bounded local wait", async () => {
  const operations = new ContactOperation();
  await assert.rejects(operations.run(() => new Promise(() => {}), 5), /timed out; delivery is not confirmed/);
  assert.equal(await operations.run(async () => "retry available"), "retry available");
});

test("synchronous transport throw releases only its own operation", async () => {
  const operations = new ContactOperation();
  await assert.rejects(operations.run(() => { throw new Error("sync failure"); }), /sync failure/);
  assert.equal(await operations.run(async () => "available"), "available");
});

test("late old result cannot resolve or unlock the new wait", async () => {
  const operations = new ContactOperation();
  let resolveOld!: (value: string) => void;
  const old = operations.run(() => new Promise<string>(resolve => { resolveOld = resolve; }));
  const rejected = assert.rejects(old, /cancelled/);
  await Promise.resolve();
  operations.cancel();
  const next = operations.run(() => new Promise<string>(() => {}));
  const nextRejected = assert.rejects(next, /cancelled/);
  resolveOld("late response");
  await rejected;
  await assert.rejects(operations.run(async () => "overlap"), /already being sent/);
  operations.cancel();
  await nextRejected;
});
