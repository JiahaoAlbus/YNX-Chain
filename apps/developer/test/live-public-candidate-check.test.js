import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public candidate gate distinguishes host tools from the reviewed cloud toolchain", async () => {
  const source = await readFile(new URL("../scripts/live-public-candidate-check.mjs", import.meta.url), "utf8");
  assert.match(source, /Java compiler capability must be a boolean when advertised/);
  assert.doesNotMatch(source, /\["java", "src\/Main\.java"/);
  assert.match(source, /optional Java advertisement is schema-checked here/);
  assert.match(source, /protected cloud gate separately verifies all 9 runtime languages/);
  assert.match(source, /approval: "model-request-once", approvalId: randomUUID\(\)/);
  assert.match(source, /ai-live-probe-\$\{randomUUID\(\)\.replaceAll/);
  assert.match(source, /attempt < 3/);
  assert.match(source, /contextPaths must be exactly/);
  assert.match(source, /unsafe_workspace_path/);
});
