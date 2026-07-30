import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizeStrategyAction,
  parseCapitalProductReview,
  parseCredentialCandidate,
  parseStrategyAction,
  parseStrategyMandate,
  strategyMandateDigest,
  WalletAuthError,
  walletIdentity,
} from "../src/index.js";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const ACCOUNT = walletIdentity(`${"00".repeat(31)}01`).account;
const VAULT = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";
const MANDATE_ID = "quant-dex-v2";
const NONCE_DOMAIN = `ynx:strategy:${ACCOUNT}:ynx-quant-v1:${MANDATE_ID}`;
const base = {
  schemaVersion: 2,
  mandateId: MANDATE_ID,
  account: ACCOUNT,
  productClientId: "ynx-quant-v1",
  sessionBinding: "01".repeat(32),
  strategyName: "Bounded testnet rebalance",
  strategyHash: "02".repeat(32),
  strategyVersion: "2.0.0",
  engineCommit: "03".repeat(20),
  engineRelease: "quant-2.0.0-testnet",
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
  performanceFeeBps: 1000,
  highWaterMark: true,
  lossCarryForward: true,
  killSwitch: "https://gateway.ynxweb4.com/mandates/quant-dex-v2/kill",
  revoke: "https://gateway.ynxweb4.com/mandates/quant-dex-v2/revoke",
  emergencyExit: "https://gateway.ynxweb4.com/mandates/quant-dex-v2/exit",
  userRiskAccepted: true,
  testnetNoValue: true,
  issuedAt: "2026-07-22T11:55:00.000Z",
  expiresAt: "2026-07-23T11:55:00.000Z",
  source: "https://gateway.ynxweb4.com/mandates/quant-dex-v2",
  asOf: "2026-07-22T11:55:00.000Z",
  version: "2",
};

const action = {
  schemaVersion: 1,
  mandateId: MANDATE_ID,
  mandateDigest: strategyMandateDigest(base),
  account: ACCOUNT,
  productClientId: "ynx-quant-v1",
  sessionBinding: "01".repeat(32),
  nonceDomain: NONCE_DOMAIN,
  nonce: "strategy-action-000001",
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
};

function code(expected) {
  return error => error instanceof WalletAuthError && error.code === expected;
}

test("strategy mandate v2 binds engine, nonce domain, typed DEX targets, limits, fees and exits", () => {
  const parsed = parseStrategyMandate(base);
  assert.equal(strategyMandateDigest(parsed).length, 64);
  assert.equal(parsed.nonceDomain, NONCE_DOMAIN);
  assert.deepEqual(parsed.allowedTargets.map(target => target.role), ["vault", "router"]);
  assert.equal(parsed.noWithdraw, true);
  assert.equal(parsed.performanceFeeBps, 1000);
});

test("strategy action authorizer enforces exact mandate scope and every runtime limit", () => {
  const parsed = parseStrategyAction(action);
  assert.equal(parsed.nonce, "strategy-action-000001");
  const authorized = authorizeStrategyAction(base, parsed, NOW);
  assert.equal(authorized.authorized, true);
  assert.equal(authorized.mandateDigest, action.mandateDigest);
  assert.equal(authorized.actionDigest.length, 64);
});

test("property/fuzz: prohibited asset control, nonce substitution and inconsistent limits fail closed", () => {
  for (const mutation of [
    { noWithdraw: false },
    { ownerChangeAllowed: true },
    { arbitraryTransferAllowed: true },
    { unlimitedApprovalAllowed: true },
    { nonceDomain: `${NONCE_DOMAIN}:other` },
    { maxOrder: 50001 },
    { maxPosition: 100001 },
    { performanceFeeBps: 1000, highWaterMark: false },
    { performanceFeeBps: 1000, lossCarryForward: false },
    { allowedMethods: ["0x095ea7b3"], allowedTargets: [{ address: VAULT, role: "vault", methods: ["0x095ea7b3"] }], allowedContracts: [VAULT] },
    { extra: true },
  ]) assert.throws(() => parseStrategyMandate({ ...base, ...mutation }), error => error instanceof WalletAuthError);
});

