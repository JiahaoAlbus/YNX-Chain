import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  centralRegistrationByProduct,
  centralProtocolEntry,
  createAuthorizationRejection,
  createCallbackURL,
  encodeRequestDeepLink,
  parseCallbackURL,
  parseCentralRegistryDocument,
  parseWalletDeepLink,
  requestDigest,
  registryParserBinding,
  signAuthorization,
  WalletAuthError,
} from "../src/index.js";
import { ACCOUNT_SECRET } from "./fixtures.mjs";

const NOW = new Date("2026-08-15T08:01:00.000Z");
const source = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
const registration = centralRegistrationByProduct(parseCentralRegistryDocument(source), "wallet-web-companion");
const registry = registryParserBinding(centralProtocolEntry(registration));
const contract = JSON.parse(readFileSync(new URL("../../../release/integration/wallet-auth-web-companion-registry-contract.json", import.meta.url), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const base = {
  version: "1",
  nonce: "wallet_web_companion_nonce_00000001",
  chainId: "ynx_6423-1",
  requestingProduct: "wallet-web-companion",
  productClientId: "ynx-wallet-web-companion-v1",
  bundleId: "web.ynx.wallet.companion",
  productDeviceAlgorithm: "p256-sha256",
  productDeviceKey: "AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",
  callback: "https://www.ynxweb4.com/dapp/wallet/wallet-auth/callback",
  issuedAt: "2026-08-15T08:00:00.000Z",
  expiresAt: "2026-08-15T08:05:00.000Z",
};

for (const vector of [
  { operation: "add-chain", scopes: ["account:read", "chain:network:add"], purpose: "Review adding YNX Testnet to this browser wallet connection." },
  { operation: "switch-chain", scopes: ["account:read", "chain:network:switch"], purpose: "Review switching this browser wallet connection to YNX Testnet." },
  { operation: "product-session", scopes: ["account:read", "wallet:session:request"], purpose: "Review a short-lived Product Session for the official YNX Wallet Web companion." },
]) test(`official Web companion ${vector.operation} uses the canonical authorization deep link`, () => {
  const request = { ...base, nonce: `${base.nonce}_${vector.operation.replace("-", "_")}`, scopes: vector.scopes, purpose: vector.purpose };
  const deepLink = encodeRequestDeepLink(request);
  assert.equal(requestDigest(request), contract.operations[vector.operation].requestDigest);
  assert.deepEqual({ length: deepLink.length, sha256: sha256(deepLink) }, contract.operations[vector.operation].deepLink);
  for (const platform of ["android", "ios"]) {
    assert.deepEqual(parseWalletDeepLink(deepLink, platform, { now: NOW, registry }).request, request);
  }
});

test("official Web companion rejection returns no authority on the exact HTTPS callback", () => {
  const request = { ...base, nonce: `${base.nonce}_product_session`, scopes: ["account:read", "wallet:session:request"], purpose: "Review a short-lived Product Session for the official YNX Wallet Web companion." };
  const rejection = createAuthorizationRejection(request, { decisionCode: "USER_REJECTED", rejectedAt: NOW.toISOString() });
  const callback = createCallbackURL(rejection);
  assert.deepEqual(parseCallbackURL(callback, request.callback), rejection);
  assert.equal(rejection.authorityGranted, false);
  assert.deepEqual(rejection.grantedScopes, []);
  assert.deepEqual({ length: callback.length, sha256: sha256(callback) }, contract.operations["product-session"].rejectionCallback);
  const approval = createCallbackURL(signAuthorization(request, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() }));
  assert.deepEqual({ length: approval.length, sha256: sha256(approval) }, contract.operations["product-session"].approvalCallback);
});

test("Web companion freeze keeps every public and device-visible gate false", () => {
  assert.equal(contract.registry.enabled, true);
  assert.equal(contract.transport.operationFieldForbidden, true);
  assert.equal(contract.transport.exchangeActionReuseForbidden, true);
  assert.equal(Object.values(contract.truthBoundary).filter(Boolean).length, 9);
  assert.equal(contract.truthBoundary.coreRuntimeCandidate, true);
  assert.equal(contract.truthBoundary.restartExpiryRevokeCandidate, true);
  assert.equal(contract.truthBoundary.concurrentDisconnectLinearizedCandidate, true);
  assert.equal(contract.truthBoundary.concurrentCallbackLinearizedCandidate, true);
  assert.equal(contract.truthBoundary.callbackDisconnectNoResurrectionCandidate, true);
  assert.equal(contract.truthBoundary.postCompletionOutageRevokeCandidate, true);
  assert.equal(contract.truthBoundary.restoreDisconnectNoResurrectionCandidate, true);
  assert.deepEqual(contract.runtimeIntegration.gatewayRoutes, ["/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect", "/v2/product-sessions/revoke"]);
  assert.equal(contract.truthBoundary.deployedPublicRegistry, false);
  assert.equal(contract.truthBoundary.webCompanionVisibleSuccess, false);
});

test("official Web companion fails closed on wrong product, bundle, callback and scope", () => {
  for (const changed of [
    { requestingProduct: "exchange" },
    { bundleId: "web.attacker.wallet" },
    { callback: "https://www.ynxweb4.com/dapp/wallet/attacker" },
    { scopes: ["account:read", "exchange:trade"] },
  ]) assert.throws(
    () => parseWalletDeepLink(encodeRequestDeepLink({ ...base, scopes: ["account:read"], purpose: "Review an exact official Wallet Web companion request.", ...changed }), "android", { now: NOW, registry }),
    WalletAuthError,
  );
});
