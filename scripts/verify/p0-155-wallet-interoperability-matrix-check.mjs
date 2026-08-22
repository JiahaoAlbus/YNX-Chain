#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const path = new URL("../../release/integration/p0-wallet-connectivity/wallet-metamask-level-interoperability-matrix-20260822.json", import.meta.url);
const matrix = JSON.parse(fs.readFileSync(path, "utf8"));

assert.equal(matrix.taskId, "P0-155");
assert.equal(matrix.status, "P0_HIGHEST_PRIORITY_DIRECT_INSTALLED_INTEROP_DISPATCH_NO_EXECUTION_LEASE");
assert.equal(matrix.acceptedAuthorities.protocol, "66003e76e804da16d472255efde50cb879055b96");
assert.equal(matrix.acceptedAuthorities.consumerSdk, "315897e75c0ffe3e63435fe73cfec42244b851cc");
assert.equal(matrix.acceptedAuthorities.sharedProviderSource, "98c6d5d784d212df8981a53b17118a511e246ad2");
assert.equal(matrix.network.evmChainHex, "0x1917");
assert.equal(matrix.network.defaultLocale, "en");

const expectedPlatforms = ["android", "desktop-windows", "ios", "macos", "web-extension"];
assert.deepEqual(matrix.platforms.map(({ id }) => id).sort(), expectedPlatforms);
for (const platform of matrix.platforms) {
  assert.notEqual(platform.evidenceTier, matrix.evidencePolicy.completionEvidenceTier);
  assert.equal(platform.countsTowardCompletion, false);
  assert.ok(platform.blockers.length > 0);
}

const expectedRequirements = [
  "external-dapp-discovers-ynx-wallet",
  "ynx-dapp-selects-ynx-wallet-or-metamask",
  "walletconnect-v2-qr-and-deep-link",
  "approve-and-reject",
  "add-and-switch-0x1917",
  "personal-sign",
  "eip712-typed-data",
  "real-testnet-transaction",
  "refresh-and-cold-start-restore",
  "disconnect-and-revoke",
  "accounts-chain-disconnect-events",
  "product-session-degraded-standard-connection-survives"
];
assert.deepEqual(matrix.completionRequirements.map(({ id }) => id), expectedRequirements);
assert.ok(matrix.completionRequirements.every(({ countsTowardCompletion }) => countsTowardCompletion === false));

assert.equal(matrix.dappAcceptance.firstPartyDappsComplete, 0);
assert.equal(matrix.dappAcceptance.externalDappsComplete, 0);
assert.equal(matrix.controlPlaneAudit.heavyOwner, null);
assert.equal(matrix.controlPlaneAudit.walletPathOverlap, false);
assert.equal(matrix.controlPlaneAudit.executionLeaseIssued, false);
assert.equal(matrix.controlPlaneAudit.productionLeaseIssued, false);
assert.equal(matrix.controlPlaneAudit.webInstallConfirmationGranted, false);
assert.equal(matrix.executionDispatch.acceptance, "P0-173");
assert.equal(matrix.executionDispatch.sourceOnlyMicroHardeningIsPrimaryProgress, false);
assert.equal(matrix.executionDispatch.nextAcceptedProgress, "DIRECT_INSTALLED_E2E_OR_EXECUTABLE_EXTERNAL_BLOCKER");
assert.equal(matrix.executionDispatch.metamaskImpersonationForbidden, true);
assert.ok(Object.values(matrix.truth).every(value => value === false || value === "0/12"));

console.log("P0-155 MetaMask-level interoperability matrix verified");
