import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { test } from "node:test";
import { createProductSessionRequest, createProductSessionReturnURL, encodeRequestDeepLink, evmAddressFromYNX, parseProductSessionReturnURL, signProductSessionApproval, walletIdentity } from "@ynx-chain/wallet-auth";
import { CANONICAL_AUTHORIZATION_REVIEW_REQUIRED, CALLBACK_PROTOCOL_SOURCE, DesktopAuthorizationController, evaluateWalletCallback, parseWalletConnectActivation } from "../src/callback-policy.mjs";
import { PRODUCT_SESSION_REGISTRY } from "../src/wallet-auth-contract.mjs";
import { canonicalizeWindowsProductCallbackUrl, canonicalizeWindowsYNXWalletProtocolUrl, extractYNXWalletProtocolUrl } from "../src/protocol-activation.mjs";

const now = new Date("2026-08-21T08:00:00.000Z");
const productDevice = createECDH("prime256v1");
productDevice.setPrivateKey(Buffer.alloc(32, 0x42));
const request = createProductSessionRequest(PRODUCT_SESSION_REGISTRY, {
  productId: "social", platform: "linux", deviceId: "desktop-test-device",
  deviceKey: productDevice.getPublicKey(null, "compressed").toString("base64url"),
  scopes: PRODUCT_SESSION_REGISTRY.products.find(product => product.productId === "social").scopes,
  nonce: "nonce_abcdefghijklmnopqrstuvwxyz12", state: "state_abcdefghijklmnopqrstuvwxyz12",
  purpose: "Sign in to Social with this account.",
}, now);
const deepLink = encodeRequestDeepLink(request);
const secret = "1".padStart(64, "0");
const identity = walletIdentity(secret);
const account = evmAddressFromYNX(identity.account);

function controllerFixture({ openExternal, initialized = true } = {}) {
  const state = { now, account: initialized ? account : null, signed: 0, opened: [] };
  const authority = {
    async accountStatus() { return { initialized: Boolean(state.account), account: state.account, ynxAccount: state.account ? identity.account : null }; },
    async approveCanonicalAuthorization(input, issuedAt, expectedAccount) {
      if (expectedAccount !== state.account) throw Object.assign(new Error("Account changed"), { code: "ACCOUNT_CHANGED" });
      state.signed++;
      const at = new Date(issuedAt);
      const approval = signProductSessionApproval(PRODUCT_SESSION_REGISTRY, input, { accountSecret: secret, scopes: input.scopes, expiresAt: input.expiresAt }, at);
      return { approval, callbackUrl: createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, input, { result: "approved", approval }, at) };
    }
  };
  const controller = new DesktopAuthorizationController({
    authority, clock: () => state.now, requestId: () => "desktop-review-id",
    openExternal: async url => { state.opened.push(url); if (openExternal) await openExternal(url); }
  });
  return { controller, state };
}
const boundAction = (review, action) => ({ id: review.id, account: review.account, action });

test("desktop consumes the registered Product Session v2 route and review identity", () => {
  const review = evaluateWalletCallback(deepLink, { now });
  assert.equal(CALLBACK_PROTOCOL_SOURCE.protocol, "product-session-v2");
  assert.equal(CALLBACK_PROTOCOL_SOURCE.bundleIdentifier, "com.ynxweb4.wallet.macos");
  assert.equal(review.acceptedForReview, true);
  assert.equal(review.code, CANONICAL_AUTHORIZATION_REVIEW_REQUIRED);
  assert.equal(review.displayName, "YNX Social");
  assert.equal(review.origin, request.origin);
  assert.equal(review.callback, request.callback);
  assert.deepEqual(review.scopes, request.scopes);
  assert.equal(review.callbackEmitted, false);
  assert.equal(review.authorityGranted, false);
});

