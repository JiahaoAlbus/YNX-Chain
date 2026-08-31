import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionReturnURL, encodeProductSessionWalletURL, parseProductSessionWalletURL,
  parseProductSessionApproval, ProductSessionGatewayFetchAdapter, ProductSessionGatewayHttpHandler,
  productPlatformBinding, RecoverableProductSessionClient, signProductSessionApproval,
  PRODUCT_SESSION_CLIENT_STATE, PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2, WalletAuthError,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-15T09:00:00.000Z");
const deviceSecret = Buffer.alloc(32, 23);
const device = {
  id: "wallet-web-companion-device-001", key: Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url"),
  secret: deviceSecret.toString("base64url"), scopes: ["account:read", "wallet:session:request"],
  purpose: "Review a short-lived Product Session for the official YNX Wallet Web companion.",
};
const token = (label) => createHash("sha256").update(label).digest("base64url");
const storage = () => { const values = new Map(); return { securityLevel: "os-protected", async get(key) { return values.get(key) ?? null; }, async set(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, values }; };

function runtime() {
  let challengeIndex = 0;
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token(`web-companion-gateway-${challengeIndex++}`));
  const requests = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url); requests.push({ path: parsed.pathname, body: init.body });
    const response = handler.handle({ requestId: init.headers["x-request-id"], method: init.method, path: parsed.pathname, contentType: init.headers["content-type"], body: init.body, proofHeader: init.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] ?? null, networkAvailable: true }, NOW);
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
  const gateway = new ProductSessionGatewayFetchAdapter({ endpoint: "https://rest.ynxweb4.com", fetch, walletInstalled: async () => true, schemeRegistered: async () => true, timeoutMs: 5_000 });
  let tokenIndex = 0;
  const client = new RecoverableProductSessionClient({ registry, productId: "wallet-web-companion", platform: "web", storage: storage(), gateway, device, tokenFactory: () => token(`web-companion-client-${tokenIndex++}`), clock: () => NOW });
  return { handler, requests, client };
}

test("Web companion runtime binding is Web-only and matches the frozen Central identity and callback", () => {
  const binding = productPlatformBinding(registry, "wallet-web-companion", "web");
  assert.equal(binding.clientId, "ynx-wallet-web-companion-v1");
  assert.equal(binding.applicationId, "web.ynx.wallet.companion");
  assert.equal(binding.origin, "https://www.ynxweb4.com");
  assert.equal(binding.callback, "https://www.ynxweb4.com/dapp/wallet/wallet-auth/callback");
  assert.deepEqual(binding.scopes, ["account:read", "chain:network:add", "chain:network:switch", "wallet:session:request"]);
  assert.throws(() => productPlatformBinding(registry, "wallet-web-companion", "android"), code("INVALID_PLATFORM"));
});

test("Web companion approval completes challenge, Product Session and introspection through the real HTTP handler", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  assert.deepEqual(parseProductSessionWalletURL(registry, encodeProductSessionWalletURL(registry, connecting.request, NOW), NOW), connecting.request);
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const connected = await setup.client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW));
  assert.equal(connected.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(connected.session.clientId, "ynx-wallet-web-companion-v1");
  assert.deepEqual(setup.requests.map((item) => item.path), ["/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect"]);
  assert.equal(setup.handler.snapshot().authority.sessions.length, 1);
});

test("Web companion rejection creates no challenge, session or Gateway mutation", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const returned = createProductSessionReturnURL(registry, connecting.request, { result: "rejected", reason: "user_rejected" }, NOW);
  assert.equal((await setup.client.handleReturn(returned)).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.deepEqual(setup.requests, []);
  assert.equal(setup.handler.snapshot().authority.sessions.length, 0);
  assert.equal(setup.handler.snapshot().audit.length, 0);
});

test("Web companion callback, product, device and scope substitutions fail before session mutation", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const valid = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await setup.client.handleReturn(valid.replace("/wallet-auth/callback", "/wallet-auth/attacker"))).status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.deepEqual(setup.requests, []);
  for (const changed of [{ clientId: "ynx-exchange-v1" }, { deviceKey: Buffer.from(p256.getPublicKey(Buffer.alloc(32, 24), true)).toString("base64url") }, { scopes: ["account:read", "exchange:trade"] }]) {
    assert.throws(() => parseProductSessionApproval(registry, { ...connecting.request, ...changed }, approval, NOW), WalletAuthError);
  }
  assert.equal(setup.handler.snapshot().authority.sessions.length, 0);
  assert.equal(setup.handler.snapshot().audit.length, 0);
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
