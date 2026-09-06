import { writeFileSync } from "node:fs";
import {
  authorizeStrategyAction,
  strategyActionNonceKey,
  strategyMandateDigest,
  WalletAuthError,
} from "../src/index.js";

const at = new Date("2026-07-15T12:00:00.000Z");
const account = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80";
const vault = "0x8888888888888888888888888888888888888888";
const router = "0x9999999999999999999999999999999999999999";
const mandateId = "shared-dex-vector-v2";
const nonceDomain = `ynx:strategy:${account}:ynx-quant-v1:${mandateId}`;

const mandate = {
  schemaVersion: 2,
  mandateId,
  account,
  productClientId: "ynx-quant-v1",
  sessionBinding: "71".repeat(32),
  strategyName: "Shared bounded DEX vector",
  strategyHash: "72".repeat(32),
  strategyVersion: "2.0.0",
  engineCommit: "73".repeat(20),
  engineRelease: "quant-shared-vector-2.0.0-testnet",
  executionKind: "dex-strategy-vault",
  executionAccount: vault,
  nonceDomain,
  allowedVenues: ["ynx-dex"],
  allowedAssets: ["USDC", "YNXT"],
  allowedMarkets: ["YNXT/USDC"],
  allowedMethods: ["0x12345678", "0x87654321"],
  allowedContracts: [vault, router],
  allowedTargets: [
    { address: vault, role: "vault", methods: ["0x12345678"] },
    { address: router, role: "router", methods: ["0x87654321"] },
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
  killSwitch: "https://gateway.ynxweb4.com/mandates/shared-dex-vector-v2/kill",
  revoke: "https://gateway.ynxweb4.com/mandates/shared-dex-vector-v2/revoke",
  emergencyExit: "https://gateway.ynxweb4.com/mandates/shared-dex-vector-v2/exit",
  userRiskAccepted: true,
  testnetNoValue: true,
  issuedAt: "2026-07-15T11:59:00.000Z",
  expiresAt: "2026-07-15T12:03:00.000Z",
  source: "https://gateway.ynxweb4.com/mandates/shared-dex-vector-v2",
  asOf: "2026-07-15T11:59:00.000Z",
  version: "2",
};

const mandateDigest = strategyMandateDigest(mandate);
const action = {
  schemaVersion: 1,
  mandateId,
  mandateDigest,
  account,
  productClientId: "ynx-quant-v1",
  sessionBinding: mandate.sessionBinding,
  nonceDomain,
  nonce: "shared-strategy-action-00000001",
  venue: "ynx-dex",
  asset: "YNXT",
  market: "YNXT/USDC",
  target: vault,
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
  at: at.toISOString(),
};
const authorization = authorizeStrategyAction(mandate, action, at);

const negativeCases = [
  { name: "scope-widening-asset", target: "action", patch: { asset: "BTC" }, expectedCode: "SCOPE_EXPANSION" },
  { name: "wrong-dex-target-method", target: "action", patch: { target: router }, expectedCode: "WRONG_DEX_TARGET" },
  { name: "order-limit-exceeded", target: "action", patch: { order: 10001 }, expectedCode: "LIMIT_EXCEEDED" },
  { name: "nonce-domain-substitution", target: "action", patch: { nonceDomain: `${nonceDomain}:other` }, expectedCode: "MANDATE_BINDING_MISMATCH" },
  { name: "future-action", target: "action", patch: { at: "2026-07-15T12:00:31.000Z" }, expectedCode: "FUTURE_ACTION" },
  { name: "owner-change-capability", target: "mandate", patch: { ownerChangeAllowed: true }, expectedCode: "UNSAFE_MANDATE" },
  {
    name: "dangerous-transfer-method",
    target: "mandate",
    patch: {
      allowedMethods: ["0xa9059cbb"],
      allowedContracts: [vault],
      allowedTargets: [{ address: vault, role: "vault", methods: ["0xa9059cbb"] }],
    },
    expectedCode: "PROHIBITED_METHOD",
  },
  { name: "unknown-mandate-field", target: "mandate", patch: { unexpected: true }, expectedCode: "UNKNOWN_OR_MISSING_FIELD" },
];

for (const negative of negativeCases) {
  const candidateMandate = negative.target === "mandate" ? { ...mandate, ...negative.patch } : mandate;
  const candidateAction = negative.target === "action" ? { ...action, ...negative.patch } : action;
  let actualCode;
  try {
    authorizeStrategyAction(candidateMandate, candidateAction, at);
  } catch (error) {
    if (error instanceof WalletAuthError) actualCode = error.code;
    else throw error;
  }
  if (actualCode !== negative.expectedCode) {
    throw new Error(`${negative.name}: expected ${negative.expectedCode}, received ${actualCode ?? "success"}`);
  }
}

const vector = {
  vectorVersion: 1,
  protocol: {
    strategyMandateSchemaVersion: 2,
    strategyActionSchemaVersion: 1,
    nonceDomain: "ynx:strategy:<account>:<productClientId>:<mandateId>",
    generatedAt: at.toISOString(),
  },
  mandate,
  mandateDigest,
  action,
  authorization,
  actionNonceKey: strategyActionNonceKey(action.nonceDomain, action.nonce),
  negativeCases,
};

const target = new URL("../testdata/strategy-mandate-v2.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(vector, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
console.log(JSON.stringify({ target: target.pathname, mandateDigest, actionDigest: authorization.actionDigest, actionNonceKey: vector.actionNonceKey }));
