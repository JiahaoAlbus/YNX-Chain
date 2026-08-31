import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("extension lifecycle is digest-guarded and disabled contributions are inactive", async () => {
  const panel = await read("frontend/src/extensions/ExtensionPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    workbench = await read("frontend/src/app/Workbench.tsx"),
    service = await read("services/extension-registry/src/service.mjs");
  assert.match(panel, /setExtensionEnabled/);
  assert.match(panel, /window\.confirm/);
  assert.match(client + service, /expectedDigest/);
  assert.match(service, /extension_digest_conflict/);
  assert.match(service, /uninstall-extension-once/);
  assert.match(workbench, /if \(extension\.enabled\)/);
  assert.match(workbench, /filter\(\(extension\) => extension\.enabled\)/);
});

test("extension UI states its constrained source and trust policy", async () => {
  const panel = await read("frontend/src/extensions/ExtensionPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/extension-registry/src/service.mjs");
  assert.match(panel, /Local manifest source/);
  assert.match(panel, /Marketplace[\s\S]*VSIX[\s\S]*executable code[\s\S]*blocked/);
  assert.match(client + service, /validated-declarative-only/);
  assert.match(client + service, /local-manifest/);
  assert.doesNotMatch(service, /eval\(|new Function|child_process|fetch\(/);
});
