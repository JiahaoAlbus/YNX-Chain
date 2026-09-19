import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CanonicalWalletGatewayAdapter,
  createGatewayChallenge,
  createProductSessionProof,
  httpBodyDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
  strategyMandateDigest,
  WalletAuthError,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_KEY, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const VAULT = "0x6666666666666666666666666666666666666666";
const ROUTER = "0x7777777777777777777777777777777777777777";
const QUANT_BINDING = Object.freeze({
  requestingProduct: "quant",
  bundleId: "com.ynxweb4.quant",
  origins: Object.freeze(["https://quant.ynxweb4.com"]),
  callbacks: Object.freeze(["ynxquant://wallet-auth/callback"]),
  scopes: Object.freeze(["quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke"]),
  maxScopes: 4,
});
const QUANT_REGISTRY = Object.freeze({ "ynx-quant-v1": QUANT_BINDING });

function approvedRegistry() {
  const value = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  for (const product of value.products) { product.schemaVersion = 4; product.webOrigins = []; }
  const quant = value.products.find(product => product.productId === "quant");
  quant.reviewState = "approved";
  quant.enabled = true;
  quant.webOrigins = ["https://quant.ynxweb4.com"];
  return value;
}

function completion(overrides = {}) {
  const scopes = overrides.scopes ?? [...QUANT_BINDING.scopes];
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce: overrides.nonce ?? "quant_nonce_abcdefghijklmnopqrstuvwxyz12",
    requestingProduct: "quant",
    productClientId: "ynx-quant-v1",
    bundleId: "com.ynxweb4.quant",
    origin: QUANT_BINDING.origins[0],
    productDeviceKey: PRODUCT_DEVICE_KEY,
    callback: "ynxquant://wallet-auth/callback",
    scopes,
    purpose: "Authorize a bounded and revocable YNX Quant strategy mandate on this device.",
  }), { now: NOW, registry: QUANT_REGISTRY });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, {
    challenge: overrides.challenge ?? "quant_gateway_challenge_abcdefghijklmnop",
    expiresAt: "2026-07-15T12:02:00.000Z",
  }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function mandate(session, overrides = {}) {
  const mandateId = overrides.mandateId ?? "gateway-dex-v2";
  return {
    schemaVersion: 2,
    mandateId,
    account: session.account,
    productClientId: session.productClientId,
    sessionBinding: session.sessionBinding,
    strategyName: "Gateway-bound DEX strategy",
    strategyHash: "61".repeat(32),
    strategyVersion: "2.0.0",
    engineCommit: "62".repeat(20),
    engineRelease: "quant-gateway-2.0.0-testnet",
    executionKind: "dex-strategy-vault",
    executionAccount: VAULT,
    nonceDomain: `ynx:strategy:${session.account}:${session.productClientId}:${mandateId}`,
    allowedVenues: ["ynx-dex"],
    allowedAssets: ["USDC", "YNXT"],
    allowedMarkets: ["YNXT/USDC"],
    allowedMethods: ["0x12345678", "0x87654321"],
    allowedContracts: [VAULT, ROUTER],
    allowedTargets: [
      { address: VAULT, role: "vault", methods: ["0x12345678"] },
      { address: ROUTER, role: "router", methods: ["0x87654321"] },
    ],
    maxCapital: 100000,
    maxPosition: 50000,
    maxLeverageBps: 10000,
    maxOrder: 10000,
    maxSlippageBps: 100,
    maxGas: 500000,
    maxFrequencyPerHour: 12,
    dailyLossLimit: 5000,
    drawdownLimit: 10000,
    noWithdraw: true,
    ownerChangeAllowed: false,
    arbitraryTransferAllowed: false,
    unlimitedApprovalAllowed: false,
    computeDataFee: 100,
    subscriptionFee: 0,
    managementFeeBps: 0,
    performanceFeeBps: 0,
    highWaterMark: true,
    lossCarryForward: true,
    killSwitch: `https://gateway.ynxweb4.com/mandates/${mandateId}/kill`,
    revoke: `https://gateway.ynxweb4.com/mandates/${mandateId}/revoke`,
    emergencyExit: `https://gateway.ynxweb4.com/mandates/${mandateId}/exit`,
    userRiskAccepted: true,
    testnetNoValue: true,
    issuedAt: "2026-07-15T11:59:59.000Z",
    expiresAt: "2026-07-15T12:02:00.000Z",
    source: `https://gateway.ynxweb4.com/mandates/${mandateId}`,
    asOf: "2026-07-15T11:59:59.000Z",
    version: "2",
    ...overrides,
  };
}

function action(mandateValue, nonce = "gateway-action-000001", overrides = {}) {
  return {
    schemaVersion: 1,
    mandateId: mandateValue.mandateId,
    mandateDigest: strategyMandateDigest(mandateValue),
    account: mandateValue.account,
    productClientId: mandateValue.productClientId,
    sessionBinding: mandateValue.sessionBinding,
    nonceDomain: mandateValue.nonceDomain,
    nonce,
    venue: "ynx-dex",
    asset: "YNXT",
    market: "YNXT/USDC",
    target: VAULT,
    method: "0x12345678",
    capital: 80000,
    position: 40000,
    leverageBps: 10000,
    order: 5000,
    slippageBps: 80,
    gas: 300000,
    executionsInCurrentHour: 3,
    dailyLoss: 100,
    drawdown: 200,
    at: NOW.toISOString(),
    ...overrides,
  };
}

