import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmodSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyClientRetirementToGatewaySnapshot,
  assertClientReturnTargetActive,
  canonicalJSON,
  CanonicalWalletGatewayHttpKernel,
  centralProtocolEntry,
  createGatewayChallenge,
  createProductSessionProof,
  gatewayStateDigest,
  httpBodyDigest,
  parseAuthorizationRequest,
  parseCentralRegistryDocument,
  signAuthorization,
  signGatewayChallenge,
  WalletAuthError,
} from "../src/index.js";
import { retireGatewayClientState, verifyGatewayStateBackup } from "../src/gateway-backup.js";
import { CanonicalWalletGatewayNodeHost } from "../src/gateway-node-host.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const RETIRED_AT = new Date("2026-07-15T12:01:00.000Z");
const AFTER_RETIREMENT = new Date("2026-07-15T12:02:00.000Z");
const SHOP_ORIGIN = "https://shop.ynxweb4.com";

test("registry v5 makes Shop Android retirement exact, typed, and impossible to activate partially", () => {
  const registry = retiredShopRegistry();
  const parsed = parseCentralRegistryDocument(registry);
  const shop = parsed.products.find((product) => product.productId === "shop");
  assert.equal(shop.clientLifecycle.status, "retired");
  assert.equal(shop.enabled, false);
  assert.throws(() => centralProtocolEntry(shop), retired("shop-android"));
  const record = {
    clientId: shop.clientLifecycle.clientId,
    productId: shop.productId,
    requestingProduct: shop.requestingProduct,
    productClientId: shop.productClientId,
    bundleId: shop.bundleId,
    replacementURL: shop.clientLifecycle.replacementURL,
    minimumClientVersion: shop.clientLifecycle.minimumClientVersion,
    lastSupportedVersion: shop.clientLifecycle.lastSupportedVersion,
    retiredAt: shop.clientLifecycle.retiredAt,
    disabledCallbacks: shop.clientLifecycle.disabledCallbacks,
    disabledAppLinks: shop.clientLifecycle.disabledAppLinks,
  };
  assert.throws(() => assertClientReturnTargetActive("ynxshop://wallet-auth/callback", [record]), retired("shop-android"));
  assert.throws(() => assertClientReturnTargetActive("ynxshop://orders/order-test", [record]), retired("shop-android"));
  assert.equal(assertClientReturnTargetActive("https://shop.ynxweb4.com/shop/", [record]), "https://shop.ynxweb4.com/shop/");
  for (const unsafe of ["http://shop.ynxweb4.com/shop/", "javascript:alert(1)", "file:///tmp/shop"]) {
    assert.throws(() => assertClientReturnTargetActive(unsafe, [record]), code("INVALID_CALLBACK"));
  }

  const missingCallback = structuredClone(registry);
  missingCallback.products.find((product) => product.productId === "shop").clientLifecycle.disabledCallbacks = [];
  assert.throws(() => parseCentralRegistryDocument(missingCallback), code("INVALID_REGISTRY"));
  const activeMismatch = structuredClone(registry);
  activeMismatch.products.find((product) => product.productId === "shop").reviewState = "disabled";
  assert.throws(() => parseCentralRegistryDocument(activeMismatch), code("INVALID_REGISTRY"));
});

