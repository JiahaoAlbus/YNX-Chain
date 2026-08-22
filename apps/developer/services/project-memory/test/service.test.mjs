import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
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
      "src/auth.ts": 'import { sum } from "./math";\nexport function authenticateWallet() { return verifySignature() && sum(1, 1); }',
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
  assert.equal(indexed.symbols, 2);
  assert.equal(indexed.relationships, 1);
  assert.deepEqual(indexed.languages, ["typescript"]);
  assert.equal(indexed.indexedFacts, 5);
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
  const result = await memory.search("a", "p", "authenticateWallet verifySignature", 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, "src/auth.ts");
  assert.equal((await memory.search("b", "p", "secret", 5)).results.length, 0);
  const firstPage = memory.exportMemory("a", "p", 0, 1),
    secondPage = memory.exportMemory("a", "p", firstPage.nextCursor, 1);
  assert.equal(
    firstPage.project.coverage,
    "text-vectors-declarations-and-file-relations",
  );
  assert.equal(firstPage.project.retention.revisionsRetained, 1);
  assert.equal(firstPage.chunks.length, 1);
  assert.equal(firstPage.nextCursor, 1);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(firstPage.chunks[0].vector.length, 64);
  assert.equal(memory.exportMemory("b", "p").chunks.length, 0);
  const factsPage = memory.exportFacts("a", "p", 0, 3),
    remainingFacts = memory.exportFacts("a", "p", factsPage.nextCursor, 3, 2);
  assert.equal(factsPage.facts.length, 3);
  assert.equal(factsPage.nextCursor, 3);
  assert.equal(remainingFacts.nextCursor, null);
  assert.ok(
    [...factsPage.facts, ...remainingFacts.facts].some(
      (fact) =>
        fact.type === "relation" &&
        fact.name === "./math" &&
        fact.targetPath === "src/math.ts",
    ),
  );
  assert.equal(memory.exportFacts("b", "p").facts.length, 0);
  assert.throws(
    () => memory.exportMemory("a", "p", 1, 1, 1),
    (error) => error.code === "memory_revision_conflict" && error.currentRevision === 2,
  );
  assert.throws(
    () => memory.exportFacts("a", "p", 0, 1, 1),
    (error) => error.code === "memory_revision_conflict" && error.currentRevision === 2,
  );
  assert.throws(
    () => memory.clear("a", "p", 1),
    (error) => error.code === "memory_revision_conflict" && error.currentRevision === 2,
  );
  store.put("a", "empty", {
    expectedRevision: 0,
    idempotencyKey: "memory-empty-project",
    payload: {
      name: "Empty",
      files: { "README.md": "" },
      folders: [],
      open: ["README.md"],
      active: "README.md",
    },
  });
  const emptyIndex = await memory.index("a", "empty", 1);
  assert.equal(emptyIndex.revision, 1);
  assert.equal(emptyIndex.chunks, 0);
  assert.equal(emptyIndex.facts, 1);
  assert.equal(memory.exportFacts("a", "empty").project.revision, 1);
  assert.equal(memory.clear("a", "empty", 1).removedFacts, 1);
  const cleared = memory.clear("a", "p", 2);
  assert.equal(cleared.removedChunks, 2);
  assert.equal(cleared.removedFacts, 5);
  assert.equal(memory.exportMemory("a", "p").chunks.length, 0);
  assert.equal(memory.exportFacts("a", "p").facts.length, 0);
  await assert.rejects(
    memory.index("a", "p", 1),
    (error) => error.code === "revision_conflict",
  );
});

