import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const evidence = JSON.parse(await readFile(new URL("docs/integration/wallet-desktop-cli-sdk-endpoint-contract-consumption-20260815.json", root), "utf8"));
const matrixBytes = await readFile(new URL(evidence.centralContract.endpointMatrix.path, root));
const launcherBytes = await readFile(new URL(evidence.centralContract.androidLauncher.path, root));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

assert.equal(sha256(matrixBytes), evidence.centralContract.endpointMatrix.sha256);
assert.equal(sha256(launcherBytes), evidence.centralContract.androidLauncher.sha256);
const matrix = JSON.parse(matrixBytes);
const launcher = JSON.parse(launcherBytes);
assert.equal(matrix.canonical.rpcUrl, evidence.canonical.rpc);
assert.equal(matrix.canonical.restUrl, evidence.canonical.rest);
assert.equal(matrix.canonical.faucetUrl, evidence.canonical.faucet);
assert.equal(matrix.network.chainIdHex, evidence.canonical.chainId);
assert.equal(launcher.authority.uriTemplate, matrix.canonical.walletAuthorizationDeepLinkTemplate);
assert.equal(launcher.authority.walletPackage, "com.ynxweb4.wallet");

for (const path of evidence.updatedOwnerConsumers.filter((path) => !path.endsWith("README.md"))) {
  const source = await readFile(new URL(path, root), "utf8");
  assert.ok(source.includes(evidence.canonical.rpc), `${path} does not consume the frozen canonical RPC`);
  assert.ok(!source.includes("https://evm.ynxweb4.com"), `${path} retains the legacy RPC default`);
}

assert.equal(evidence.releaseGates.endpointMatrixConsumed, true);
assert.equal(evidence.releaseGates.sourceConsumersUpdated, true);
assert.equal(evidence.releaseGates.sourceTestsPassed, true);
for (const [gate, value] of Object.entries(evidence.releaseGates)) {
  if (["endpointMatrixConsumed", "sourceConsumersUpdated", "sourceTestsPassed"].includes(gate)) continue;
  assert.equal(value, false, `${gate} lacks direct promotion evidence`);
}
assert.ok(evidence.verification.liveCanonicalConsumerProbes.every((probe) => probe.failedClosed && !probe.chainIdProved));
console.log("wallet endpoint contract consumption: PASS (release/public capability gates remain false)");
