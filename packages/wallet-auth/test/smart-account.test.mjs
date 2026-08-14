import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { evaluateSponsorship, parseSponsorshipPolicy, parseUserOperationEnvelope, SponsorshipAuthorizationLedger, userOperationDigest, WalletAuthError, walletIdentity } from "../src/index.js";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const ACCOUNT = walletIdentity(`${"00".repeat(31)}01`).account;
const operation = Object.freeze({
  schemaVersion: 1, chainId: 6423,
  entryPoint: "0x0000000071727de22e5e9d8baf0edac6f37da032",
  sender: "0x1111111111111111111111111111111111111111",
  nonceKey: `0x${"00".repeat(24)}`, nonceSequence: 0,
  calls: [{ target: "0x2222222222222222222222222222222222222222", selector: "0xa9059cbb", value: 0, dataDigest: `${"ab".repeat(32)}` }],
  callGasLimit: 80000, verificationGasLimit: 150000, preVerificationGas: 50000,
  maxFeePerGas: 100, maxPriorityFeePerGas: 2,
  validAfter: "2026-07-22T11:59:00.000Z", validUntil: "2026-07-22T12:04:00.000Z",
});
const policy = Object.freeze({
  schemaVersion: 1, policyId: "first-action-v1", enabled: true, sponsorType: "first-action", productClientId: "ynx-pay-v1",
  paymaster: "0x3333333333333333333333333333333333333333", entryPoint: operation.entryPoint,
  allowedTargets: [operation.calls[0].target], allowedSelectors: [operation.calls[0].selector], maxCalls: 1,
  maxCostPerOperation: 1000, maxCostPerSubjectDay: 2000, maxCostPerSponsorDay: 100000, requiresFirstAction: true,
  validAfter: "2026-07-22T00:00:00.000Z", validUntil: "2026-07-23T00:00:00.000Z",
  provider: "YNX Testnet Product Paymaster", fees: "Sponsor pays network gas; user fee is 0 YNXT for an eligible first action.",
  risk: "Sponsorship may be unavailable or revoked; the operation must fail without changing parameters.",
  revocation: "https://status.ynxweb4.com/paymaster/revocations", source: "https://status.ynxweb4.com/paymaster/policies/first-action-v1",
  asOf: "2026-07-22T11:55:00.000Z", version: "1",
});
const BINDING = Object.freeze({
  productClientId: policy.productClientId,
  sessionBinding: "01".repeat(32),
  account: ACCOUNT,
  productDeviceKey: `02${"03".repeat(32)}`,
  orderedScopes: ["wallet.read", "wallet.user-operation.submit"],
  antiSybilBinding: "02".repeat(32),
});
function request(overrides = {}) { return { schemaVersion: 2, policyId: policy.policyId, sponsorType: policy.sponsorType, productClientId: policy.productClientId, sessionBinding: BINDING.sessionBinding, account: ACCOUNT, productDeviceKey: BINDING.productDeviceKey, orderedScopes: BINDING.orderedScopes, requestNonce: "03".repeat(32), expiresAt: "2026-07-22T12:01:00.000Z", userOperationDigest: userOperationDigest(operation), antiSybilBinding: BINDING.antiSybilBinding, requestedCost: 700, subjectDailyUsed: 0, sponsorDailyUsed: 1000, firstAction: true, source: "https://gateway.ynxweb4.com/sponsorship/requests/req-1", asOf: NOW.toISOString(), version: "2", ...overrides }; }

test("eligible first action is bound to operation, product, paymaster and anti-Sybil budget", () => {
  const result = evaluateSponsorship(operation, request(), policy, BINDING, NOW);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.eligible, true);
  assert.equal(result.approvedCost, 700);
  assert.equal(result.remainingSubjectBudget, 1300);
});

test("property: all cost and daily-budget boundaries fail closed", () => {
  for (let cost = 1; cost <= 2200; cost += 37) {
    const result = evaluateSponsorship(operation, request({ requestedCost: cost }), policy, BINDING, NOW);
    assert.equal(result.eligible, cost <= policy.maxCostPerOperation);
    assert.ok(result.remainingSubjectBudget >= 0);
  }
  assert.equal(evaluateSponsorship(operation, request({ subjectDailyUsed: 1500 }), policy, BINDING, NOW).eligible, false);
  assert.equal(evaluateSponsorship(operation, request({ sponsorDailyUsed: 99500 }), policy, BINDING, NOW).eligible, false);
});

