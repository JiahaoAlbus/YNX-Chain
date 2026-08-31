import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "../..");
const registry = JSON.parse(readFileSync(resolve(packageRoot, "product-session-registry.json"), "utf8"));
const matrix = JSON.parse(readFileSync(resolve(repositoryRoot, "release/integration/wallet-product-session-router-migration.json"), "utf8"));
const contract = JSON.parse(readFileSync(resolve(repositoryRoot, "release/integration/wallet-product-session-router-contract.json"), "utf8"));

test("accepted Standard Wallet Connection remains independent from optional Product Session", () => {
  assert.equal(contract.standardWalletConnection.acceptedProtocolCommit, "66003e76e804da16d472255efde50cb879055b96");
  assert.equal(contract.standardWalletConnection.acceptedConsumerSdkCommit, "315897e75c0ffe3e63435fe73cfec42244b851cc");
  assert.deepEqual(contract.standardWalletConnection.productSessionFailureOutcome, {
    standardConnection: "CONNECTED",
    privateYnxService: "DEGRADED",
    fabricatedLocalProductSession: false,
  });
  assert.equal(contract.enhancedProductSession.mayReplaceStandardWalletConnection, false);
  assert.equal(contract.enhancedProductSession.mayCreateLocalOrCannedSession, false);
  assert.equal(contract.standardWalletConnection.productConsumptionVerified, false);
  assert.equal(contract.standardWalletConnection.installedInteroperabilityVerified, false);
});

test("migration matrix covers the exact registry and cites only branch-local evidence", () => {
  assert.deepEqual(matrix.products.map((item) => item.productId), registry.products.map((item) => item.productId));
  assert.deepEqual(matrix.requiredProductIds, ["calendar", "card", "creator-studio", "developer", "dex", "exchange", "finance", "pay", "quant", "shop", "social", "video"]);
  assert.equal(matrix.requiredProductMigrationCount, matrix.products.filter((item) => matrix.requiredProductIds.includes(item.productId) && item.migrated).length);
  assert.equal(matrix.nonProductRegistryClientCount, matrix.products.filter((item) => !matrix.requiredProductIds.includes(item.productId)).length);
  assert.deepEqual(matrix.requiredOwnerEvidenceSegments, ["runtime-source", "public-gateway-v2", "visible-platform-lifecycle"]);
  assert.equal(matrix.productRuntimeMigrationCount, matrix.products.filter((item) => item.migrated).length);
  assert.equal(matrix.fixedProductCount, matrix.products.filter((item) => item.migrated).length);
  for (const product of matrix.products) {
    assert.ok(["contract-only", "core-runtime-candidate", "legacy-direct", "shared-sdk-v1", "canonical-launcher-v1", "standard-wallet-only", "standard-wallet-current-source-public", "root-factory-source-only", "root-factory-owner-source-only", "root-factory-platform-negative", "android-retired-web-legacy", "migrated-v2"].includes(product.consumer));
    assert.ok(Array.isArray(product.evidence) && product.evidence.length > 0);
    for (const path of product.evidence) assert.equal(existsSync(resolve(repositoryRoot, path)), true, `${product.productId} evidence is missing: ${path}`);
  }
});