test("retirement migration atomically tombstones the client and revokes sessions, approvals, and device grants", () => {
  const activeRegistry = activeShopRegistry();
  const completion = shopCompletion(activeRegistry);
  const active = new CanonicalWalletGatewayHttpKernel(activeRegistry);
  const completionBody = canonicalJSON(completion);
  assert.equal(active.dispatch(requestInput("/v1/wallet/sessions/complete", completionBody), NOW).status, 200);
  const session = active.snapshot().sessionStore.sessions[0];

  const migrated = applyClientRetirementToGatewaySnapshot(retiredShopRegistry(), active.snapshot(), "shop", "shop-android", RETIRED_AT);
  assert.equal(migrated.result.changed, true);
  assert.deepEqual(migrated.result.revokedSessionBindings, [session.sessionBinding]);
  assert.deepEqual(migrated.result.revokedApprovalDigests, [session.approvalDigest]);
  assert.deepEqual(migrated.result.revokedDeviceBindings, [session.deviceBinding]);
  assert.equal(migrated.snapshot.sessionStore.retiredClients[0].clientId, "shop-android");
  assert.equal(migrated.snapshot.sessionStore.audit.at(-1).type, "client-retired");

  const repeated = applyClientRetirementToGatewaySnapshot(retiredShopRegistry(), migrated.snapshot, "shop", "shop-android", RETIRED_AT);
  assert.equal(repeated.result.changed, false);
  assert.equal(gatewayStateDigest(repeated.snapshot), gatewayStateDigest(migrated.snapshot));

  const retiredKernel = new CanonicalWalletGatewayHttpKernel(retiredShopRegistry(), migrated.snapshot);
  const before = gatewayStateDigest(retiredKernel.snapshot());
  const introspectionBody = canonicalJSON({ requiredScopes: ["account:read"] });
  const introspection = retiredKernel.dispatch(requestInput(
    "/v1/wallet/sessions/introspect",
    introspectionBody,
    proof(session, "/v1/wallet/sessions/introspect", introspectionBody),
  ), AFTER_RETIREMENT);
  assert.equal(introspection.status, 410);
  assert.equal(decoded(introspection).error.code, "CLIENT_RETIRED");
  assert.equal(decoded(introspection).error.replacementURL, "https://shop.ynxweb4.com/shop/");
  assert.equal(introspection.mutated, false);
  assert.equal(gatewayStateDigest(retiredKernel.snapshot()), before);

  const newCompletion = retiredKernel.dispatch(requestInput("/v1/wallet/sessions/complete", completionBody), AFTER_RETIREMENT);
  assert.equal(newCompletion.status, 410);
  assert.equal(decoded(newCompletion).error.clientId, "shop-android");
  assert.equal(gatewayStateDigest(retiredKernel.snapshot()), before);
});

test("registry v3 separates the supported Shop client before retiring the legacy shared tuple", () => {
  const legacyRegistry = activeShopRegistry();
  const legacyKernel = new CanonicalWalletGatewayHttpKernel(legacyRegistry);
  const legacyCompletion = shopCompletion(legacyRegistry);
  const legacyBody = canonicalJSON(legacyCompletion);
  assert.equal(legacyKernel.dispatch(requestInput("/v1/wallet/sessions/complete", legacyBody), NOW).status, 200);

  const splitRegistry = splitShopRegistry();
  const parsed = parseCentralRegistryDocument(splitRegistry);
  assert.equal(parsed.registryVersion, 3);
  assert.equal(parsed.products.find(product => product.productId === "shop").productClientId, "ynx-shop-supported-v2");
  assert.equal(parsed.retiredClients[0].productClientId, "ynx-shop-v1");
  const migrated = applyClientRetirementToGatewaySnapshot(splitRegistry, legacyKernel.snapshot(), "shop", "shop-android", RETIRED_AT);
  assert.equal(migrated.snapshot.registryVersion, 3);
  assert.equal(migrated.result.revokedSessionBindings.length, 1);
  const kernel = new CanonicalWalletGatewayHttpKernel(splitRegistry, migrated.snapshot);
  assert.equal(kernel.dispatch(requestInput("/v1/wallet/sessions/complete", legacyBody), AFTER_RETIREMENT).status, 410);

  const supportedBody = canonicalJSON(shopCompletion(
    splitRegistry,
    "shop_supported_client_nonce_abcdefghij",
    "shop_supported_challenge_abcdefgh",
  ));
  const supported = kernel.dispatch(requestInput("/v1/wallet/sessions/complete", supportedBody), AFTER_RETIREMENT);
  assert.equal(supported.status, 200);
  assert.equal(decoded(supported).result.productClientId, "ynx-shop-supported-v2");

  const unsplitClient = structuredClone(splitRegistry);
  unsplitClient.products.find(product => product.productId === "shop").productClientId = "ynx-shop-v1";
  assert.throws(() => parseCentralRegistryDocument(unsplitClient), code("INVALID_REGISTRY"));
  const unsplitCallback = structuredClone(splitRegistry);
  unsplitCallback.products.find(product => product.productId === "shop").callbacks = ["ynxshop://wallet-auth/callback"];
  assert.throws(() => parseCentralRegistryDocument(unsplitCallback), code("INVALID_REGISTRY"));
});

