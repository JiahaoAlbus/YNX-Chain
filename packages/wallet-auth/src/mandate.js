import { exactFields, digestHex, WalletAuthError } from "./canonical.js";

const MANDATE_FIELDS = [
  "schemaVersion", "mandateId", "account", "productClientId", "sessionBinding", "strategyName", "strategyHash",
  "strategyVersion", "engineCommit", "engineRelease", "executionKind", "executionAccount", "allowedVenues",
  "allowedAssets", "allowedMarkets", "allowedMethods", "allowedContracts", "maxCapital", "maxPosition",
  "maxLeverageBps", "maxOrder", "maxSlippageBps", "maxGas", "maxFrequencyPerHour", "dailyLossLimit",
  "drawdownLimit", "noWithdraw", "ownerChangeAllowed", "arbitraryTransferAllowed", "unlimitedApprovalAllowed",
  "computeDataFee", "subscriptionFee", "managementFeeBps", "performanceFeeBps", "highWaterMark",
  "lossCarryForward", "killSwitch", "revoke", "emergencyExit", "userRiskAccepted", "testnetNoValue",
  "issuedAt", "expiresAt", "source", "asOf", "version",
];
const CAPITAL_FIELDS = [
  "schemaVersion", "productType", "name", "provider", "contract", "governance", "yieldSource",
  "historicalYieldRange", "nonGuarantee", "fees", "lock", "cooldown", "slashing", "drawdown",
  "withdrawalDelay", "reserveRatio", "immediateExit", "revoke", "risk", "source", "asOf", "version",
];