test("legacy and shared-v1 consumers cannot be presented as v2 migrations", () => {
  for (const product of matrix.products) {
    const sources = product.evidence.map((path) => readFileSync(resolve(repositoryRoot, path), "utf8")).join("\n");
    if (product.consumer === "legacy-direct") assert.match(sources, /ynxwallet:\/\/authorize|wallet-auth/i);
    if (product.consumer === "shared-sdk-v1") {
      assert.match(sources, /@ynx-chain\/wallet-auth/);
      assert.doesNotMatch(sources, /RecoverableProductSessionClient|\/v2\/product-sessions\//);
    }
    if (product.consumer === "canonical-launcher-v1") {
      assert.match(sources, /@ynx-chain\/wallet-auth/);
      assert.match(sources, /encodeRequestDeepLink/);
      assert.match(sources, /WALLET_NOT_INSTALLED|SCHEME_NOT_REGISTERED/);
      assert.doesNotMatch(sources, /createProductWalletConnection|\/v2\/product-sessions\//);
    }
    if (product.consumer === "standard-wallet-only") {
      assert.match(sources, /standard-wallet-only/);
      assert.match(sources, /PRIVATE_SERVICE_DEGRADED/);
      assert.match(sources, /"productSessionV2GatewayEvidenced": false/);
      assert.match(sources, /"visiblePlatformEvidenced": false/);
      assert.match(sources, /"migratedV2": false/);
    }
    if (product.consumer === "standard-wallet-current-source-public") {
      assert.match(sources, /"currentSourcePublic":true/);
      assert.match(sources, /"productSessionV2":false/);
      assert.match(sources, /"migratedV2":false/);
    }
    if (product.consumer === "root-factory-source-only") {
      assert.match(sources, /"rootFactoryConsumed": true/);
      assert.match(sources, /"publicGatewayLifecycleForCardVerified": false/);
      assert.match(sources, /"installedOrBrowserVisibleFlowVerified": false/);
      assert.match(sources, /"migratedV2": false/);
    }
    if (product.consumer === "root-factory-owner-source-only") {
      assert.match(sources, /"rootFactoryConsumed": true/);
      assert.match(sources, /"runtimeRootFactoryVerified": false/);
      assert.match(sources, /"distinctPublicV2RouteVerified": false/);
      assert.match(sources, /"installedOrBrowserApprovalVerified": false/);
      assert.match(sources, /"networkLossRetryVerified": false/);
      assert.match(sources, /"migratedV2": false/);
    }
    if (product.consumer === "root-factory-platform-negative") {
      assert.match(sources, /"rootFactoryConsumed": true/);
      assert.match(sources, /"rootFactoryOpenedInstalledWallet": true/);
      assert.match(sources, /"installedVisibleNegativeVerified": true/);
      assert.match(sources, /"installedVisibleSuccessVerified": false/);
      assert.match(sources, /"migratedV2": false/);
    }
    if (product.consumer === "android-retired-web-legacy") {
      assert.match(sources, /"newAuthorizationResult": "CLIENT_RETIRED"/);
      assert.match(sources, /"webPwaRemainsRegistered": true/);
      assert.match(sources, /"currentPublicRuntimeUsesRegistryV3": false/);
      assert.match(sources, /"shopWebPwaRootFactoryMigrated": false/);
    }
    if (product.consumer === "core-runtime-candidate") assert.equal(product.migrated, false);
    if (product.consumer !== "migrated-v2") assert.equal(product.migrated, false);
  }
});

test("migrated-v2 requires separate runtime, Gateway and visible platform evidence", () => {
  for (const product of matrix.products.filter((item) => item.migrated)) {
    assert.equal(product.consumer, "migrated-v2");
    for (const field of ["runtimeEvidence", "gatewayEvidence", "platformEvidence"]) {
      assert.ok(Array.isArray(product[field]) && product[field].length > 0, `${product.productId} lacks ${field}`);
      for (const path of product[field]) assert.equal(existsSync(resolve(repositoryRoot, path)), true, `${product.productId} ${field} is missing: ${path}`);
    }
    const runtime = product.runtimeEvidence.map((path) => readFileSync(resolve(repositoryRoot, path), "utf8")).join("\n");
    const gateway = product.gatewayEvidence.map((path) => readFileSync(resolve(repositoryRoot, path), "utf8")).join("\n");
    assert.match(runtime, /createProductWalletConnection/);
    assert.doesNotMatch(runtime, /new\s+(WalletConnectionCoordinator|RecoverableProductSessionClient|ProductSessionGatewayFetchAdapter)\s*\(/);
    assert.match(gateway, /\/v2\/product-sessions\/(challenge|complete|introspect)/);
  }
});
