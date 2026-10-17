import assert from "node:assert/strict";
import { test } from "node:test";
import {
  StrategyMandateStore,
  WalletAuthError,
  strategyMandateDigest,
  walletIdentity,
} from "../src/index.js";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const ACCOUNT = walletIdentity(`${"00".repeat(31)}04`).account;
const VAULT = "0x4444444444444444444444444444444444444444";
const ROUTER = "0x5555555555555555555555555555555555555555";
const MANDATE_ID = "lifecycle-dex-v2";
const NONCE_DOMAIN = `ynx:strategy:${ACCOUNT}:ynx-quant-v1:${MANDATE_ID}`;
const mandate = {
  schemaVersion: 2,
  mandateId: MANDATE_ID,
  account: ACCOUNT,
  productClientId: "ynx-quant-v1",
  sessionBinding: "44".repeat(32),
  strategyName: "Lifecycle bounded DEX strategy",
  strategyHash: "45".repeat(32),
  strategyVersion: "2.0.0",
  engineCommit: "46".repeat(20),
  engineRelease: "quant-lifecycle-2.0.0-testnet",
  executionKind: "dex-strategy-vault",
  executionAccount: VAULT,
  nonceDomain: NONCE_DOMAIN,
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
  killSwitch: "https://gateway.ynxweb4.com/mandates/lifecycle-dex-v2/kill",
  revoke: "https://gateway.ynxweb4.com/mandates/lifecycle-dex-v2/revoke",
  emergencyExit: "https://gateway.ynxweb4.com/mandates/lifecycle-dex-v2/exit",
  userRiskAccepted: true,
  testnetNoValue: true,
  issuedAt: "2026-07-22T11:55:00.000Z",
  expiresAt: "2026-07-23T11:55:00.000Z",
  source: "https://gateway.ynxweb4.com/mandates/lifecycle-dex-v2",
  asOf: "2026-07-22T11:55:00.000Z",
  version: "2",
};