function proof(session, path, body, nonce) {
  const canonicalNonce = nonce.length < 32 ? nonce.padEnd(32, "0") : nonce;
  assert.match(canonicalNonce, /^[A-Za-z0-9_-]{32,64}$/);
  return createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce: canonicalNonce,
    issuedAt: NOW.toISOString(),
    expiresAt: "2026-07-15T12:00:30.000Z",
  }, PRODUCT_DEVICE_SECRET);
}

function context(path, body) {
  return { method: "POST", path, bodyDigest: httpBodyDigest(body), origin: QUANT_BINDING.origins[0] };
}

function code(expected) {
  return error => error instanceof WalletAuthError && error.code === expected;
}

test("Quant Product Session creates and executes only its exact Gateway-bound mandate", () => {
  const gateway = new CanonicalWalletGatewayAdapter(approvedRegistry());
  const session = gateway.complete(completion(), NOW);
  const mandateValue = mandate(session);
  const activatePath = "/v1/wallet/mandates/activate";
  const activateBody = JSON.stringify({ mandate: mandateValue });
  const activateProof = proof(session, activatePath, activateBody, "gateway_activate_abcdefghijklmnop");
  const activated = gateway.activateMandate({ proof: activateProof, mandate: mandateValue }, context(activatePath, activateBody), NOW);
  assert.equal(activated.sessionBinding, session.sessionBinding);

  const actionValue = action(mandateValue);
  const executePath = "/v1/wallet/mandates/authorize-action";
  const executeBody = JSON.stringify({ mandateId: mandateValue.mandateId, action: actionValue });
  const executeProof = proof(session, executePath, executeBody, "gateway_execute_abcdefghijklmnop");
  const authorized = gateway.authorizeMandateAction({ proof: executeProof, mandateId: mandateValue.mandateId, action: actionValue }, context(executePath, executeBody), NOW);
  assert.equal(authorized.authorized, true);
  assert.equal(gateway.snapshot().mandateStore.consumedActionNonces.length, 1);
  assert.throws(
    () => gateway.authorizeMandateAction({ proof: executeProof, mandateId: mandateValue.mandateId, action: actionValue }, context(executePath, executeBody), NOW),
    code("REPLAY"),
  );
});

test("Gateway rejects missing scope, wrong body digest and cross-session mandate substitution", () => {
  const registry = approvedRegistry();
  const limitedGateway = new CanonicalWalletGatewayAdapter(registry);
  const limited = limitedGateway.complete(completion({ scopes: ["quant:account"] }), NOW);
  const limitedMandate = mandate(limited);
  const path = "/v1/wallet/mandates/activate";
  const body = JSON.stringify({ mandate: limitedMandate });
  const limitedProof = proof(limited, path, body, "gateway_limited_abcdefghijklmnop");
  assert.throws(
    () => limitedGateway.activateMandate({ proof: limitedProof, mandate: limitedMandate }, context(path, body), NOW),
    code("SCOPE_NOT_ALLOWED"),
  );

  const gateway = new CanonicalWalletGatewayAdapter(registry);
  const first = gateway.complete(completion(), NOW);
  const mandateValue = mandate(first);
  const activateProof = proof(first, path, bodyForMandate(mandateValue), "gateway_binding_abcdefghijklmnop");
  assert.throws(
    () => gateway.activateMandate({ proof: activateProof, mandate: mandateValue }, { ...context(path, bodyForMandate(mandateValue)), bodyDigest: httpBodyDigest("tampered") }, NOW),
    code("HTTP_BINDING_MISMATCH"),
  );
  gateway.activateMandate({ proof: activateProof, mandate: mandateValue }, context(path, bodyForMandate(mandateValue)), NOW);

  const second = gateway.complete(completion({
    nonce: "quant_nonce_second_abcdefghijklmnop",
    challenge: "quant_gateway_second_abcdefghijklmnop",
  }), NOW);
  const actionValue = action(mandateValue, "gateway-action-000002");
  const executePath = "/v1/wallet/mandates/authorize-action";
  const executeBody = JSON.stringify({ mandateId: mandateValue.mandateId, action: actionValue });
  const secondProof = proof(second, executePath, executeBody, "gateway_cross_session_abcdefghijklmnop");
  assert.throws(
    () => gateway.authorizeMandateAction({ proof: secondProof, mandateId: mandateValue.mandateId, action: actionValue }, context(executePath, executeBody), NOW),
    code("MANDATE_BINDING_MISMATCH"),
  );
});

