import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Developer consumes the accepted Wallet v2 package through its root factory only", async () => {
  const [runtime, panel, mac, release] = await Promise.all([
    read("frontend/src/wallet/product-session-v2.ts"),
    read("frontend/src/chain/ChainPanel.tsx"),
    read("desktop/macos/main.m"),
    read("product-release.json"),
  ]);
  assert.match(runtime, /createProductWalletConnection/);
  assert.match(runtime, /203be5e108be468350591615a64d5d36ab87a8f1/);
  assert.match(runtime, /94e291a6757447f89c7cf6b8f01bbf811cb7d1f7/);
  assert.match(runtime, /https:\/\/wallet-auth\.ynxweb4\.com/);
  assert.doesNotMatch(runtime, /ProductSessionGatewayFetchAdapter|RecoverableProductSessionClient|gatewayEndpoint|callback:\s*|origin:\s*|session:\s*/);
  assert.match(runtime, /protectedStorage/);
  assert.match(mac, /kSecClassGenericPassword/);
  assert.match(mac, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(mac, /storage-get/);
  assert.match(mac, /wallet-availability/);
  assert.match(mac, /URLForApplicationToOpenURL:parts\.URL/);
  assert.doesNotMatch(mac, /availability_probe_not_opened/);
  assert.match(mac, /\[A-Za-z0-9_-\]\{80,8192\}/);
  assert.match(runtime, /walletAvailability/);
  assert.doesNotMatch(runtime, /walletInstalled:\s*async \(\) => true/);
  assert.match(panel, /Continue as Guest \/ Try mode/);
  assert.match(panel, /openDeveloperWalletReview/);
  assert.match(panel, /A degraded optional Product Session never disconnects Standard Wallet/);
  assert.match(panel, /browser sessions are not relabeled as secure/);
  const truth = JSON.parse(release);
  assert.equal(truth.schemaVersion, 2);
  assert.equal(truth.commit, null);
  assert.equal(truth.currentPublicCandidate, null);
  assert.equal(truth.sourceStatus.status, "OWNED_SOURCE_FROZEN_NOT_FORMALLY_RELEASED");
  assert.match(truth.currentPublicObservation.scope, /gateway source\/status only; not native or business acceptance/);
  assert.equal(truth.featureStatus.ynxCodePlatform.publicDeployment.formalNativePublication, false);
  assert.equal(truth.featureStatus.ynxCodePlatform.fullNativeWorkbenchAccepted, false);
  assert.equal(truth.acceptanceGates.canonicalRealWalletUserJourney, "NOT_RUN");
  assert.equal(truth.acceptanceGates.actualWalletBusinessApproval, "NOT_RUN");
  for (const field of ["integratedCentral", "deployedPublic", "releasePublished", "productionSigned", "fullProductAccepted"]) assert.equal(truth[field], false);
  assert.equal(Object.hasOwn(truth, "walletProductSessionV2"), false);
});
