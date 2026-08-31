import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Workspace History exposes retained export and reviewed non-destructive restore", async () => {
  const panel = await read("frontend/src/history/WorkspaceHistoryPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    runtime = await read("services/workspace-agent/src/runtime.mjs"),
    store = await read("services/workspace-manager/src/store.mjs");
  assert.match(panel, /Server-local snapshots retain the latest/);
  assert.match(panel, /Export important revisions for independent backup/);
  assert.match(panel, /window\.confirm/);
  assert.match(panel, /will create a new revision/);
  assert.match(client + runtime, /restore-workspace-once/);
  assert.match(client, /crypto\.randomUUID\(\)/);
  assert.match(runtime, /view\"\) === \"history\"/);
  assert.match(runtime, /view\"\) === \"snapshot\"/);
  assert.match(store, /REVISION_RETENTION = 50/);
  assert.match(store, /BEGIN IMMEDIATE/);
  assert.match(store, /workspace_approvals/);
  assert.match(store, /source: \"restore\"/);
});
