import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createWorkspaceStore } from "../src/store.mjs";

const payload = value => ({ name: "Receipt project", files: { "main.ts": `export const value = ${value};` }, folders: [], open: ["main.ts"], active: "main.ts" });
const requestHash = (expectedRevision, value) => createHash("sha256").update(`${expectedRevision}:${JSON.stringify(value)}`).digest("hex");
function fixture(t) {
  const store = createWorkspaceStore({ filename: ":memory:" });
  t.after(() => store.close());
  return store;
}
const changes = store => store.nativeJournalDatabase().prepare("SELECT total_changes() AS changes").get().changes;

test("mutation receipt reads the exact saved revision and put request hash without modifying the database", t => {
  const store = fixture(t), value = payload(1);
  store.put("owner-a", "project-a", { expectedRevision: 0, idempotencyKey: "save-0001", payload: value });
  const before = changes(store), workspace = store.get("owner-a", "project-a"), history = store.history("owner-a", "project-a");
  assert.deepEqual(store.mutationReceipt("owner-a", "project-a", "save-0001"), { revision: 1, requestHash: requestHash(0, value) });
  assert.equal(changes(store), before);
  assert.deepEqual(store.get("owner-a", "project-a"), workspace);
  assert.deepEqual(store.history("owner-a", "project-a"), history);
});

test("mutation receipts are isolated by owner, project and idempotency key", t => {
  const store = fixture(t);
  const a = payload(1), b = payload(2), other = payload(3);
  store.put("owner-a", "project-a", { expectedRevision: 0, idempotencyKey: "save-0001", payload: a });
  assert.equal(store.mutationReceipt("owner-b", "project-a", "save-0001"), null);
  assert.equal(store.mutationReceipt("owner-a", "project-b", "save-0001"), null);
  assert.equal(store.mutationReceipt("owner-a", "project-a", "missing-0001"), null);
  store.put("owner-b", "project-a", { expectedRevision: 0, idempotencyKey: "save-0001", payload: b });
  store.put("owner-a", "project-b", { expectedRevision: 0, idempotencyKey: "save-0001", payload: other });
  assert.equal(store.mutationReceipt("owner-a", "project-a", "save-0001").requestHash, requestHash(0, a));
  assert.equal(store.mutationReceipt("owner-b", "project-a", "save-0001").requestHash, requestHash(0, b));
  assert.equal(store.mutationReceipt("owner-a", "project-b", "save-0001").requestHash, requestHash(0, other));
});

test("mutation receipt validates owner, project and idempotency identifiers", t => {
  const store = fixture(t), before = changes(store);
  assert.throws(() => store.mutationReceipt("owner/a", "project-a", "save-0001"), { code: "invalid_owner" });
  assert.throws(() => store.mutationReceipt("owner-a", "project/a", "save-0001"), { code: "invalid_project" });
  assert.throws(() => store.mutationReceipt("owner-a", "project-a", ""), { code: "invalid_idempotency_key" });
  assert.equal(changes(store), before);
});

test("a pruned mutation receipt remains readable without replaying a write or creating a revision", t => {
  const store = fixture(t), first = payload(1);
  for (let revision = 0; revision < 55; revision++) store.put("owner-a", "project-a", {
    expectedRevision: revision, idempotencyKey: `save-${String(revision + 1).padStart(4, "0")}`, payload: revision === 0 ? first : payload(revision + 1),
  });
  assert.throws(() => store.snapshot("owner-a", "project-a", 1), { code: "workspace_revision_not_found" });
  const before = changes(store), workspace = store.get("owner-a", "project-a"), history = store.history("owner-a", "project-a", 0, 50);
  assert.equal(history.retention.retainedRevisions, 50);
  assert.deepEqual(store.mutationReceipt("owner-a", "project-a", "save-0001"), { revision: 1, requestHash: requestHash(0, first) });
  assert.equal(changes(store), before);
  assert.equal(store.get("owner-a", "project-a").revision, 55);
  assert.deepEqual(store.get("owner-a", "project-a"), workspace);
  assert.deepEqual(store.history("owner-a", "project-a", 0, 50), history);
});