test("project memory extracts bounded declarations and file relations across first-stage languages", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-memory-languages-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    memory = createProjectMemory({
      filename: join(root, "memory.sqlite"),
      ownerForRequest: () => "owner",
      workspaceStore: store,
      embed: async (inputs) => inputs.map(vector),
    });
  t.after(() => {
    memory.close();
    store.close();
  });
  store.put("owner", "languages", {
    expectedRevision: 0,
    idempotencyKey: "memory-language-workspace",
    payload: {
      name: "Languages",
      folders: ["src", "py", "go", "rust", "cpp", "java", "contracts"],
      open: [],
      active: "src/main.ts",
      files: {
        "src/main.ts": 'import { helper } from "./helper";\nexport function main() { return helper(); }',
        "src/helper.ts": "export const helper = () => 1;",
        "py/main.py": "from .helper import value\nclass Runner:\n    pass\ndef run():\n    return value",
        "py/helper.py": "value = 1",
        "go/main.go": 'package main\nimport (\n  "fmt"\n)\nfunc Run() { fmt.Println("ok") }',
        "rust/lib.rs": "mod util;\npub struct Store {}\npub fn load() {}",
        "rust/util.rs": "pub fn helper() {}",
        "cpp/main.cpp": '#include "thing.hpp"\nclass Runner {};\nint run() { return 0; }',
        "cpp/thing.hpp": "struct Thing {};",
        "java/App.java": "import java.util.List;\npublic class App { public void run() {} }",
        "contracts/Vault.sol": 'import "./Base.sol";\ncontract Vault { function store() public {} }',
        "contracts/Base.sol": "abstract contract Base {}",
      },
    },
  });
  const indexed = await memory.index("owner", "languages", 1),
    exported = memory.exportFacts("owner", "languages", 0, 100);
  for (const language of [
    "typescript",
    "python",
    "go",
    "rust",
    "cpp",
    "java",
    "solidity",
  ])
    assert.ok(indexed.languages.includes(language), language);
  for (const [name, kind] of [
    ["main", "function"],
    ["Runner", "class"],
    ["Run", "function"],
    ["Store", "struct"],
    ["Thing", "type"],
    ["App", "type"],
    ["Vault", "contract"],
  ])
    assert.ok(
      exported.facts.some(
        (fact) => fact.type === "symbol" && fact.name === name && fact.kind === kind,
      ),
      `${kind} ${name}`,
    );
  for (const [name, targetPath] of [
    ["./helper", "src/helper.ts"],
    ["./Base.sol", "contracts/Base.sol"],
  ])
    assert.ok(
      exported.facts.some(
        (fact) =>
          fact.type === "relation" &&
          fact.name === name &&
          fact.targetPath === targetPath,
      ),
      `${name} resolves to ${targetPath}`,
    );
  assert.ok(
    exported.facts.some(
      (fact) =>
        fact.type === "relation" && fact.kind === "import" && fact.name === "fmt",
    ),
  );
});

test("project memory migrates existing chunk indexes into explicit revision metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "ynx-memory-migration-")),
    filename = join(root, "memory.sqlite"),
    legacy = new DatabaseSync(filename),
    now = new Date().toISOString();
  legacy.exec(
    "CREATE TABLE memory_chunks(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,path TEXT NOT NULL,chunk_index INTEGER NOT NULL,digest TEXT NOT NULL,content TEXT NOT NULL,vector TEXT NOT NULL,dimensions INTEGER NOT NULL,indexed_at TEXT NOT NULL,PRIMARY KEY(owner_id,project_id,path,chunk_index))",
  );
  legacy
    .prepare(
      "INSERT INTO memory_chunks(owner_id,project_id,revision,path,chunk_index,digest,content,vector,dimensions,indexed_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "owner",
      "project",
      7,
      "main.ts",
      0,
      "d".repeat(64),
      "Path: main.ts",
      JSON.stringify(Array(64).fill(1)),
      64,
      now,
    );
  legacy.close();
  const store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    memory = createProjectMemory({
      filename,
      ownerForRequest: () => "owner",
      workspaceStore: store,
      embed: async (inputs) => inputs.map(vector),
    });
  assert.equal(memory.exportMemory("owner", "project").project.revision, 7);
  assert.equal(memory.clear("owner", "project", 7).removedChunks, 1);
  memory.close();
  store.close();
});
