import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("macOS packaging refuses an existing candidate and never deletes prior outputs", async () => {
  const [pack, verify] = await Promise.all([
    readFile(`${root}/scripts/package-local-macos.sh`, "utf8"),
    readFile(`${root}/scripts/verify-local-macos-package.sh`, "utf8"),
  ]);
  assert.match(pack, /\.ynx-developer-candidates/);
  assert.match(pack, /Refusing to overwrite existing macOS package candidate/);
  assert.match(pack, /YNX_DEVELOPER_MACOS_OUTPUT_DIR must stay under/);
  assert.doesNotMatch(pack, /rm -rf "\$root"/);
  assert.doesNotMatch(pack, /rm -rf "\$dmg_root"/);
  assert.match(verify, /YNX_DEVELOPER_MACOS_OUTPUT_DIR/);
  assert.match(verify, /\.ynx-developer-candidates/);
});