test("Node host returns correlation-bound CLIENT_RETIRED and never rewrites state for the rejected client", async () => {
  const activeRegistry = activeShopRegistry();
  const active = new CanonicalWalletGatewayHttpKernel(activeRegistry);
  const completionBody = canonicalJSON(shopCompletion(activeRegistry));
  active.dispatch(requestInput("/v1/wallet/sessions/complete", completionBody), NOW);
  const migrated = applyClientRetirementToGatewaySnapshot(retiredShopRegistry(), active.snapshot(), "shop", "shop-android", RETIRED_AT);
  const directory = mkdtempSync(join(tmpdir(), "ynx-client-retirement-"));
  chmodSync(directory, 0o700);
  const statePath = join(directory, "state.json");
  const envelope = canonicalJSON({ schemaVersion: 1, stateDigest: gatewayStateDigest(migrated.snapshot), snapshot: migrated.snapshot });
  writeFileSync(statePath, envelope, { mode: 0o600 });
  const host = new CanonicalWalletGatewayNodeHost(retiredShopRegistry(), { statePath, now: () => AFTER_RETIREMENT });
  const server = createServer(host.handler());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/wallet/sessions/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SHOP_ORIGIN },
      body: completionBody,
    });
    const payload = await response.json();
    assert.equal(response.status, 410);
    assert.equal(payload.error.code, "CLIENT_RETIRED");
    assert.equal(payload.error.clientId, "shop-android");
    assert.equal(payload.error.minimumClientVersion, "web-pwa");
    assert.equal(payload.error.correlationId, response.headers.get("x-request-id"));
    assert.match(payload.error.correlationId, /^[0-9a-f-]{36}$/);
    assert.equal(readFileSync(statePath, "utf8"), envelope);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Node host authenticates a v1 store digest before strictly migrating and rewriting it as v2", () => {
  const fixture = migratableState();
  try {
    const current = JSON.parse(fixture.envelope);
    const legacySessionStore = structuredClone(current.snapshot.sessionStore);
    legacySessionStore.schemaVersion = 1;
    delete legacySessionStore.retiredClients;
    current.snapshot.sessionStore = legacySessionStore;
    current.stateDigest = gatewayStateDigest(current.snapshot);
    writeFileSync(fixture.statePath, canonicalJSON(current), { mode: 0o600 });
    new CanonicalWalletGatewayNodeHost(activeShopRegistry(), { statePath: fixture.statePath, now: () => NOW });
    const rewritten = JSON.parse(readFileSync(fixture.statePath, "utf8"));
    assert.equal(rewritten.snapshot.sessionStore.schemaVersion, 2);
    assert.deepEqual(rewritten.snapshot.sessionStore.retiredClients, []);
    assert.equal(rewritten.stateDigest, gatewayStateDigest(rewritten.snapshot));

    const tampered = structuredClone(current);
    tampered.snapshot.sessionStore.consumedNonces = [];
    writeFileSync(fixture.statePath, canonicalJSON(tampered), { mode: 0o600 });
    assert.throws(() => new CanonicalWalletGatewayNodeHost(activeShopRegistry(), { statePath: fixture.statePath, now: () => NOW }), code("STATE_TAMPERED"));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("operator migration requires an exact state precondition, creates a verified rollback backup, and atomically replaces state", () => {
  const fixture = migratableState();
  try {
    const key = Buffer.alloc(32, 7);
    const wrongDigest = "0".repeat(64);
    assert.throws(() => retireGatewayClientState({
      backupPath: fixture.backupPath,
      clientId: "shop-android",
      expectedStateDigest: wrongDigest,
      key,
      productId: "shop",
      registry: retiredShopRegistry(),
      statePath: fixture.statePath,
      at: RETIRED_AT.toISOString(),
    }), code("STATE_PRECONDITION"));
    assert.equal(readFileSync(fixture.statePath, "utf8"), fixture.envelope);
    assert.equal(existsSync(fixture.backupPath), false);

    const result = retireGatewayClientState({
      backupPath: fixture.backupPath,
      clientId: "shop-android",
      expectedStateDigest: fixture.stateDigest,
      key,
      productId: "shop",
      registry: retiredShopRegistry(),
      statePath: fixture.statePath,
      at: RETIRED_AT.toISOString(),
    });
    assert.equal(result.changed, true);
    assert.equal(result.previousStateDigest, fixture.stateDigest);
    assert.notEqual(result.stateDigest, fixture.stateDigest);
    assert.equal(result.result.revokedSessionBindings.length, 1);
    assert.equal(verifyGatewayStateBackup({ backupPath: fixture.backupPath, key }).sourceStateDigest, fixture.stateDigest);
    const stored = JSON.parse(readFileSync(fixture.statePath, "utf8"));
    assert.equal(stored.stateDigest, result.stateDigest);
    assert.equal(stored.snapshot.sessionStore.retiredClients[0].clientId, "shop-android");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("operator migration refuses mode, hardlink, and symlink tamper with zero state mutation", () => {
  for (const kind of ["mode", "hardlink", "symlink"]) {
    const fixture = migratableState();
    try {
      let protectedPath = fixture.statePath;
      if (kind === "mode") chmodSync(fixture.statePath, 0o644);
      if (kind === "hardlink") linkSync(fixture.statePath, join(fixture.directory, "state-hardlink.json"));
      if (kind === "symlink") {
        protectedPath = join(fixture.directory, "state-real.json");
        writeFileSync(protectedPath, fixture.envelope, { mode: 0o600 });
        rmSync(fixture.statePath);
        symlinkSync(protectedPath, fixture.statePath);
      }
      assert.throws(() => retireGatewayClientState({
        backupPath: fixture.backupPath,
        clientId: "shop-android",
        expectedStateDigest: fixture.stateDigest,
        key: Buffer.alloc(32, 9),
        productId: "shop",
        registry: retiredShopRegistry(),
        statePath: fixture.statePath,
        at: RETIRED_AT.toISOString(),
      }), (error) => error instanceof WalletAuthError && ["BACKUP_PERMISSIONS", "BACKUP_UNAVAILABLE"].includes(error.code));
      assert.equal(readFileSync(protectedPath, "utf8"), fixture.envelope);
      assert.equal(existsSync(fixture.backupPath), false);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("operator CLI emits only canonical retirement evidence and applies the accepted exact state", () => {
  const fixture = migratableState();
  try {
    const registryPath = join(fixture.directory, "registry.json");
    writeFileSync(registryPath, JSON.stringify(splitShopRegistry()), { mode: 0o600 });
    const key = Buffer.alloc(32, 11).toString("base64url");
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/apply-client-retirement.mjs", import.meta.url))], {
      encoding: "utf8",
      env: {
        ...process.env,
        YNX_WALLET_GATEWAY_BACKUP_KEY: key,
        YNX_WALLET_GATEWAY_EXPECT_STATE_DIGEST: fixture.stateDigest,
        YNX_WALLET_GATEWAY_REGISTRY_PATH: registryPath,
        YNX_WALLET_GATEWAY_RETIRE_CLIENT_ID: "shop-android",
        YNX_WALLET_GATEWAY_RETIRE_AT: RETIRED_AT.toISOString(),
        YNX_WALLET_GATEWAY_RETIRE_PRODUCT_ID: "shop",
        YNX_WALLET_GATEWAY_RETIREMENT_BACKUP_PATH: fixture.backupPath,
        YNX_WALLET_GATEWAY_STATE_PATH: fixture.statePath,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(canonicalJSON(payload) + "\n", result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.changed, true);
    assert.equal(payload.result.clientId, "shop-android");
    assert.equal(JSON.parse(readFileSync(fixture.statePath, "utf8")).snapshot.registryVersion, 3);
    assert.equal(Object.values(payload).includes(fixture.statePath), false);
    assert.equal(Object.values(payload).includes(key), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

function activeShopRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  for (const product of registry.products) { product.schemaVersion = 4; product.webOrigins = []; }
  const shop = registry.products.find((product) => product.productId === "shop");
  shop.reviewState = "approved";
  shop.enabled = true;
  shop.webOrigins = [SHOP_ORIGIN];
  return registry;
}

function migratableState() {
  const activeRegistry = activeShopRegistry();
  const active = new CanonicalWalletGatewayHttpKernel(activeRegistry);
  const completionBody = canonicalJSON(shopCompletion(activeRegistry));
  assert.equal(active.dispatch(requestInput("/v1/wallet/sessions/complete", completionBody), NOW).status, 200);
  const snapshot = active.snapshot();
  const stateDigest = gatewayStateDigest(snapshot);
  const envelope = canonicalJSON({ schemaVersion: 1, stateDigest, snapshot });
  const directory = mkdtempSync(join(tmpdir(), "ynx-retirement-migration-"));
  chmodSync(directory, 0o700);
  const statePath = join(directory, "state.json");
  writeFileSync(statePath, envelope, { mode: 0o600 });
  return { backupPath: join(directory, "state.backup"), directory, envelope, stateDigest, statePath };
}

function retiredShopRegistry() {
  const registry = activeShopRegistry();
  const shop = registry.products.find((product) => product.productId === "shop");
  shop.schemaVersion = 5;
  shop.reviewState = "retired";
  shop.enabled = false;
  shop.clientLifecycle = {
    status: "retired",
    clientId: "shop-android",
    replacementURL: "https://shop.ynxweb4.com/shop/",
    minimumClientVersion: "web-pwa",
    lastSupportedVersion: "0.3.0-testnet-preview",
    retiredAt: RETIRED_AT.toISOString(),
    disabledCallbacks: [...shop.callbacks],
    disabledAppLinks: ["ynxshop://orders"],
  };
  return registry;
}

function splitShopRegistry() {
  const registry = activeShopRegistry();
  registry.registryVersion = 3;
  const shop = registry.products.find((product) => product.productId === "shop");
  shop.productClientId = "ynx-shop-supported-v2";
  shop.callbacks = ["ynxshopsupported://wallet-auth/callback"];
  registry.retiredClients = [{
    clientId: "shop-android",
    productId: "shop",
    requestingProduct: "shop",
    productClientId: "ynx-shop-v1",
    bundleId: "com.ynxweb4.shop",
    replacementURL: "https://shop.ynxweb4.com/shop/",
    minimumClientVersion: "web-pwa",
    lastSupportedVersion: "0.3.0-testnet-preview",
    retiredAt: RETIRED_AT.toISOString(),
    disabledCallbacks: ["ynxshop://wallet-auth/callback"],
    disabledAppLinks: ["ynxshop://orders"],
  }];
  return registry;
}

function shopCompletion(registry, nonce = "shop_android_retirement_nonce_abcdefghij", challengeValue = "shop_retirement_challenge_abcdefgh") {
  const shop = registry.products.find((product) => product.productId === "shop");
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce,
    requestingProduct: shop.requestingProduct,
    productClientId: shop.productClientId,
    bundleId: shop.bundleId,
    origin: SHOP_ORIGIN,
    callback: shop.callbacks[0],
    scopes: [...shop.scopes],
    purpose: "Verify Shop Android retirement revokes private authorization without affecting standard connection.",
  }), { now: NOW, registry: { [shop.productClientId]: centralProtocolEntry(shop) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, { challenge: challengeValue, expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function proof(session, path, body) {
  return createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce: "shop_retired_proof_nonce_abcdefghijkl",
    issuedAt: AFTER_RETIREMENT.toISOString(),
    expiresAt: "2026-07-15T12:02:30.000Z",
  }, PRODUCT_DEVICE_SECRET);
}

function requestInput(path, body, productProof = null) {
  return { method: "POST", path, contentType: "application/json", body, proof: productProof, origin: SHOP_ORIGIN };
}

function decoded(response) { return JSON.parse(response.body); }
function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
function retired(clientId) { return (error) => error instanceof WalletAuthError && error.code === "CLIENT_RETIRED" && error.details?.clientId === clientId; }