test("DEX target, method, contract and union boundaries cannot be widened or reordered", () => {
  assert.throws(
    () => parseStrategyMandate({ ...base, allowedContracts: [ROUTER, VAULT] }),
    error => error instanceof WalletAuthError,
  );
  assert.throws(
    () => parseStrategyMandate({ ...base, allowedTargets: [{ address: ROUTER, role: "router", methods: ["0x87654321"] }] }),
    code("INVALID_EXECUTION_BOUNDARY"),
  );
  assert.throws(
    () => parseStrategyMandate({ ...base, allowedMethods: ["0x12345678"] }),
    code("INVALID_EXECUTION_BOUNDARY"),
  );
  assert.throws(
    () => authorizeStrategyAction(base, { ...action, target: ROUTER }, NOW),
    code("WRONG_DEX_TARGET"),
  );
  assert.throws(
    () => authorizeStrategyAction(base, { ...action, method: "0xabcdef01" }, NOW),
    code("SCOPE_EXPANSION"),
  );
});

test("runtime action substitutions, exceeded limits, future and stale timestamps fail closed", () => {
  const mutations = [
    [{ account: walletIdentity(`${"00".repeat(31)}02`).account }, "MANDATE_BINDING_MISMATCH"],
    [{ productClientId: "ynx-other-v1" }, "MANDATE_BINDING_MISMATCH"],
    [{ sessionBinding: "ff".repeat(32) }, "MANDATE_BINDING_MISMATCH"],
    [{ nonceDomain: `${NONCE_DOMAIN}:other` }, "MANDATE_BINDING_MISMATCH"],
    [{ mandateDigest: "ff".repeat(32) }, "MANDATE_DIGEST_MISMATCH"],
    [{ venue: "other-dex" }, "SCOPE_EXPANSION"],
    [{ asset: "BTC" }, "SCOPE_EXPANSION"],
    [{ market: "BTC/USDC" }, "SCOPE_EXPANSION"],
    [{ capital: 100001 }, "LIMIT_EXCEEDED"],
    [{ position: 50001 }, "LIMIT_EXCEEDED"],
    [{ leverageBps: 10001 }, "LIMIT_EXCEEDED"],
    [{ order: 10001 }, "LIMIT_EXCEEDED"],
    [{ slippageBps: 101 }, "LIMIT_EXCEEDED"],
    [{ gas: 500001 }, "LIMIT_EXCEEDED"],
    [{ executionsInCurrentHour: 12 }, "LIMIT_EXCEEDED"],
    [{ dailyLoss: 5001 }, "LIMIT_EXCEEDED"],
    [{ drawdown: 10001 }, "LIMIT_EXCEEDED"],
    [{ at: "2026-07-22T12:00:31.000Z" }, "FUTURE_ACTION"],
    [{ at: "2026-07-22T11:54:59.000Z" }, "STALE_ACTION"],
  ];
  for (const [mutation, expected] of mutations) {
    assert.throws(() => authorizeStrategyAction(base, { ...action, ...mutation }, NOW), code(expected));
  }
});

test("exchange API wallet is subaccount-only with an independent nonce domain", () => {
  const exchangeId = "quant-exchange-v2";
  const exchange = {
    ...base,
    mandateId: exchangeId,
    executionKind: "exchange-subaccount",
    executionAccount: "subaccount:ynx-test-01",
    nonceDomain: `ynx:strategy:${ACCOUNT}:ynx-quant-v1:${exchangeId}`,
    allowedVenues: ["official-exchange-sandbox"],
    allowedMethods: ["0xabcdef01"],
    allowedContracts: [],
    allowedTargets: [],
  };
  const exchangeAction = {
    ...action,
    mandateId: exchangeId,
    mandateDigest: strategyMandateDigest(exchange),
    nonceDomain: exchange.nonceDomain,
    venue: "official-exchange-sandbox",
    target: exchange.executionAccount,
    method: "0xabcdef01",
  };
  assert.equal(authorizeStrategyAction(exchange, exchangeAction, NOW).authorized, true);
  assert.throws(
    () => parseStrategyMandate({ ...exchange, allowedContracts: [VAULT], allowedTargets: [{ address: VAULT, role: "vault", methods: ["0xabcdef01"] }] }),
    code("INVALID_EXECUTION_BOUNDARY"),
  );
  assert.throws(
    () => authorizeStrategyAction(exchange, { ...exchangeAction, target: "subaccount:withdrawal-enabled" }, NOW),
    code("WRONG_EXECUTION_ACCOUNT"),
  );
});

