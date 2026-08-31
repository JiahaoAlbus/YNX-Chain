import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildStrategyMandateReview } from "./strategyMandateReview";

const NOW = new Date("2026-08-31T02:00:00.000Z");
const ACCOUNT = `ynx1${"q".repeat(38)}`;
const VAULT = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x3333333333333333333333333333333333333333";
const MANDATE_ID = "quant-dex-review-v2";
const PRODUCT = "ynx-quant-v1";

const dexMandate = {
  schemaVersion: 2,
  mandateId: MANDATE_ID,
  account: ACCOUNT,
  productClientId: PRODUCT,
  sessionBinding: "01".repeat(32),
  strategyName: "Bounded testnet rebalance",
  strategyHash: "02".repeat(32),
  strategyVersion: "2.1.0",
  engineCommit: "03".repeat(20),
  engineRelease: "quant-engine-2.1.0-testnet",
  executionKind: "dex-strategy-vault",
  executionAccount: VAULT,
  nonceDomain: `ynx:strategy:${ACCOUNT}:${PRODUCT}:${MANDATE_ID}`,
  allowedVenues: ["ynx-dex"],
  allowedAssets: ["USDC", "YNXT"],
  allowedMarkets: ["YNXT/USDC"],
  allowedMethods: ["0x12345678", "0x87654321", "0xabcdef01"].sort(),
  allowedContracts: [VAULT, POOL, ROUTER],
  allowedTargets: [
    { address: VAULT, role: "vault", methods: ["0x12345678"] },
    { address: POOL, role: "pool", methods: ["0x87654321"] },
    { address: ROUTER, role: "router", methods: ["0xabcdef01"] },
  ],
  maxCapital: 100_000,
  maxPosition: 50_000,
  maxLeverageBps: 10_000,
  maxOrder: 10_000,
  maxSlippageBps: 100,
  maxGas: 500_000,
  maxFrequencyPerHour: 12,
  dailyLossLimit: 5_000,
  drawdownLimit: 10_000,
  noWithdraw: true,
  ownerChangeAllowed: false,
  arbitraryTransferAllowed: false,
  unlimitedApprovalAllowed: false,
  computeDataFee: 100,
  subscriptionFee: 20,
  managementFeeBps: 100,
  performanceFeeBps: 1_000,
  highWaterMark: true,
  lossCarryForward: true,
  killSwitch: "https://gateway.ynxweb4.com/mandates/quant-dex-review-v2/kill",
  revoke: "https://gateway.ynxweb4.com/mandates/quant-dex-review-v2/revoke",
  emergencyExit: "https://gateway.ynxweb4.com/mandates/quant-dex-review-v2/exit",
  userRiskAccepted: true,
  testnetNoValue: true,
  issuedAt: "2026-08-31T01:55:00.000Z",
  expiresAt: "2026-09-01T01:55:00.000Z",
  source: "https://gateway.ynxweb4.com/mandates/quant-dex-review-v2",
  asOf: "2026-08-31T01:55:00.000Z",
  version: "2",
} as const;

function allText(input: ReturnType<typeof buildStrategyMandateReview>): string {
  return input.sections.flatMap(section => [section.title, ...section.rows.flatMap(row => [row.label, row.value])]).join("\n");
}

test("valid DEX review exposes every identity, scope, limit, fee, control, ownership and disclaimer boundary", () => {
  const review = buildStrategyMandateReview(dexMandate, { risk: true, fees: true }, NOW);
  assert.equal(review.valid, true);
  assert.equal(review.canApprove, true);
  assert.equal(review.rejectAlwaysAvailable, true);
  const text = allText(review);
  for (const required of [
    "Mandate", "Wallet account", "Product client", "Product Session binding", "Independent nonce domain", "Source",
    "Strategy", "Quant engine", "Execution boundary", "Allowed venues", "Allowed assets", "Allowed markets", "Allowed methods",
    "Maximum capital", "Maximum position", "Maximum leverage", "Maximum order", "Maximum slippage", "Maximum gas", "Maximum frequency",
    "Daily loss limit", "Drawdown limit", "expires", "PROHIBITED", "Compute / data fee", "Subscription fee", "Management fee",
    "Performance fee", "High-water mark", "Loss carry-forward", "Kill switch", "Revoke", "Emergency exit", "Real profit and loss",
    "Net assets", "Self-managed strategy", "YNX Testnet assets have no real-world value", "DEX Strategy Vault", "Allowed contracts",
    "VAULT", "POOL", "ROUTER", "No transfer / owner / unlimited approval",
  ]) assert.ok(text.includes(required), `missing review disclosure: ${required}`);
});

