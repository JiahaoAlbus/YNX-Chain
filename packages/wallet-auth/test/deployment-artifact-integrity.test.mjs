import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeploymentArtifactIntegrity, verifyDeploymentArtifactIntegrity, WalletAuthError } from "../src/index.js";

const SOURCE = "1".repeat(40);
const MANIFEST = JSON.stringify({schemaVersion:1,sourceCommit:SOURCE,chainId:6423,entryPoint:{address:"0x1111111111111111111111111111111111111111"}});

test("deployment artifact integrity binds exact manifest bytes and source", () => {
  const integrity = createDeploymentArtifactIntegrity(MANIFEST, SOURCE);
  assert.equal(integrity.sourceCommit, SOURCE);
  assert.equal(integrity.manifestBytes, Buffer.byteLength(MANIFEST));
  assert.match(integrity.manifestSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyDeploymentArtifactIntegrity(MANIFEST, JSON.stringify(integrity), SOURCE), integrity);
});

test("manifest bytes, source and integrity substitutions fail closed", () => {
  const integrity = createDeploymentArtifactIntegrity(MANIFEST, SOURCE);
  for (const [manifest, sidecar, source] of [
    [`${MANIFEST}\n`, JSON.stringify(integrity), SOURCE],
    [MANIFEST, JSON.stringify({...integrity, manifestSha256:"2".repeat(64)}), SOURCE],
    [MANIFEST, JSON.stringify(integrity), "2".repeat(40)],
    [MANIFEST, `${JSON.stringify(integrity)}\n`, SOURCE],
  ]) assert.throws(() => verifyDeploymentArtifactIntegrity(manifest, sidecar, source), error("DEPLOYMENT_ARTIFACT_MISMATCH"));
});

function error(code) { return value => value instanceof WalletAuthError && value.code === code; }
