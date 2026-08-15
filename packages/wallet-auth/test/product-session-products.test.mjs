import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionRequest, createProductSessionReturnURL, parseProductSessionReturnURL,
  prepareWalletOpen, ProductSessionAuthority, signProductSessionApproval, signProductSessionChallenge,
  walletConnectionChoices, WALLET_ROUTE_STATUS, WalletAuthError,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T01:00:00.000Z");
const token = (label) => createHash("sha256").update(label).digest("base64url");
const platforms = ["web", "macos", "windows", "android", "ios"];

for (const [index, product] of registry.products.entries()) {
  test(`${product.displayName} registry contract covers install, approval, rejection, timeout, revoke, restart, network loss and Retry`, () => {
    const secret = Buffer.alloc(32); secret.writeUInt32BE(index + 21, 28);
    const registeredPlatforms = product.platforms ?? platforms;
    const request = createProductSessionRequest(registry, { productId: product.productId, platform: registeredPlatforms[index % registeredPlatforms.length], deviceId: `matrix-device-${String(index).padStart(3, "0")}`, deviceKey: Buffer.from(p256.getPublicKey(secret, true)).toString("base64url"), scopes: product.scopes, purpose: `Connect ${product.displayName} through the shared Product Session SDK.`, nonce: token(`matrix-nonce-${index}`), state: token(`matrix-state-${index}`) }, NOW);
    const missing = walletConnectionChoices(registry, product.productId, { ynxWalletInstalled: false, metaMaskAvailable: true });
    assert.equal(missing[0].id, "download-ynx-wallet");
    assert.equal(missing.some((item) => item.id === "metamask"), product.evmCompatible);
    assert.equal(walletConnectionChoices(registry, product.productId, { ynxWalletInstalled: true, metaMaskAvailable: true })[0].id, "ynx-wallet");
    assert.equal(prepareWalletOpen(registry, request, { networkAvailable: false, walletInstalled: true, schemeRegistered: true }, NOW).status, WALLET_ROUTE_STATUS.NETWORK_UNAVAILABLE);
    assert.equal(prepareWalletOpen(registry, request, { networkAvailable: true, walletInstalled: true, schemeRegistered: true }, NOW).status, WALLET_ROUTE_STATUS.READY);
    const rejected = createProductSessionReturnURL(registry, request, { result: "rejected", reason: "user_rejected" }, NOW);
    assert.equal(parseProductSessionReturnURL(registry, request, rejected, NOW).status, WALLET_ROUTE_STATUS.USER_REJECTED);
    const approval = signProductSessionApproval(registry, request, { accountSecret: `${(index % 2) + 1}`.padStart(64, "0"), scopes: request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
    const authority = new ProductSessionAuthority(registry);
    const challenge = authority.issueChallenge({ request, approval, challenge: token(`matrix-challenge-${index}`) }, NOW);
    const session = authority.complete({ request, approval, completion: signProductSessionChallenge(challenge, secret.toString("base64url")) }, NOW);
    const context = { chainId: session.chainId, productId: session.productId, clientId: session.clientId, platform: session.platform, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, requiredScopes: session.scopes };
    const restarted = new ProductSessionAuthority(registry, authority.snapshot());
    assert.equal(restarted.introspect(session.sessionBinding, context, NOW).active, true);
    restarted.revokeSession(session.sessionBinding);
    assert.throws(() => new ProductSessionAuthority(registry, restarted.snapshot()).introspect(session.sessionBinding, context, NOW), code("SESSION_REVOKED"));
    assert.throws(() => authority.introspect(session.sessionBinding, context, new Date("2026-08-14T01:06:00.000Z")), code("SESSION_EXPIRED"));
  });
}

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
