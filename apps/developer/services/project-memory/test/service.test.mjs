import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createProjectMemory } from "../src/service.mjs";

const vector = (text) => {
  const value = Array(64).fill(0);
  for (const token of text.toLowerCase().match(/[a-z]+/g) || [])
    value[token.charCodeAt(0) % 64] += 1;
  return value;
};

test("project memory incrementally indexes, searches, exports and clears in owner scope", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-memory-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    embeddedBatches = [],
    memory = createProjectMemory({
      filename: join(root, "memory.sqlite"),
      ownerForRequest: () => "a",
      workspaceStore: store,
      embed: async (inputs) => {
        embeddedBatches.push([...inputs]);
        return inputs.map(vector);
      },
    });
  t.after(() => {
    memory.close();
    store.close();
  });
  const workspace = {
    name: "P",
    files: {
      "src/auth.ts": "export function authenticateWallet() { return verifySignature(); }",
      "src/math.ts": "export function sum(a,b) { return a + b; }",
    },
    folders: ["src"],
    open: [],
    active: "src/auth.ts",
  };
  store.put("a", "p", {
    expectedRevision: 0,
    idempotencyKey: "memory-initial-a",
    payload: workspace,
  });
  store.put("b", "p", {
    expectedRevision: 0,
    idempotencyKey: "memory-initial-b",
    payload: {
      name: "Other",
      files: { "private.ts": "secret customer ledger" },
      folders: [],
      open: [],
      active: "private.ts",
    },
  });
  const indexed = await memory.index("a", "p", 1);
  assert.equal(indexed.chunks, 2);
  assert.equal(indexed.embeddedChunks, 2);
  assert.equal(indexed.reusedChunks, 0);
  assert.equal(indexed.dimensions, 64);
  const unchanged = await memory.index("a", "p", 1);
  assert.equal(unchanged.embeddedChunks, 0);
  assert.equal(unchanged.reusedChunks, 2);
  assert.equal(embeddedBatches.length, 1);
  store.put("a", "p", {
    expectedRevision: 1,
    idempotencyKey: "memory-update-a",
    payload: {
      ...workspace,
      files: {
        ...workspace.files,
        "src/math.ts": "export function sum(a,b) { return Number(a) + Number(b); }",
      },
    },
  });
  const incremental = await memory.index("a", "p", 2);
  assert.equal(incremental.embeddedChunks, 1);
  assert.equal(incremental.reusedChunks, 1);
  assert.equal(embeddedBatches.length, 2);
  assert.equal(embeddedBatches[1].length, 1);
  const result = await memory.search("a", "p", "wallet authentication", 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, "src/auth.ts");
  assert.equal((await memory.search("b", "p", "secret", 5)).results.length, 0);
  const firstPage = memory.exportMemory("a", "p", 0, 1),
    secondPage = memory.exportMemory("a", "p", firstPage.nextCursor, 1);
  assert.equal(firstPage.project.coverage, "text-chunks-and-semantic-vectors");
  assert.equal(firstPage.project.retention.revisionsRetained, 1);
  assert.equal(firstPage.chunks.length, 1);
  assert.equal(firstPage.nextCursor, 1);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(firstPage.chunks[0].vector.length, 64);
  assert.equal(memory.exportMemory("b", "p").chunks.length, 0);
  assert.throws(
    () => memory.exportMemory("a", "p", 1, 1, 1),
    (error) => error.code === "memory_revision_conflict" && error.currentRevision === 2,
  );
  assert.throws(
    () => memory.clear("a", "p", 1),
    (error) => error.code === "memory_revision_conflict" && error.currentRevision === 2,
  );
  const cleared = memory.clear("a", "p", 2);
  assert.equal(cleared.removedChunks, 2);
  assert.equal(memory.exportMemory("a", "p").chunks.length, 0);
  await assert.rejects(
    memory.index("a", "p", 1),
    (error) => error.code === "revision_conflict",
  );
});