test("fuzz: unknown fields, malformed identities and altered calls are rejected or ineligible", () => {
  const mutations = [
    { ...operation, extra: true },
    { ...operation, chainId: 1 },
    { ...operation, maxPriorityFeePerGas: 101 },
    { ...operation, sender: "0xABC" },
    { ...operation, calls: [{ ...operation.calls[0], selector: "0xdeadbeef" }] },
  ];
  for (const [index, mutation] of mutations.entries()) {
    if (index < 4) assert.throws(() => parseUserOperationEnvelope(mutation), (error) => error instanceof WalletAuthError);
    else assert.deepEqual(evaluateSponsorship(mutation, { ...request(), userOperationDigest: userOperationDigest(mutation) }, policy, BINDING, NOW).reasons, ["selector-not-allowed"]);
  }
});

test("fault: disabled, expired, replay-marked first action and provider binding mismatch never sponsor", () => {
  assert.equal(evaluateSponsorship(operation, request(), { ...policy, enabled: false }, BINDING, NOW).approvedCost, 0);
  assert.equal(evaluateSponsorship(operation, request({ firstAction: false }), policy, BINDING, NOW).approvedCost, 0);
  assert.equal(evaluateSponsorship(operation, request({ productClientId: "ynx-social-v1" }), policy, BINDING, NOW).approvedCost, 0);
  assert.equal(evaluateSponsorship(operation, request(), policy, BINDING, new Date("2026-07-23T00:00:00.000Z")).approvedCost, 0);
});

test("canonical sponsorship authorization rejects wrong account, session, device, product, scope and subject", () => {
  const mutations = [
    ["account-binding-mismatch", { account: walletIdentity(`${"00".repeat(31)}02`).account }],
    ["session-binding-mismatch", { sessionBinding: "04".repeat(32) }],
    ["device-binding-mismatch", { productDeviceKey: `03${"05".repeat(32)}` }],
    ["policy-binding-mismatch", { productClientId: "ynx-social-v1" }],
    ["scope-binding-mismatch", { orderedScopes: [...BINDING.orderedScopes].reverse() }],
    ["anti-sybil-binding-mismatch", { antiSybilBinding: "06".repeat(32) }],
  ];
  for (const [reason, override] of mutations) {
    const result = evaluateSponsorship(operation, request(override), policy, BINDING, NOW);
    assert.equal(result.eligible, false);
    assert.equal(result.approvedCost, 0);
    assert.equal(result.reasons.includes(reason), true);
  }
  assert.throws(() => evaluateSponsorship(operation, request(), policy, undefined, NOW), walletError("INVALID_SPONSOR_BINDING"));
});

test("authorization nonce is consumed exactly once only after an eligible decision", () => {
  const ledger = new SponsorshipAuthorizationLedger();
  const wrongDevice = request({ productDeviceKey: `03${"05".repeat(32)}` });
  assert.equal(ledger.authorize(operation, wrongDevice, policy, BINDING, NOW).eligible, false);
  assert.equal(ledger.size, 0);
  assert.equal(ledger.authorize(operation, request(), policy, BINDING, NOW).eligible, true);
  assert.equal(ledger.size, 1);
  assert.throws(() => ledger.authorize(operation, request(), policy, BINDING, NOW), walletError("SPONSORSHIP_REPLAY"));
  assert.equal(ledger.size, 1);
});

test("authorization ledger and request lifetime enforce exact resource boundaries", () => {
  const ledger = new SponsorshipAuthorizationLedger({ maximumConsumed: 1 });
  assert.equal(ledger.authorize(operation, request(), policy, BINDING, NOW).eligible, true);
  assert.throws(() => ledger.authorize(operation, request({ requestNonce: "07".repeat(32) }), policy, BINDING, NOW), walletError("SPONSORSHIP_LEDGER_FULL"));
  assert.equal(ledger.size, 1);
  assert.equal(evaluateSponsorship(operation, request({ requestNonce: "08".repeat(32), expiresAt: NOW.toISOString() }), policy, BINDING, NOW).eligible, false);
  for (const maximumConsumed of [0, 1_000_001, 1.5]) assert.throws(() => new SponsorshipAuthorizationLedger({ maximumConsumed }), walletError("INVALID_NUMBER"));
});

test("soak: 10,000 deterministic evaluations preserve budget invariants", () => {
  let eligible = 0;
  for (let index = 0; index < 10000; index += 1) {
    const result = evaluateSponsorship(operation, request({ requestedCost: (index % 1200) + 1 }), policy, BINDING, NOW);
    if (result.eligible) eligible += 1;
    assert.equal(result.approvedCost === 0 || result.approvedCost <= policy.maxCostPerOperation, true);
  }
  assert.ok(eligible > 0 && eligible < 10000);
});

test("benchmark: policy parsing and evaluation sustain local release-gate throughput", () => {
  parseSponsorshipPolicy(policy);
  const started = performance.now();
  for (let index = 0; index < 20000; index += 1) evaluateSponsorship(operation, request(), policy, BINDING, NOW);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 10000, `20,000 evaluations took ${elapsed.toFixed(1)} ms`);
});

function walletError(code) { return (error) => error instanceof WalletAuthError && (!code || error.code === code); }