test("Exchange review is exact-subaccount, no-withdraw and carries no DEX permissions", () => {
  const mandate = {
    ...dexMandate,
    mandateId: "quant-exchange-review-v2",
    executionKind: "exchange-subaccount",
    executionAccount: "subaccount:ynx-test-01",
    nonceDomain: `ynx:strategy:${ACCOUNT}:${PRODUCT}:quant-exchange-review-v2`,
    allowedVenues: ["official-exchange-sandbox"],
    allowedMethods: ["0x12345678"],
    allowedContracts: [],
    allowedTargets: [],
  };
  const review = buildStrategyMandateReview(mandate, { risk: true, fees: true }, NOW);
  const text = allText(review);
  assert.equal(review.valid, true);
  assert.ok(text.includes("Exchange subaccount"));
  assert.ok(text.includes("Subaccount only"));
  assert.ok(text.includes("No-withdraw API Wallet"));
  assert.ok(text.includes("DEX contracts\nNONE"));
  assert.ok(text.includes("Net assets and realized net PnL remain in the user's exact Exchange subaccount"));
});

test("Approve remains disabled until both explicit risk and fee acknowledgements", () => {
  for (const acknowledgements of [
    { risk: false, fees: false },
    { risk: true, fees: false },
    { risk: false, fees: true },
  ]) {
    const review = buildStrategyMandateReview(dexMandate, acknowledgements, NOW);
    assert.equal(review.valid, true);
    assert.equal(review.canApprove, false);
    assert.equal(review.rejectAlwaysAvailable, true);
  }
  assert.equal(buildStrategyMandateReview(dexMandate, { risk: true, fees: true }, NOW).canApprove, true);
});

test("missing, unknown, future, expired and structurally unsafe mandates fail closed", () => {
  const mutations: readonly unknown[] = [
    {},
    { ...dexMandate, unknown: true },
    { ...dexMandate, issuedAt: "2026-08-31T03:00:00.000Z", expiresAt: "2026-09-01T03:00:00.000Z" },
    { ...dexMandate, issuedAt: "2026-08-30T01:00:00.000Z", expiresAt: NOW.toISOString() },
    { ...dexMandate, ownerChangeAllowed: true },
    { ...dexMandate, noWithdraw: false },
    { ...dexMandate, arbitraryTransferAllowed: true },
    { ...dexMandate, unlimitedApprovalAllowed: true },
    { ...dexMandate, testnetNoValue: false },
  ];
  for (const input of mutations) {
    const review = buildStrategyMandateReview(input, { risk: true, fees: true }, NOW);
    assert.equal(review.valid, false);
    assert.equal(review.canApprove, false);
    assert.equal(review.rejectAlwaysAvailable, true);
    assert.equal(review.sections.length, 0);
    assert.ok(review.error);
  }
});

test("dangerous transfer, approval, owner and upgrade selectors never reach review", () => {
  for (const method of ["0x095ea7b3", "0x23b872dd", "0x3659cfe6", "0x715018a6", "0x8f283970", "0xa22cb465", "0xa9059cbb", "0xf2fde38b"]) {
    const review = buildStrategyMandateReview({
      ...dexMandate,
      allowedMethods: [method],
      allowedContracts: [VAULT],
      allowedTargets: [{ address: VAULT, role: "vault", methods: [method] }],
    }, { risk: true, fees: true }, NOW);
    assert.equal(review.valid, false, method);
    assert.equal(review.canApprove, false, method);
  }
});

test("review model is pure and structurally cannot request providers, callbacks, accounts, signatures or network", async () => {
  const review = buildStrategyMandateReview(dexMandate, { risk: true, fees: true }, NOW);
  assert.deepEqual(review.effects, {
    providerRequest: false,
    callback: false,
    signing: false,
    accountAccess: false,
    network: false,
  });
  const source = await readFile(new URL("./strategyMandateReview.ts", import.meta.url), "utf8");
  for (const forbidden of ["eth_requestAccounts", "provider.request", "Linking.openURL", "signAuthorization", "fetch(", "XMLHttpRequest"]) {
    assert.equal(source.includes(forbidden), false, `pure review model must not contain ${forbidden}`);
  }
});
