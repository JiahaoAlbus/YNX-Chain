import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseRuntimeBuildIdentity } from "../frontend/src/runtime/client.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const commit = "d4052228a2261c5ced6a8e8cfcbf763edabf2103";
const tree = "89beb658b0971fb20d0d92a6bebc2010fdbb33e7";

test("runtime identity is source-bound only when version and exact Git objects agree", () => {
  const accepted = parseRuntimeBuildIdentity({ version: "0.2.0-testnet-preview-d4052228a226-candidate", sourceCommit: commit, sourceTree: tree });
  assert.equal(accepted.status, "source-bound");
  assert.equal(accepted.detail, "RUNTIME_SOURCE_IDENTITY_VERIFIED");
  const missing = parseRuntimeBuildIdentity({ version: "0.2.0-testnet-preview", sourceCommit: null, sourceTree: null });
  assert.equal(missing.status, "unbound");
  assert.equal(missing.detail, "RUNTIME_SOURCE_IDENTITY_MISSING");
  const mismatched = parseRuntimeBuildIdentity({ version: "0.2.0-testnet-preview-another-build", sourceCommit: commit, sourceTree: tree });
  assert.equal(mismatched.status, "unbound");
  assert.equal(mismatched.detail, "RUNTIME_VERSION_SOURCE_MISMATCH");
});

test("chain UI exposes a read-only, fail-closed source identity state", async () => {
  const chain = await readFile(`${root}/frontend/src/chain/ChainPanel.tsx`, "utf8");
  assert.match(chain, /loadRuntimeBuildIdentity/);
  assert.match(chain, /aria-label="Developer runtime source identity"/);
  assert.match(chain, /Runtime source-bound/);
  assert.match(chain, /Public-release verification remains unavailable/);
});
