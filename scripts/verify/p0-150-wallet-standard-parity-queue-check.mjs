import fs from "node:fs";
import assert from "node:assert/strict";

const path = "release/integration/p0-wallet-connectivity/wallet-standard-parity-queue-20260822.json";
const record = JSON.parse(fs.readFileSync(path, "utf8"));

assert.equal(record.taskId, "P0-150");
assert.equal(record.status, "P0_HIGHEST_PRIORITY_DIRECT_INSTALLED_E2E_DISPATCH_NO_EXECUTION_LEASE");
assert.equal(record.authoritativeSources.standardWalletProtocol.commit, "66003e76e804da16d472255efde50cb879055b96");
assert.equal(record.authoritativeSources.consumerSdk.commit, "315897e75c0ffe3e63435fe73cfec42244b851cc");
assert.equal(record.authoritativeSources.sharedProviderRuntime.commit, "98c6d5d784d212df8981a53b17118a511e246ad2");
assert.equal(record.authoritativeSources.sharedProviderRuntime.tree, "51a60a362d4ad5dd748bcdefb101f71b1d9e0cee");
assert.equal(record.network.evmChainHex, "0x1917");
assert.equal(record.network.defaultLocale, "en");
assert.equal(record.architecture.standardWalletConnectionIndependent, true);
assert.equal(record.architecture.gatewayOrProductSessionFailureEffect, "PRIVATE_SERVICE_DEGRADED_ONLY");
assert.deepEqual(record.platformQueue.map(({platform}) => platform), ["web-extension", "android", "ios", "macos", "windows"]);
assert.equal(record.completionGate.requiredExternalDapps, 3);
for (const required of ["approve", "reject", "wallet_addEthereumChain-0x1917", "wallet_switchEthereumChain-0x1917", "eth_signTypedData_v4", "real-test-transaction", "accountsChanged", "chainChanged", "disconnect", "refresh-restore", "explicit-disconnect"]) {
  assert.ok(record.completionGate.requiredPerDapp.includes(required), required);
}
assert.equal(record.currentTruth.parityComplete, false);
assert.equal(record.currentTruth.installedProviderVerified, false);
assert.equal(record.currentTruth.externalDappsComplete, 0);
assert.equal(record.scheduling.executionLeaseIssued, false);
assert.equal(record.scheduling.priorityAcceptance, "release/integration/p0-wallet-connectivity/acceptance/wallet-metamask-real-interop-priority-p0173-20260822.json");
assert.equal(record.scheduling.sourceOnlyMicroHardeningPrimaryProgress, false);
assert.match(record.scheduling.shopStartCondition, /P0-011/);
console.log("P0-150 Wallet Standard parity queue verified");
