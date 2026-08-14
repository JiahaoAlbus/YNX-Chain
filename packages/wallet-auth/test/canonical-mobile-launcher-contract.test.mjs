import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAuthorizationRejection,
  createCallbackURL,
  encodeRequestDeepLink,
  parseCallbackURL,
  parseWalletDeepLink,
  requestDigest,
  signAuthorization,
  verifyAuthorization,
  verifyAuthorizationRejection,
  WalletAuthError,
  WalletConnectionCoordinator
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, REGISTRY, request } from "./fixtures.mjs";

const contract = JSON.parse(await readFile(new URL("../../../release/integration/wallet-auth-canonical-mobile-launcher-migration-contract.json", import.meta.url), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("frozen launcher contract names only real shared Core APIs", () => {
  assert.equal(contract.sharedApis.encode.name, encodeRequestDeepLink.name);
  assert.equal(contract.sharedApis.walletParse.name, parseWalletDeepLink.name);
  assert.equal(contract.sharedApis.callback.create, createCallbackURL.name);
  assert.equal(contract.sharedApis.callback.parse, parseCallbackURL.name);
  assert.equal(contract.sharedApis.callback.approveVerify, verifyAuthorization.name);
  assert.equal(contract.sharedApis.callback.rejectVerify, verifyAuthorizationRejection.name);
  assert.equal(typeof WalletConnectionCoordinator, "function");
});

test("Android and iOS encode/parse vector is byte-frozen and registry-bound", () => {
  const value = request(), deepLink = encodeRequestDeepLink(value);
  assert.equal(requestDigest(value), contract.vectors.requestDigest);
  assert.deepEqual({ length: deepLink.length, sha256: sha256(deepLink) }, contract.vectors.deepLink);
  for (const platform of contract.sharedApis.walletParse.platforms) {
    assert.deepEqual(parseWalletDeepLink(deepLink, platform, { now: NOW, registry: REGISTRY }).request, value);
  }
  assert.throws(() => parseWalletDeepLink(deepLink, "android", { now: NOW, registry: { ...REGISTRY, "ynx-social-v1": { ...REGISTRY["ynx-social-v1"], bundleId: "com.attacker" } } }), WalletAuthError);
});

test("approval and rejection callbacks are byte-frozen and grant only their exact authority", () => {
  const value = request();
  const approval = signAuthorization(value, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const approvalCallback = createCallbackURL(approval);
  assert.deepEqual({ length: approvalCallback.length, sha256: sha256(approvalCallback) }, contract.vectors.approvalCallback);
  const parsedApproval = parseCallbackURL(approvalCallback, value.callback);
  assert.equal(verifyAuthorization(parsedApproval, { ...value, requestDigest: requestDigest(value), now: NOW }).account, approval.account);

  const rejection = createAuthorizationRejection(value, { decisionCode: "USER_REJECTED", rejectedAt: NOW.toISOString() });
  const rejectionCallback = createCallbackURL(rejection);
  assert.deepEqual({ length: rejectionCallback.length, sha256: sha256(rejectionCallback) }, contract.vectors.rejectionCallback);
  assert.equal(verifyAuthorizationRejection(parseCallbackURL(rejectionCallback, value.callback), value, NOW).authorityGranted, false);
  assert.throws(() => parseCallbackURL(approvalCallback, "ynxattacker://callback"), WalletAuthError);
});

test("migration contract keeps release and public gates false until direct owner evidence", () => {
  assert.equal(contract.migrationGate.releaseRuntimeMustHaveZeroBlockingFindings, true);
  assert.equal(contract.migrationGate.releaseBundlesMustHaveZeroLegacySchemesOrPaths, true);
  assert.equal(contract.migrationGate.currentPassed, false);
  assert.equal(contract.truthBoundary.allCallersMigrated, false);
  assert.equal(contract.truthBoundary.pixel9Validated, false);
  assert.equal(contract.truthBoundary.deployedPublic, false);
});
