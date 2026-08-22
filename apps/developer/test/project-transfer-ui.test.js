import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Explorer project transfer is bounded, text-only and recoverable", async () => {
  const explorer = await read("frontend/src/explorer/FileExplorer.tsx"),
    transfer = await read("frontend/src/explorer/projectTransfer.ts"),
    workbench = await read("frontend/src/app/Workbench.tsx");
  assert.match(explorer, /Import project JSON/);
  assert.match(explorer, /Import folder/);
  assert.match(explorer, /Export project JSON/);
  assert.match(explorer, /webkitdirectory/);
  assert.match(transfer, /ynx-code-project\/v1/);
  assert.match(transfer + workbench, /PROJECT_FILE_LIMIT/);
  assert.match(transfer + workbench, /PROJECT_BYTE_LIMIT/);
  assert.match(workbench, /TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(workbench, /window\.confirm/);
  assert.match(workbench, /recoverable in Workspace History after save/);
  assert.match(workbench, /collaborationReadOnly/);
  assert.match(workbench, /Object\.create\(null\)/);
  assert.match(transfer, /validPath/);
});

test("project JSON export contains version, timestamp and complete text map", async () => {
  const transfer = await read("frontend/src/explorer/projectTransfer.ts");
  assert.match(transfer, /schemaVersion: PROJECT_TRANSFER_SCHEMA/);
  assert.match(transfer, /exportedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(transfer, /files/);
  assert.match(transfer, /UTF-8 text files only/);
});
