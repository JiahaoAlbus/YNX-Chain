import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const socialRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidateRoot = resolve(socialRoot, "evidence/release-candidates");

async function readJSON(name: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(resolve(candidateRoot, name), "utf8"));
}

test("Social release candidate is source-bound to YNX EVM 6423", async () => {
  const manifest = await readJSON("social-6423-c963f168.json");
  assert.equal(manifest.source.repositoryCommit, "c963f16853f73abb44aa578213cb91b4aa11d8f3");
  assert.equal(manifest.source.socialTree, "90ed6c10ccd816e81f0aec76b094f26a240d98f8");
  assert.equal(manifest.network.evmChainId, 6423);
  assert.equal(manifest.network.evmChainQuantity, "0x1917");
  assert.deepEqual(manifest.network.forbiddenChainIds, ["ynx_9102-1", "0x238e", 9102]);
  assert.equal(manifest.readiness.publicRuntimeBound, false);
  assert.equal(manifest.readiness.releaseSignable, false);
});

test("Social candidate artifact bytes and digest match the manifest", async () => {
  const manifest = await readJSON("social-6423-c963f168.json");
  const bytes = await readFile(resolve(socialRoot, manifest.artifact.path.replace("apps/social/", "")));
  assert.equal(bytes.byteLength, manifest.artifact.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.artifact.sha256);
});

test("Social preflight keeps public and sensitive claims false", async () => {
  const preflight = await readJSON("social-6423-nonsensitive-browser-preflight.json");
  assert.equal(preflight.status, "PREPARED_NOT_OBSERVED");
  assert.equal(preflight.chain.evmChainId, 6423);
  assert.equal(preflight.checks.distinctYNXIdentityAndLogo, "NOT_OBSERVED");
  assert.equal(preflight.checks.distinctMetaMaskIdentityAndLogo, "NOT_OBSERVED");
  assert.deepEqual(preflight.forbiddenActions, ["eth_requestAccounts", "wallet signing", "transaction submission"]);
});