export function parseStrategyMandate(input) {
  exactFields(input, MANDATE_FIELDS, "Wallet strategy mandate");
  const mandate = {
    schemaVersion: exact(input.schemaVersion, "schemaVersion", 1), mandateId: id(input.mandateId, "mandateId"),
    account: pattern(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    productClientId: id(input.productClientId, "productClientId"), sessionBinding: digest(input.sessionBinding, "sessionBinding"),
    strategyName: text(input.strategyName, "strategyName", 1, 100), strategyHash: digest(input.strategyHash, "strategyHash"),
    strategyVersion: text(input.strategyVersion, "strategyVersion", 1, 64), engineCommit: pattern(input.engineCommit, "engineCommit", /^[0-9a-f]{40}$/),
    engineRelease: text(input.engineRelease, "engineRelease", 1, 100), executionKind: enumeration(input.executionKind, "executionKind", ["exchange-subaccount", "dex-strategy-vault"]),
    executionAccount: text(input.executionAccount, "executionAccount", 3, 128),
    allowedVenues: list(input.allowedVenues, "allowedVenues", 1, 16, value => id(value, "venue")),
    allowedAssets: list(input.allowedAssets, "allowedAssets", 1, 32, value => pattern(value, "asset", /^[A-Z][A-Z0-9.-]{1,15}$/)),
    allowedMarkets: list(input.allowedMarkets, "allowedMarkets", 1, 64, value => pattern(value, "market", /^[A-Z0-9._:/-]{3,63}$/)),
    allowedMethods: list(input.allowedMethods, "allowedMethods", 1, 32, value => pattern(value, "method", /^0x[0-9a-f]{8}$/)),
    allowedContracts: list(input.allowedContracts, "allowedContracts", 0, 32, value => pattern(value, "contract", /^0x[0-9a-f]{40}$/)),
    maxCapital: positive(input.maxCapital, "maxCapital"), maxPosition: positive(input.maxPosition, "maxPosition"),
    maxLeverageBps: bounded(input.maxLeverageBps, "maxLeverageBps", 10000, 100000), maxOrder: positive(input.maxOrder, "maxOrder"),
    maxSlippageBps: bounded(input.maxSlippageBps, "maxSlippageBps", 0, 5000), maxGas: positive(input.maxGas, "maxGas"),
    maxFrequencyPerHour: bounded(input.maxFrequencyPerHour, "maxFrequencyPerHour", 1, 3600), dailyLossLimit: positive(input.dailyLossLimit, "dailyLossLimit"),
    drawdownLimit: positive(input.drawdownLimit, "drawdownLimit"), noWithdraw: bool(input.noWithdraw, "noWithdraw"),
    ownerChangeAllowed: bool(input.ownerChangeAllowed, "ownerChangeAllowed"), arbitraryTransferAllowed: bool(input.arbitraryTransferAllowed, "arbitraryTransferAllowed"),
    unlimitedApprovalAllowed: bool(input.unlimitedApprovalAllowed, "unlimitedApprovalAllowed"), computeDataFee: nonnegative(input.computeDataFee, "computeDataFee"),
    subscriptionFee: nonnegative(input.subscriptionFee, "subscriptionFee"), managementFeeBps: bounded(input.managementFeeBps, "managementFeeBps", 0, 1000),
    performanceFeeBps: bounded(input.performanceFeeBps, "performanceFeeBps", 0, 3000), highWaterMark: bool(input.highWaterMark, "highWaterMark"),
    lossCarryForward: bool(input.lossCarryForward, "lossCarryForward"), killSwitch: https(input.killSwitch, "killSwitch"), revoke: https(input.revoke, "revoke"),
    emergencyExit: https(input.emergencyExit, "emergencyExit"), userRiskAccepted: bool(input.userRiskAccepted, "userRiskAccepted"),
    testnetNoValue: bool(input.testnetNoValue, "testnetNoValue"), issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt"),
    source: https(input.source, "source"), asOf: time(input.asOf, "asOf"), version: text(input.version, "version", 1, 64),
  };
  if (!mandate.noWithdraw || mandate.ownerChangeAllowed || mandate.arbitraryTransferAllowed || mandate.unlimitedApprovalAllowed) fail("UNSAFE_MANDATE", "Mandate must prohibit withdrawals, owner changes, arbitrary transfers and unlimited approvals");
  if (!mandate.userRiskAccepted || !mandate.testnetNoValue) fail("UNACCEPTED_RISK", "Mandate requires explicit loss and Testnet-no-value acknowledgement");
  if (mandate.maxOrder > mandate.maxPosition || mandate.maxPosition > mandate.maxCapital || mandate.dailyLossLimit > mandate.maxCapital || mandate.drawdownLimit > mandate.maxCapital) fail("INVALID_LIMITS", "Mandate financial limits are inconsistent");
  if (mandate.performanceFeeBps > 0 && (!mandate.highWaterMark || !mandate.lossCarryForward)) fail("INVALID_FEES", "Performance fees require high-water mark and loss carry-forward");
  if (mandate.executionKind === "exchange-subaccount" && mandate.allowedContracts.length !== 0) fail("INVALID_EXECUTION_BOUNDARY", "Exchange subaccounts cannot carry DEX contract permissions");
  if (mandate.executionKind === "dex-strategy-vault" && mandate.allowedContracts.length === 0) fail("INVALID_EXECUTION_BOUNDARY", "DEX mandates require exact contract allowlists");
  if (mandate.expiresAt <= mandate.issuedAt) fail("INVALID_EXPIRY", "Mandate expiry must follow issuance");
  return freeze(mandate, ["allowedVenues", "allowedAssets", "allowedMarkets", "allowedMethods", "allowedContracts"]);
}

export function strategyMandateDigest(input) { return digestHex("YNX_WALLET_STRATEGY_MANDATE_V1", parseStrategyMandate(input)); }

export function parseCapitalProductReview(input) {
  exactFields(input, CAPITAL_FIELDS, "Wallet capital product review");
  const review = {
    schemaVersion: exact(input.schemaVersion, "schemaVersion", 1),
    productType: enumeration(input.productType, "productType", ["native-staking", "liquid-staking-candidate", "withdrawal-queue", "safety-module", "service-security-pool", "dex-lp", "vault", "trading-subaccount", "api-wallet", "portfolio-margin", "stablecoin", "bridge-route", "cross-chain-route", "solver-auction", "protocol-owned-liquidity", "treasury-multisig"]),
    name: text(input.name, "name", 1, 120), provider: text(input.provider, "provider", 1, 120), contract: pattern(input.contract, "contract", /^0x[0-9a-f]{40}$/),
    governance: https(input.governance, "governance"), yieldSource: text(input.yieldSource, "yieldSource", 1, 500),
    historicalYieldRange: text(input.historicalYieldRange, "historicalYieldRange", 1, 200), nonGuarantee: bool(input.nonGuarantee, "nonGuarantee"),
    fees: text(input.fees, "fees", 1, 300), lock: text(input.lock, "lock", 1, 200), cooldown: text(input.cooldown, "cooldown", 1, 200),
    slashing: text(input.slashing, "slashing", 1, 300), drawdown: text(input.drawdown, "drawdown", 1, 300),
    withdrawalDelay: text(input.withdrawalDelay, "withdrawalDelay", 1, 200), reserveRatio: text(input.reserveRatio, "reserveRatio", 1, 200),
    immediateExit: https(input.immediateExit, "immediateExit"), revoke: https(input.revoke, "revoke"), risk: text(input.risk, "risk", 1, 600),
    source: https(input.source, "source"), asOf: time(input.asOf, "asOf"), version: text(input.version, "version", 1, 64),
  };
  if (!review.nonGuarantee) fail("MISLEADING_CAPITAL_REVIEW", "Capital review must explicitly state that yield, price and peg are not guaranteed");
  return Object.freeze(review);
}

function freeze(value, arrays) { const copy = { ...value }; for (const key of arrays) copy[key] = Object.freeze([...copy[key]]); return Object.freeze(copy); }
function list(value, label, min, max, parser) { if (!Array.isArray(value) || value.length < min || value.length > max) fail("INVALID_FIELD", `${label} has an invalid item count`); const parsed = value.map(parser); if (new Set(parsed).size !== parsed.length || [...parsed].sort().join("\n") !== parsed.join("\n")) fail("INVALID_FIELD", `${label} must be unique and sorted`); return Object.freeze(parsed); }
function id(value, label) { return pattern(value, label, /^[a-z][a-z0-9._-]{2,63}$/); }
function digest(value, label) { return pattern(value, label, /^[0-9a-f]{64}$/); }
function pattern(value, label, regex) { const result = text(value, label, 1, 512); if (!regex.test(result)) fail("INVALID_FIELD", `${label} is invalid`); return result; }
function text(value, label, min, max) { if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value) fail("INVALID_FIELD", `${label} is invalid`); return value; }
function time(value, label) { const result = pattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) fail("INVALID_TIME", `${label} is invalid`); return result; }
function https(value, label) { const result = text(value, label, 1, 512); let parsed; try { parsed = new URL(result); } catch { fail("INVALID_URL", `${label} is invalid`); } if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.toString() !== result) fail("INVALID_URL", `${label} must be a canonical HTTPS URL`); return result; }
function bounded(value, label, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail("INVALID_NUMBER", `${label} is outside its allowed range`); return value; }
function exact(value, label, expected) { return bounded(value, label, expected, expected); }
function positive(value, label) { return bounded(value, label, 1, Number.MAX_SAFE_INTEGER); }
function nonnegative(value, label) { return bounded(value, label, 0, Number.MAX_SAFE_INTEGER); }
function bool(value, label) { if (typeof value !== "boolean") fail("INVALID_FIELD", `${label} must be boolean`); return value; }
function enumeration(value, label, values) { if (!values.includes(value)) fail("INVALID_FIELD", `${label} is unsupported`); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