test("Gateway revoke survives restart and inventory exposes terminal state without granting asset authority", () => {
  const registry = approvedRegistry();
  const gateway = new CanonicalWalletGatewayAdapter(registry);
  const session = gateway.complete(completion(), NOW);
  const mandateValue = mandate(session, { mandateId: "gateway-revoke-v2" });
  activate(gateway, session, mandateValue, "gateway_revoke_activate_abcdefghijkl");

  const revokePath = "/v1/wallet/mandates/revoke";
  const revokeBody = JSON.stringify({ mandateId: mandateValue.mandateId });
  gateway.revokeMandate({ proof: proof(session, revokePath, revokeBody, "gateway_revoke_abcdefghijklmnop"), mandateId: mandateValue.mandateId }, context(revokePath, revokeBody), NOW);

  const restarted = new CanonicalWalletGatewayAdapter(registry, gateway.snapshot());
  const inventoryPath = "/v1/wallet/mandates";
  const inventoryBody = "{}";
  const inventory = restarted.mandateInventory({ proof: proof(session, inventoryPath, inventoryBody, "gateway_inventory_abcdefghijklmnop") }, context(inventoryPath, inventoryBody), NOW);
  assert.equal(inventory[0].status, "revoked");

  const actionValue = action(mandateValue, "gateway-action-000003");
  const executePath = "/v1/wallet/mandates/authorize-action";
  const executeBody = JSON.stringify({ mandateId: mandateValue.mandateId, action: actionValue });
  assert.throws(
    () => restarted.authorizeMandateAction({ proof: proof(session, executePath, executeBody, "gateway_after_revoke_abcdefghijkl"), mandateId: mandateValue.mandateId, action: actionValue }, context(executePath, executeBody), NOW),
    code("MANDATE_REVOKED"),
  );
});

test("Gateway kill switch and emergency exit remain separate audited controls", () => {
  const gateway = new CanonicalWalletGatewayAdapter(approvedRegistry());
  const session = gateway.complete(completion(), NOW);
  const mandateValue = mandate(session, { mandateId: "gateway-exit-v2" });
  activate(gateway, session, mandateValue, "gateway_exit_activate_abcdefghijklmn");

  const killPath = "/v1/wallet/mandates/kill";
  const killBody = JSON.stringify({ mandateId: mandateValue.mandateId });
  gateway.killMandate({ proof: proof(session, killPath, killBody, "gateway_kill_abcdefghijklmnopqr"), mandateId: mandateValue.mandateId }, context(killPath, killBody), NOW);

  const exitPath = "/v1/wallet/mandates/emergency-exit";
  const reason = "Close approved positions through the bounded vault exit path";
  const exitBody = JSON.stringify({ mandateId: mandateValue.mandateId, reason });
  gateway.emergencyExitMandate({ proof: proof(session, exitPath, exitBody, "gateway_exit_abcdefghijklmnopqr"), mandateId: mandateValue.mandateId, reason }, context(exitPath, exitBody), NOW);
  assert.equal(gateway.snapshot().mandateStore.emergencyExits.length, 1);
  assert.equal(gateway.snapshot().mandateStore.audit.at(-1).type, "mandate-emergency-exit");
});

test("failed duplicate mandate activation does not consume a fresh Product Session proof", () => {
  const gateway = new CanonicalWalletGatewayAdapter(approvedRegistry());
  const session = gateway.complete(completion(), NOW);
  const mandateValue = mandate(session, { mandateId: "gateway-atomic-v2" });
  const path = "/v1/wallet/mandates/activate";
  const body = bodyForMandate(mandateValue);
  gateway.activateMandate({ proof: proof(session, path, body, "gateway_atomic_first_abcdefghijkl"), mandate: mandateValue }, context(path, body), NOW);
  const before = gateway.snapshot().consumedProductProofs.length;
  const duplicateProof = proof(session, path, body, "gateway_atomic_second_abcdefghijklm");
  assert.throws(
    () => gateway.activateMandate({ proof: duplicateProof, mandate: mandateValue }, context(path, body), NOW),
    code("MANDATE_EXISTS"),
  );
  assert.equal(gateway.snapshot().consumedProductProofs.length, before);
});

test("Gateway snapshot v1 and registry v1 migrate explicitly to adapter v2 and registry v2", () => {
  const registry = approvedRegistry();
  const gateway = new CanonicalWalletGatewayAdapter(registry);
  const current = gateway.snapshot();
  const legacy = {
    schemaVersion: 1,
    registryVersion: 1,
    sessionStore: current.sessionStore,
    consumedProductProofs: current.consumedProductProofs,
  };
  const migrated = new CanonicalWalletGatewayAdapter(registry, legacy).snapshot();
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.registryVersion, 2);
  assert.equal(migrated.mandateStore.mandates.length, 0);
});

function bodyForMandate(value) {
  return JSON.stringify({ mandate: value });
}

function activate(gateway, session, mandateValue, nonce) {
  const path = "/v1/wallet/mandates/activate";
  const body = bodyForMandate(mandateValue);
  return gateway.activateMandate({ proof: proof(session, path, body, nonce), mandate: mandateValue }, context(path, body), NOW);
}