test("missing, malformed, expired, legacy v1 and substituted requests cannot be approved", () => {
  for (const url of [
    "ynxwallet://authorize", "ynxwallet://authorize?request=%25",
    encodeRequestDeepLink({ ...request, expiresAt: "2026-08-21T07:59:30.000Z" }),
    encodeRequestDeepLink({ ...request, version: "1" }),
    encodeRequestDeepLink({ ...request, origin: "app://linux/com.attacker.app" }),
    encodeRequestDeepLink({ ...request, callback: "ynxattacker://wallet-auth/callback" }),
    encodeRequestDeepLink({ ...request, scopes: ["admin:all"] }),
    deepLink.replace("authorize", "approve")
  ]) {
    const result = evaluateWalletCallback(url, { now });
    assert.equal(result.acceptedForReview, false);
    assert.equal(result.callbackEmitted, false);
    assert.equal(result.authorityGranted, false);
  }
});

test("approval binds the reviewed account, origin, nonce and state without claiming a completed session", async () => {
  const { controller, state } = controllerFixture();
  const review = await controller.receive(deepLink);
  assert.equal(review.account, account);
  assert.equal(review.ynxAccount, identity.account);
  await assert.rejects(controller.act({ ...boundAction(review, "approve"), id: "different-id" }), { code: "AUTHORIZATION_REVIEW_MISMATCH" });
  await assert.rejects(controller.act({ ...boundAction(review, "approve"), account: "0x" + "22".repeat(20) }), { code: "AUTHORIZATION_REVIEW_MISMATCH" });
  assert.equal(state.signed, 0);
  const result = await controller.act(boundAction(review, "approve"));
  assert.equal(result.callbackEmitted, true);
  assert.equal(result.authorityGranted, true);
  assert.equal(result.productSessionCreated, false);
  assert.equal(result.callbackReceivedProved, false);
  const returned = parseProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, request, state.opened[0], now);
  assert.equal(returned.status, "ready");
  assert.equal(returned.approval.account, identity.account);
  assert.equal(returned.approval.origin, request.origin);
  assert.equal(new URL(state.opened[0]).searchParams.get("nonce"), request.nonce);
  assert.equal(new URL(state.opened[0]).searchParams.get("state"), request.state);
  await assert.rejects(controller.act("approve"), { code: "NO_PENDING_AUTHORIZATION_REQUEST" });
  assert.equal(state.signed, 1);
});

test("rejection returns the exact product state without signing or granting authority", async () => {
  const { controller, state } = controllerFixture({ initialized: false });
  const review = await controller.receive(deepLink);
  const result = await controller.act(boundAction(review, "reject"));
  assert.equal(result.code, "USER_REJECTED");
  assert.equal(result.callbackEmitted, true);
  assert.equal(result.authorityGranted, false);
  assert.equal(state.signed, 0);
  assert.equal(parseProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, request, state.opened[0], now).status, "user-rejected");
});

test("a second request and double approval cannot replace or resolve the visible review twice", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const { controller, state } = controllerFixture({ openExternal: () => blocked });
  const review = await controller.receive(deepLink);
  assert.equal((await controller.receive(deepLink)).code, "AUTHORIZATION_REQUEST_IN_PROGRESS");
  assert.equal(controller.pending.id, review.id);
  const approving = controller.act(boundAction(review, "approve"));
  await assert.rejects(controller.act("approve"), { code: "AUTHORIZATION_ACTION_IN_PROGRESS" });
  assert.throws(() => controller.invalidate(), { code: "AUTHORIZATION_ACTION_IN_PROGRESS" });
  release(); await approving;
  assert.equal(state.signed, 1);
  assert.equal(state.opened.length, 1);
});

test("expired or changed-account reviews never sign and account creation refreshes consent", async () => {
  const { controller, state } = controllerFixture({ initialized: false });
  await controller.receive(deepLink);
  await assert.rejects(controller.act("approve"), { code: "ACCOUNT_NOT_CREATED" });
  state.account = account;
  assert.equal((await controller.refreshAccount()).account, account);
  state.account = "0x" + "22".repeat(20);
  await assert.rejects(controller.act("approve"), { code: "ACCOUNT_CHANGED" });
  assert.equal((await controller.refreshAccount()).code, "ACCOUNT_CHANGED");
  assert.equal(controller.pending, null);
  state.account = account;
  await controller.receive(deepLink);
  state.now = new Date(request.expiresAt);
  await assert.rejects(controller.act("approve"), { code: "SESSION_EXPIRED" });
  assert.equal(controller.pending, null);
  assert.equal(state.signed, 0);
  assert.equal(state.opened.length, 0);
});

