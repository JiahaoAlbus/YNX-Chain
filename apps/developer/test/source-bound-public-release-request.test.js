import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("source-bound public release handoff is one-shot, exact and rollback-bound", async () => {
  const request = await readFile(`${root}/docs/integration/DEVELOPER_SOURCE_BOUND_PUBLIC_RELEASE_REQUEST_20260831.md`, "utf8");
  const commit = "bd5eb349fff3f31c8cca933affe9150ac1b8b978";
  const tree = "e9afa1549cab59de67e2891a3f4ee17a7fa17326";
  assert.match(request, /PREPARED_NOT_AUTHORIZED/);
  assert.match(request, new RegExp(commit));
  assert.match(request, new RegExp(tree));
  assert.match(request, /YNX_CODE_LXD_PACKAGE_NETWORK=ynx-pkg-egress/);
  assert.match(request, /no Caddy change is part of this request/);
  assert.match(request, /exact rollback\s+target captured before cutover/);
  assert.match(request, /Do not guess a rollback\s+target/);
  assert.match(request, /browser-visible Provider approval\/reject/);
});