test("capital review requires provider, contract, yield source, history, fees, exits and non-guarantee", () => {
  const review = {
    schemaVersion: 1,
    productType: "native-staking",
    name: "YNX native staking candidate",
    provider: "YNX testnet protocol",
    contract: "0x3333333333333333333333333333333333333333",
    governance: "https://governance.ynxweb4.com/proposals/staking-v1",
    yieldSource: "Protocol testnet validator issuance less disclosed validator costs.",
    historicalYieldRange: "No production history; Testnet observations are not predictive.",
    nonGuarantee: true,
    fees: "Validator and network costs shown before confirmation.",
    lock: "Testnet epoch lock applies.",
    cooldown: "Exit enters the published queue.",
    slashing: "Validator faults can reduce principal.",
    drawdown: "Token price and protocol losses can cause drawdown.",
    withdrawalDelay: "Queue duration depends on protocol state.",
    reserveRatio: "Not applicable to native staking; displayed as N/A.",
    immediateExit: "https://wallet.ynxweb4.com/capital/native-staking/exit",
    revoke: "https://wallet.ynxweb4.com/capital/native-staking/revoke",
    risk: "No price, principal, yield or exit-time guarantee.",
    source: "https://status.ynxweb4.com/capital/native-staking",
    asOf: NOW.toISOString(),
    version: "1",
  };
  assert.equal(parseCapitalProductReview(review).nonGuarantee, true);
  assert.throws(() => parseCapitalProductReview({ ...review, nonGuarantee: false }), code("MISLEADING_CAPITAL_REVIEW"));
});

test("credential candidate discloses one bounded eligibility result with issuer, expiry, status and audit", () => {
  const candidate = {
    schemaVersion: 1,
    credentialId: "urn:uuid:123e4567-e89b-12d3-a456-426614174000",
    type: "age-eligibility",
    issuer: "https://issuer.test.ynxweb4.com/",
    subjectBinding: "11".repeat(32),
    claim: { kind: "age-eligibility", value: "eligible" },
    issuedAt: "2026-07-22T11:55:00.000Z",
    expiresAt: "2026-07-23T11:55:00.000Z",
    status: { type: "BitstringStatusListEntry", url: "https://issuer.test.ynxweb4.com/status/1", index: 42 },
    proofDigest: "22".repeat(32),
    auditId: "33".repeat(32),
    source: "https://issuer.test.ynxweb4.com/credentials/metadata",
    asOf: "2026-07-22T11:55:00.000Z",
    version: "1",
  };
  assert.equal(parseCredentialCandidate(candidate, NOW).claim.value, "eligible");
  assert.throws(() => parseCredentialCandidate({ ...candidate, rawPassport: "secret" }, NOW), error => error instanceof WalletAuthError);
  assert.throws(() => parseCredentialCandidate({ ...candidate, expiresAt: NOW.toISOString() }, NOW), code("INACTIVE_CREDENTIAL"));
});

test("credential fuzz and soak reject claim widening while bounded candidates remain stable", () => {
  const seed = {
    schemaVersion: 1,
    credentialId: "urn:uuid:123e4567-e89b-12d3-a456-426614174000",
    type: "region-eligibility",
    issuer: "https://issuer.test.ynxweb4.com/",
    subjectBinding: "11".repeat(32),
    claim: { kind: "region-eligibility", value: "eligible" },
    issuedAt: "2026-07-22T11:55:00.000Z",
    expiresAt: "2026-07-23T11:55:00.000Z",
    status: { type: "BitstringStatusListEntry", url: "https://issuer.test.ynxweb4.com/status/1", index: 42 },
    proofDigest: "22".repeat(32),
    auditId: "33".repeat(32),
    source: "https://issuer.test.ynxweb4.com/credentials/metadata",
    asOf: "2026-07-22T11:55:00.000Z",
    version: "1",
  };
  assert.throws(() => parseCredentialCandidate({ ...seed, claim: { kind: "region-eligibility", value: "CN" } }, NOW), error => error instanceof WalletAuthError);
  for (let index = 0; index < 5000; index += 1) {
    assert.equal(parseCredentialCandidate({ ...seed, status: { ...seed.status, index: index % 1000 } }, NOW).type, "region-eligibility");
  }
});
