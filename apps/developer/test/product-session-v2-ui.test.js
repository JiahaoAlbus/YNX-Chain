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
  assert.equal(truth.currentPublicCandidate.result, "source-bound-central-receipt; independent-current-readback-pending");
  assert.equal(truth.currentPublicCandidate.sourceCommit, "d4052228a2261c5ced6a8e8cfcbf763edabf2103");
  assert.equal(truth.walletProductSessionV2.migratedV2, false);
  assert.equal(truth.walletProductSessionV2.runtimeFactoryVerified, false);
  assert.equal(truth.walletProductSessionV2.publicV2RouteVerified, true);
  assert.equal(truth.walletProductSessionV2.publicV2RouteProof.stateCreated, false);
  assert.equal(truth.walletProductSessionV2.authoritativeOrigin, "https://wallet-auth.ynxweb4.com");
});
