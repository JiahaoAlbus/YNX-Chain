import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("project memory UI provides view, incremental rebuild, export and confirmed clear", async () => {
  const panel = await read("frontend/src/chat/AgentPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/project-memory/src/service.mjs");
  assert.match(panel, /loadProjectMemory/);
  assert.match(panel, /Incremental rebuild/);
  assert.match(panel, /Export JSON/);
  assert.match(panel, /View facts/);
  assert.match(panel + client, /loadProjectMemoryFacts/);
  assert.match(panel, /external or unresolved/);
  assert.match(panel, /window\.confirm/);
  assert.match(client + service, /clear-memory-once/);
  assert.match(service, /memory_revision_conflict/);
  assert.match(service, /reusedChunks/);
  assert.match(service, /nextCursor/);
  assert.match(client + service, /view.*facts|view: "facts"/);
  assert.match(service, /memory_facts/);
});

test("project memory UI states retention and current coverage without overclaiming", async () => {
  const panel = await read("frontend/src/chat/AgentPanel.tsx"),
    service = await read("services/project-memory/src/service.mjs");
  assert.match(panel, /Current index only/);
  assert.match(panel, /no automatic expiry/);
  assert.match(panel, /source\s+declarations and resolved file imports/);
  assert.match(panel, /API call graph, change history\s+and preferences are not indexed yet/);
  assert.match(service, /current-index-only/);
  assert.match(service, /text-vectors-declarations-and-file-relations/);
  assert.match(service, /extractSymbols/);
  assert.match(service, /extractRelations/);
  assert.match(service, /revisionsRetained: 1/);
});