test("callback launch retry preserves the same signed result and cannot flip the decision", async () => {
  let attempts = 0;
  const { controller, state } = controllerFixture({ openExternal: () => { if (++attempts === 1) throw new Error("Browser unavailable"); } });
  const review = await controller.receive(deepLink);
  await assert.rejects(controller.act(boundAction(review, "approve")), error => error.authorizationStage === "CANONICAL_CALLBACK_LAUNCH_FAILED");
  await assert.rejects(controller.act("reject"), { code: "AUTHORIZATION_RESULT_ALREADY_PREPARED" });
  await controller.act(boundAction(review, "approve"));
  assert.equal(state.signed, 1);
  assert.equal(state.opened[0], state.opened[1]);
});

test("an expired unattended review cannot block a fresh product login", async () => {
  const { controller, state } = controllerFixture();
  await controller.receive(deepLink);
  state.now = new Date(request.expiresAt);
  const fresh = { ...request, nonce: "fresh_abcdefghijklmnopqrstuvwxyz12", issuedAt: state.now.toISOString(), expiresAt: new Date(state.now.getTime() + 300_000).toISOString() };
  const review = await controller.receive(encodeRequestDeepLink(fresh));
  assert.equal(review.acceptedForReview, true);
  assert.equal(review.request.nonce, fresh.nonce);
  assert.equal(state.signed, 0);
});

test("Windows command-line activation extracts only a bounded ynxwallet URL", () => {
  assert.equal(extractYNXWalletProtocolUrl(["C:\\Program Files\\YNX Wallet\\YNX Wallet.exe", deepLink]), deepLink);
  assert.equal(extractYNXWalletProtocolUrl(["YNX Wallet.exe", "https://example.com", "--flag"]), null);
  assert.equal(extractYNXWalletProtocolUrl(["YNX Wallet.exe", `ynxwallet://authorize?request=${"a".repeat(70 * 1024)}`]), null);
  assert.equal(extractYNXWalletProtocolUrl("ynxwallet://authorize"), null);
});

test("Windows-only slash normalization maps one exact OS activation back to the registered route", () => {
  const windowsNormalized = deepLink.replace("ynxwallet://authorize?", "ynxwallet://authorize/?");
  assert.equal(canonicalizeWindowsYNXWalletProtocolUrl(windowsNormalized, "win32"), deepLink);
  assert.equal(canonicalizeWindowsYNXWalletProtocolUrl(windowsNormalized, "darwin"), windowsNormalized);
  assert.equal(canonicalizeWindowsYNXWalletProtocolUrl(`${windowsNormalized}&extra=1`, "win32"), `${windowsNormalized}&extra=1`);
  assert.equal(canonicalizeWindowsYNXWalletProtocolUrl(windowsNormalized.replace("authorize/", "approve/"), "win32"), windowsNormalized.replace("authorize/", "approve/"));
});

test("legacy Windows callback normalization remains narrowly bounded and grants no authorization", () => {
  const expected = "ynx-social://com.ynx.social";
  assert.equal(canonicalizeWindowsProductCallbackUrl("ynx-social://com.ynx.social/?response=abc%2B123", expected, "win32"), `${expected}?response=abc%2B123`);
  for (const value of ["ynx-social://evil.example/?response=abc", "ynx-social://com.ynx.social/path?response=abc", "ynx-social://com.ynx.social/?response=abc&extra=1", "ynx-social://com.ynx.social/?response=abc#fragment"]) assert.equal(canonicalizeWindowsProductCallbackUrl(value, expected, "win32"), value);
});