function action(nonce = "lifecycle-action-000001", overrides = {}) {
  return {
    schemaVersion: 1,
    mandateId: MANDATE_ID,
    mandateDigest: strategyMandateDigest(mandate),
    account: ACCOUNT,
    productClientId: "ynx-quant-v1",
    sessionBinding: "44".repeat(32),
    nonceDomain: NONCE_DOMAIN,
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

function code(expected) {
  return error => error instanceof WalletAuthError && error.code === expected;
}

test("mandate activation and action consumption are atomic, auditable and restart-safe", () => {
  const store = new StrategyMandateStore();
  store.activate(mandate, NOW);
  const first = store.authorize(MANDATE_ID, action(), NOW);
  assert.equal(first.authorized, true);
  assert.equal(store.snapshot().audit.length, 2);
  assert.equal(store.snapshot().consumedActionNonces.length, 1);

  assert.throws(() => store.authorize(MANDATE_ID, action(), NOW), code("REPLAY"));
  assert.throws(
    () => store.authorize(MANDATE_ID, action("lifecycle-action-000001", { order: 4000 }), NOW),
    code("REPLAY"),
  );

  const restarted = new StrategyMandateStore(store.snapshot());
  assert.throws(() => restarted.authorize(MANDATE_ID, action(), NOW), code("REPLAY"));
  const second = restarted.authorize(MANDATE_ID, action("lifecycle-action-000002"), NOW);
  assert.equal(second.authorized, true);
  assert.equal(restarted.snapshot().consumedActionDigests.length, 2);
  assert.equal(restarted.snapshot().audit.length, 3);
});

test("revoke is immediate, survives restart and blocks every later strategy action", () => {
  const store = new StrategyMandateStore();
  store.activate(mandate, NOW);
  const digest = store.revoke(MANDATE_ID, new Date("2026-07-22T12:00:01.000Z"));
  assert.equal(digest, strategyMandateDigest(mandate));
  assert.equal(store.inventory(ACCOUNT, NOW)[0].status, "revoked");
  assert.throws(() => store.authorize(MANDATE_ID, action(), NOW), code("MANDATE_REVOKED"));

  const restarted = new StrategyMandateStore(store.snapshot());
  assert.equal(restarted.inventory(ACCOUNT, NOW)[0].status, "revoked");
  assert.throws(() => restarted.authorize(MANDATE_ID, action(), NOW), code("MANDATE_REVOKED"));
  assert.throws(() => restarted.emergencyExit(MANDATE_ID, "Cannot exit a revoked mandate", NOW), code("MANDATE_REVOKED"));
});

test("kill switch blocks execution and permits a separately audited emergency exit", () => {
  const store = new StrategyMandateStore();
  store.activate(mandate, NOW);
  store.kill(MANDATE_ID, new Date("2026-07-22T12:00:01.000Z"));
  assert.equal(store.inventory(ACCOUNT, NOW)[0].status, "killed");
  assert.throws(() => store.authorize(MANDATE_ID, action(), NOW), code("MANDATE_KILLED"));

  const exit = store.emergencyExit(MANDATE_ID, "Close approved positions through the bounded vault exit path", new Date("2026-07-22T12:00:02.000Z"));
  assert.equal(exit.reason, "Close approved positions through the bounded vault exit path");
  assert.equal(store.inventory(ACCOUNT, NOW)[0].status, "emergency-exit");
  assert.throws(() => store.authorize(MANDATE_ID, action(), NOW), code("MANDATE_EXITED"));

  const restarted = new StrategyMandateStore(store.snapshot());
  assert.equal(restarted.inventory(ACCOUNT, NOW)[0].status, "emergency-exit");
  assert.throws(() => restarted.emergencyExit(MANDATE_ID, "Repeated exit", NOW), code("ALREADY_EXITED"));
});

test("expired mandates cannot activate or execute even when an action timestamp was previously valid", () => {
  const store = new StrategyMandateStore();
  assert.throws(
    () => store.activate(mandate, new Date("2026-07-23T11:55:00.000Z")),
    code("INACTIVE_MANDATE"),
  );
  store.activate(mandate, NOW);
  assert.throws(
    () => store.authorize(MANDATE_ID, action("lifecycle-action-000003", { at: "2026-07-23T11:54:59.000Z" }), new Date("2026-07-23T11:55:00.000Z")),
    code("INACTIVE_MANDATE"),
  );
  assert.equal(store.inventory(ACCOUNT, new Date("2026-07-23T11:55:00.000Z"))[0].status, "expired");
});

test("storage unknown fields, replay divergence and audit tamper fail closed", () => {
  const store = new StrategyMandateStore();
  store.activate(mandate, NOW);
  store.authorize(MANDATE_ID, action(), NOW);
  const snapshot = JSON.parse(JSON.stringify(store.snapshot()));

  assert.throws(() => new StrategyMandateStore({ ...snapshot, extra: true }), code("UNKNOWN_OR_MISSING_FIELD"));
  assert.throws(
    () => new StrategyMandateStore({ ...snapshot, consumedActionDigests: [] }),
    code("INVALID_STORE"),
  );
  const auditTamper = JSON.parse(JSON.stringify(snapshot));
  auditTamper.audit[1].type = "strategy-action-denied";
  assert.throws(() => new StrategyMandateStore(auditTamper), code("INVALID_STORE"));
  const unknownMandate = JSON.parse(JSON.stringify(snapshot));
  unknownMandate.revokedMandateDigests = ["ff".repeat(32)];
  assert.throws(() => new StrategyMandateStore(unknownMandate), code("INVALID_STORE"));

  const contradictory = JSON.parse(JSON.stringify(snapshot));
  contradictory.revokedMandateDigests = [strategyMandateDigest(mandate)];
  contradictory.killedMandateDigests = [strategyMandateDigest(mandate)];
  assert.throws(() => new StrategyMandateStore(contradictory), code("INVALID_STORE"));
});
