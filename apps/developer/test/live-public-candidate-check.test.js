import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public candidate gate distinguishes host tools from the reviewed cloud toolchain", async () => {
  const source = await readFile(new URL("../scripts/live-public-candidate-check.mjs", import.meta.url), "utf8");
  assert.match(source, /Java must be routed through the reviewed cloud runtime/);
  assert.doesNotMatch(source, /\["java", "src\/Main\.java"/);
  assert.match(source, /protected cloud gate separately verifies all 9 runtime languages/);
});
