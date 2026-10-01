import assert from "node:assert/strict";
import test from "node:test";
import { DurableOutbox } from "./durableOutbox";
import { type PendingMessage } from "./messageOutbox";

const entry: PendingMessage = { account: "alice", deviceId: "device-a", conversationId: "chat-a", request: { messageId: "one", envelopes: [], senderSignature: "signature" } };
function harness() {
  const files = new Map<string, string>();
  let fail = false;
  const storage = {
    read: (slot: string) => files.get(slot) ?? null,
    write(slot: string, value: string) { files.set(slot, fail ? value.slice(0, 20) : value); if (fail) throw new Error("interrupted write"); },
    remove: (slot: string) => { files.delete(slot); },
  };
  return { files, storage, store: new DurableOutbox(storage), interrupt: () => { fail = true; } };
}
test("restart recovers last complete snapshot after a torn write", () => {
  const h = harness();
  h.store.update(() => [entry]);
  h.interrupt();
  assert.throws(() => h.store.update(() => []), /interrupted/);
  assert.deepEqual(new DurableOutbox(h.storage).read(), [entry]);
});
test("successive acknowledgements persist and do not reload the legacy queue", () => {
  const h = harness();
  h.files.set("legacy", JSON.stringify([entry]));
  assert.deepEqual(h.store.read(), [entry]);
  h.store.update(() => []);
  assert.deepEqual(new DurableOutbox(h.storage).read(), []);
  h.store.clear();
  assert.equal(h.files.has("legacy"), false);
  assert.deepEqual(h.store.read(), []);
});
test("corruption never silently replaces the queue with an empty or legacy queue", () => {
  const h = harness();
  h.files.set("a", "corrupt");
  h.files.set("legacy", JSON.stringify([entry]));
  assert.throws(() => h.store.read(), /damaged/);
  assert.throws(() => h.store.update(() => []), /damaged/);
  assert.equal(h.files.get("a"), "corrupt");
});
test("checksums reject an altered latest snapshot and preserve the previous one", () => {
  const h = harness();
  h.store.update(() => [entry]);
  h.store.update(() => []);
  const changed = JSON.parse(h.files.get("b")!);
  changed.generation = 999;
  h.files.set("b", JSON.stringify(changed));
  assert.deepEqual(h.store.read(), [entry]);
});
