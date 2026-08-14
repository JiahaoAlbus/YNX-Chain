import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const evidence = JSON.parse(await readFile(new URL("docs/integration/wallet-desktop-cli-sdk-public-endpoint-audit-20260815.json", root), "utf8"));
const legacy = evidence.legacyDefaultInventory.endpoint;
const canonical = evidence.centralMatrix.candidateCanonicalRpc;

assert.equal(evidence.centralMatrix.tracked, false);
assert.equal(evidence.centralMatrix.committed, false);
assert.equal(evidence.centralMatrix.consumed, false);
assert.equal(evidence.directPublicProbes.canonicalRpc.ethChainId, "0x1917");
assert.equal(evidence.directPublicProbes.legacyRpc.ethChainId, "0x1917");
assert.equal(evidence.directPublicProbes.faucetHealth.httpStatus, 200);
assert.equal(evidence.directPublicProbes.authV2Options.httpStatus, 415);
assert.ok(Object.values(evidence.releaseGates).every((value) => value === false));

for (const path of evidence.legacyDefaultInventory.compressedCliBinaries) {
  const binary = gunzipSync(await readFile(new URL(path, root)));
  assert.ok(binary.includes(Buffer.from(legacy)), `${path} did not contain the audited legacy endpoint`);
  assert.ok(!binary.includes(Buffer.from(canonical)), `${path} unexpectedly contains the mutable canonical endpoint`);
}

for (const path of evidence.legacyDefaultInventory.desktopArtifactManifests) {
  const manifest = JSON.parse(await readFile(new URL(path, root), "utf8"));
  assert.equal(manifest.lifecycleEvidence?.rpcEndpoint, legacy, `${path} endpoint observation drifted`);
}

for (const path of evidence.legacyDefaultInventory.sdkPackages.filter((path) => path.includes("typescript-sdk"))) {
  const packed = execFileSync("tar", ["-xOf", new URL(path, root).pathname, "package/ynx-testnet.js"], { encoding: "utf8" });
  assert.ok(packed.includes(legacy), `${path} did not contain the audited legacy endpoint`);
}

console.log("wallet public endpoint artifact audit: PASS (matrix consumption and release gates remain false)");