test("WalletConnect activation accepts only the exact wc route and a single v2 URI", () => {
  const uri = `wc:${"a".repeat(64)}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`;
  assert.deepEqual(parseWalletConnectActivation("ynxwallet://wc"), { route: "walletconnect", uri: null });
  assert.equal(parseWalletConnectActivation(`ynxwallet://wc?uri=${encodeURIComponent(uri)}`).uri, uri);
  assert.equal(parseWalletConnectActivation(`ynxwallet://wc/?uri=${encodeURIComponent(uri)}`, "win32").uri, uri);
  assert.equal(parseWalletConnectActivation(deepLink), null);
  for (const value of ["ynxwallet://wc/path", "ynxwallet://wc?uri=invalid", "ynxwallet://wc?uri=wc:abc@1", `ynxwallet://wc?uri=${encodeURIComponent(uri)}&extra=1`, "ynxwallet://wc#fragment", "ynxwallet://user@wc"]) assert.throws(() => parseWalletConnectActivation(value), { code: "INVALID_WALLETCONNECT_URI" });
});

test("Windows capture verification proves approved and rejected v2 returns without claiming login", async () => {
  const { verifyWindowsCallbackCapture } = await import("../scripts/verify-windows-callback-capture.mjs");
  const { controller, state } = controllerFixture();
  await controller.receive(deepLink); await controller.act("approve");
  const raw = state.opened[0].replace("com.ynx.social?", "com.ynx.social/?");
  const proof = verifyWindowsCallbackCapture(raw, deepLink, "approved", account, now);
  assert.equal(proof.windowsSlashNormalized, true);
  assert.equal(proof.signatureVerified, true);
  assert.equal(proof.nonceVerified, true);
  assert.equal(proof.stateVerified, true);
  assert.equal(proof.productSessionCreated, false);
  assert.equal(proof.privateApiVerified, false);
  assert.throws(() => verifyWindowsCallbackCapture(raw, deepLink, "approved", "0x" + "22".repeat(20), now), /differs from the installed account/);
  const wrongNonce = new URL(raw); wrongNonce.searchParams.set("nonce", "n".repeat(32));
  assert.throws(() => verifyWindowsCallbackCapture(wrongNonce.href, deepLink, "approved", account, now), /did not match/);
  const rejected = createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, request, { result: "rejected", reason: "user_rejected" }, now);
  const rejection = verifyWindowsCallbackCapture(rejected, deepLink, "rejected", null, now);
  assert.equal(rejection.signatureVerified, false);
  assert.equal(rejection.result, "rejected");
  assert.throws(() => verifyWindowsCallbackCapture(rejected, deepLink, "approved", account, now), /did not match/);
});

test("OS callback launch that locks Wallet is recorded as emitted, without claiming callback receipt", async () => {
  const { DesktopKeyLifecycle } = await import("../src/key-lifecycle.mjs");
  const life = new DesktopKeyLifecycle({ authorizer: { available: () => true, authenticate: async () => {}, method: "explicit-test-fixture" } });
  life.setFocused(true); await life.unlock();
  const { controller, state } = controllerFixture();
  life.subscribe(status => { if (status.locked) controller.cancel(); });
  controller.openExternal = url => life.current().deliver(async () => { state.opened.push(url); life.setFocused(false); });
  const review = await controller.receive(deepLink);
  const result = await life.run(() => controller.act(boundAction(review, "approve")));
  assert.equal(result.callbackEmitted, true); assert.equal(result.callbackReceivedProved, false);
  assert.equal(result.productSessionCreated, false); assert.equal(state.opened.length, 1); assert.equal(controller.pending, null);
});

test("lock during a pending authorization signer cannot launch a stale callback", async () => {
  const { controller, state } = controllerFixture();
  let finish, entered; const ready = new Promise(resolve => { entered = resolve; });
  const original = controller.authority.approveCanonicalAuthorization;
  controller.authority.approveCanonicalAuthorization = async (...args) => { const callback = await original(...args); entered(); await new Promise(resolve => { finish = resolve; }); return callback; };
  const review = await controller.receive(deepLink), pending = controller.act(boundAction(review, "approve"));
  await ready; controller.cancel(); finish();
  await assert.rejects(pending, { code: "WALLET_OPERATION_CANCELLED" }); assert.equal(state.opened.length, 0);
});
