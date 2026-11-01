import { exactFields, digestHex, WalletAuthError } from "./canonical.js";

export const STRATEGY_MANDATE_SCHEMA_VERSION = 2;
export const STRATEGY_ACTION_SCHEMA_VERSION = 1;

const MANDATE_FIELDS = [
  "schemaVersion", "mandateId", "account", "productClientId", "sessionBinding", "strategyName", "strategyHash",
  "strategyVersion", "engineCommit", "engineRelease", "executionKind", "executionAccount", "nonceDomain",
  "allowedVenues", "allowedAssets", "allowedMarkets", "allowedMethods", "allowedContracts", "allowedTargets",
  "maxCapital", "maxPosition", "maxLeverageBps", "maxOrder", "maxSlippageBps", "maxGas", "maxFrequencyPerHour",
  "dailyLossLimit", "drawdownLimit", "noWithdraw", "ownerChangeAllowed", "arbitraryTransferAllowed",
  "unlimitedApprovalAllowed", "computeDataFee", "subscriptionFee", "managementFeeBps", "performanceFeeBps",
  "highWaterMark", "lossCarryForward", "killSwitch", "revoke", "emergencyExit", "userRiskAccepted",
  "testnetNoValue", "issuedAt", "expiresAt", "source", "asOf", "version",
];
const TARGET_FIELDS = ["address", "role", "methods"];
const ACTION_FIELDS = [
  "schemaVersion", "mandateId", "mandateDigest", "account", "productClientId", "sessionBinding", "nonceDomain", "nonce",
  "venue", "asset", "market", "target", "method", "capital", "position", "leverageBps", "order",
  "slippageBps", "gas", "executionsInCurrentHour", "dailyLoss", "drawdown", "at",
];
const CAPITAL_FIELDS = [
  "schemaVersion", "productType", "name", "provider", "contract", "governance", "yieldSource",
  "historicalYieldRange", "nonGuarantee", "fees", "lock", "cooldown", "slashing", "drawdown",
  "withdrawalDelay", "reserveRatio", "immediateExit", "revoke", "risk", "source", "asOf", "version",
];
const DANGEROUS_METHODS = new Set([
  "0x095ea7b3", // approve(address,uint256)
  "0x23b872dd", // transferFrom(address,address,uint256)
  "0x3659cfe6", // upgradeTo(address)
  "0x715018a6", // renounceOwnership()
  "0x8f283970", // changeAdmin(address)
  "0xa22cb465", // setApprovalForAll(address,bool)
  "0xa9059cbb", // transfer(address,uint256)
  "0xf2fde38b", // transferOwnership(address)
]);

export function parseStrategyMandate(input) {
  exactFields(input, MANDATE_FIELDS, "Wallet strategy mandate");
  const mandate = {
    schemaVersion: exact(input.schemaVersion, "schemaVersion", STRATEGY_MANDATE_SCHEMA_VERSION),
    mandateId: id(input.mandateId, "mandateId"),
    account: pattern(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    productClientId: id(input.productClientId, "productClientId"),
    sessionBinding: digest(input.sessionBinding, "sessionBinding"),
    strategyName: text(input.strategyName, "strategyName", 1, 100),
    strategyHash: digest(input.strategyHash, "strategyHash"),
    strategyVersion: text(input.strategyVersion, "strategyVersion", 1, 64),
    engineCommit: pattern(input.engineCommit, "engineCommit", /^[0-9a-f]{40}$/),
    engineRelease: text(input.engineRelease, "engineRelease", 1, 100),
    executionKind: enumeration(input.executionKind, "executionKind", ["exchange-subaccount", "dex-strategy-vault"]),
    executionAccount: text(input.executionAccount, "executionAccount", 3, 128),
    nonceDomain: pattern(input.nonceDomain, "nonceDomain", /^[a-z0-9][a-z0-9:._-]{15,255}$/),
    allowedVenues: list(input.allowedVenues, "allowedVenues", 1, 16, value => id(value, "venue")),
    allowedAssets: list(input.allowedAssets, "allowedAssets", 1, 32, value => pattern(value, "asset", /^[A-Z][A-Z0-9.-]{1,15}$/)),
    allowedMarkets: list(input.allowedMarkets, "allowedMarkets", 1, 64, value => pattern(value, "market", /^[A-Z0-9._:/-]{3,63}$/)),
    allowedMethods: list(input.allowedMethods, "allowedMethods", 1, 32, value => selector(value, "method")),
    allowedContracts: list(input.allowedContracts, "allowedContracts", 0, 32, value => address(value, "contract")),
    allowedTargets: targetList(input.allowedTargets),
    maxCapital: positive(input.maxCapital, "maxCapital"),
    maxPosition: positive(input.maxPosition, "maxPosition"),
    maxLeverageBps: bounded(input.maxLeverageBps, "maxLeverageBps", 10000, 100000),
    maxOrder: positive(input.maxOrder, "maxOrder"),
    maxSlippageBps: bounded(input.maxSlippageBps, "maxSlippageBps", 0, 5000),
    maxGas: positive(input.maxGas, "maxGas"),
    maxFrequencyPerHour: bounded(input.maxFrequencyPerHour, "maxFrequencyPerHour", 1, 3600),
    dailyLossLimit: positive(input.dailyLossLimit, "dailyLossLimit"),
    drawdownLimit: positive(input.drawdownLimit, "drawdownLimit"),
    noWithdraw: bool(input.noWithdraw, "noWithdraw"),
    ownerChangeAllowed: bool(input.ownerChangeAllowed, "ownerChangeAllowed"),
    arbitraryTransferAllowed: bool(input.arbitraryTransferAllowed, "arbitraryTransferAllowed"),
    unlimitedApprovalAllowed: bool(input.unlimitedApprovalAllowed, "unlimitedApprovalAllowed"),
    computeDataFee: nonnegative(input.computeDataFee, "computeDataFee"),
    subscriptionFee: nonnegative(input.subscriptionFee, "subscriptionFee"),
    managementFeeBps: bounded(input.managementFeeBps, "managementFeeBps", 0, 1000),
    performanceFeeBps: bounded(input.performanceFeeBps, "performanceFeeBps", 0, 3000),
    highWaterMark: bool(input.highWaterMark, "highWaterMark"),
    lossCarryForward: bool(input.lossCarryForward, "lossCarryForward"),
    killSwitch: https(input.killSwitch, "killSwitch"),
    revoke: https(input.revoke, "revoke"),
    emergencyExit: https(input.emergencyExit, "emergencyExit"),
    userRiskAccepted: bool(input.userRiskAccepted, "userRiskAccepted"),
    testnetNoValue: bool(input.testnetNoValue, "testnetNoValue"),
    issuedAt: time(input.issuedAt, "issuedAt"),
    expiresAt: time(input.expiresAt, "expiresAt"),
    source: https(input.source, "source"),
    asOf: time(input.asOf, "asOf"),
    version: text(input.version, "version", 1, 64),
  };

  const expectedNonceDomain = `ynx:strategy:${mandate.account}:${mandate.productClientId}:${mandate.mandateId}`;
  if (mandate.nonceDomain !== expectedNonceDomain) fail("NONCE_DOMAIN_MISMATCH", "Mandate nonce domain must bind account, product and mandate");
  if (!mandate.noWithdraw || mandate.ownerChangeAllowed || mandate.arbitraryTransferAllowed || mandate.unlimitedApprovalAllowed) {
    fail("UNSAFE_MANDATE", "Mandate must prohibit withdrawals, owner changes, arbitrary transfers and unlimited approvals");
  }
  if (!mandate.userRiskAccepted || !mandate.testnetNoValue) fail("UNACCEPTED_RISK", "Mandate requires explicit loss and Testnet-no-value acknowledgement");
  if (mandate.maxOrder > mandate.maxPosition || mandate.maxPosition > mandate.maxCapital || mandate.dailyLossLimit > mandate.maxCapital || mandate.drawdownLimit > mandate.maxCapital) {
    fail("INVALID_LIMITS", "Mandate financial limits are inconsistent");
  }
  if (mandate.performanceFeeBps > 0 && (!mandate.highWaterMark || !mandate.lossCarryForward)) fail("INVALID_FEES", "Performance fees require high-water mark and loss carry-forward");
  if (mandate.expiresAt <= mandate.issuedAt) fail("INVALID_EXPIRY", "Mandate expiry must follow issuance");
  if (mandate.asOf > mandate.issuedAt) fail("INVALID_TIME", "Mandate source timestamp cannot follow issuance");
  if (mandate.allowedMethods.some(method => DANGEROUS_METHODS.has(method))) fail("PROHIBITED_METHOD", "Mandate cannot directly authorize transfer, approval, ownership or upgrade methods");

  validateExecutionBoundary(mandate);
  return freeze(mandate, ["allowedVenues", "allowedAssets", "allowedMarkets", "allowedMethods", "allowedContracts", "allowedTargets"]);
}

export function strategyMandateDigest(input) {
  return digestHex("YNX_WALLET_STRATEGY_MANDATE_V2", parseStrategyMandate(input));
}

export function parseStrategyAction(input) {
  exactFields(input, ACTION_FIELDS, "Wallet strategy action");
  return Object.freeze({
    schemaVersion: exact(input.schemaVersion, "schemaVersion", STRATEGY_ACTION_SCHEMA_VERSION),
    mandateId: id(input.mandateId, "mandateId"),
    mandateDigest: digest(input.mandateDigest, "mandateDigest"),
    account: pattern(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    productClientId: id(input.productClientId, "productClientId"),
    sessionBinding: digest(input.sessionBinding, "sessionBinding"),
    nonceDomain: pattern(input.nonceDomain, "nonceDomain", /^[a-z0-9][a-z0-9:._-]{15,255}$/),
    nonce: pattern(input.nonce, "nonce", /^[A-Za-z0-9_-]{16,128}$/),
    venue: id(input.venue, "venue"),
    asset: pattern(input.asset, "asset", /^[A-Z][A-Z0-9.-]{1,15}$/),
    market: pattern(input.market, "market", /^[A-Z0-9._:/-]{3,63}$/),
    target: text(input.target, "target", 3, 128),
    method: selector(input.method, "method"),
    capital: nonnegative(input.capital, "capital"),
    position: nonnegative(input.position, "position"),
    leverageBps: bounded(input.leverageBps, "leverageBps", 0, 100000),
    order: positive(input.order, "order"),
    slippageBps: bounded(input.slippageBps, "slippageBps", 0, 5000),
    gas: nonnegative(input.gas, "gas"),
    executionsInCurrentHour: bounded(input.executionsInCurrentHour, "executionsInCurrentHour", 0, 3600),
    dailyLoss: nonnegative(input.dailyLoss, "dailyLoss"),
    drawdown: nonnegative(input.drawdown, "drawdown"),
    at: time(input.at, "at"),
  });
}

export function authorizeStrategyAction(mandateInput, actionInput, at = new Date()) {
  validDate(at);
  const mandate = parseStrategyMandate(mandateInput);
  const action = parseStrategyAction(actionInput);
  const actionTime = new Date(action.at);
  if (actionTime.getTime() > at.getTime() + 30_000) fail("FUTURE_ACTION", "Strategy action timestamp is too far in the future");
  if (at.getTime() - actionTime.getTime() > 300_000) fail("STALE_ACTION", "Strategy action timestamp is stale");
  if (action.at < mandate.issuedAt || action.at >= mandate.expiresAt) fail("INACTIVE_MANDATE", "Strategy mandate is not active for this action");
  for (const field of ["mandateId", "account", "productClientId", "sessionBinding", "nonceDomain"]) {
    if (action[field] !== mandate[field]) fail("MANDATE_BINDING_MISMATCH", `Strategy action ${field} does not match the mandate`);
  }
  if (action.mandateDigest !== strategyMandateDigest(mandate)) fail("MANDATE_DIGEST_MISMATCH", "Strategy action references a different mandate digest");
  if (!mandate.allowedVenues.includes(action.venue) || !mandate.allowedAssets.includes(action.asset) || !mandate.allowedMarkets.includes(action.market) || !mandate.allowedMethods.includes(action.method)) {
    fail("SCOPE_EXPANSION", "Strategy action expands the approved venue, asset, market or method scope");
  }
  if (DANGEROUS_METHODS.has(action.method)) fail("PROHIBITED_METHOD", "Strategy action cannot transfer, approve, change ownership or upgrade authority");
  if (action.capital > mandate.maxCapital || action.position > mandate.maxPosition || action.leverageBps > mandate.maxLeverageBps || action.order > mandate.maxOrder || action.slippageBps > mandate.maxSlippageBps || action.gas > mandate.maxGas || action.executionsInCurrentHour >= mandate.maxFrequencyPerHour || action.dailyLoss > mandate.dailyLossLimit || action.drawdown > mandate.drawdownLimit) {
    fail("LIMIT_EXCEEDED", "Strategy action exceeds an approved mandate limit");
  }
  if (mandate.executionKind === "exchange-subaccount") {
    if (action.target !== mandate.executionAccount) fail("WRONG_EXECUTION_ACCOUNT", "Exchange action must use the approved subaccount");
  } else {
    const normalizedTarget = address(action.target, "target");
    const target = mandate.allowedTargets.find(item => item.address === normalizedTarget);
    if (!target || !target.methods.includes(action.method)) fail("WRONG_DEX_TARGET", "DEX action target or method is outside the approved Vault/Pool/Router boundary");
  }
  return Object.freeze({
    authorized: true,
    mandateId: mandate.mandateId,
    mandateDigest: action.mandateDigest,
    actionDigest: digestHex("YNX_WALLET_STRATEGY_ACTION_V1", action),
    nonceDomain: mandate.nonceDomain,
    nonce: action.nonce,
    at: action.at,
  });
}

export function parseCapitalProductReview(input) {
  exactFields(input, CAPITAL_FIELDS, "Wallet capital product review");
  const review = {
    schemaVersion: exact(input.schemaVersion, "schemaVersion", 1),
    productType: enumeration(input.productType, "productType", ["native-staking", "liquid-staking-candidate", "withdrawal-queue", "safety-module", "service-security-pool", "dex-lp", "vault", "trading-subaccount", "api-wallet", "portfolio-margin", "stablecoin", "bridge-route", "cross-chain-route", "solver-auction", "protocol-owned-liquidity", "treasury-multisig"]),
    name: text(input.name, "name", 1, 120),
    provider: text(input.provider, "provider", 1, 120),
    contract: address(input.contract, "contract"),
    governance: https(input.governance, "governance"),
    yieldSource: text(input.yieldSource, "yieldSource", 1, 500),
    historicalYieldRange: text(input.historicalYieldRange, "historicalYieldRange", 1, 200),
    nonGuarantee: bool(input.nonGuarantee, "nonGuarantee"),
    fees: text(input.fees, "fees", 1, 300),
    lock: text(input.lock, "lock", 1, 200),
    cooldown: text(input.cooldown, "cooldown", 1, 200),
    slashing: text(input.slashing, "slashing", 1, 300),
    drawdown: text(input.drawdown, "drawdown", 1, 300),
    withdrawalDelay: text(input.withdrawalDelay, "withdrawalDelay", 1, 200),
    reserveRatio: text(input.reserveRatio, "reserveRatio", 1, 200),
    immediateExit: https(input.immediateExit, "immediateExit"),
    revoke: https(input.revoke, "revoke"),
    risk: text(input.risk, "risk", 1, 600),
    source: https(input.source, "source"),
    asOf: time(input.asOf, "asOf"),
    version: text(input.version, "version", 1, 64),
  };
  if (!review.nonGuarantee) fail("MISLEADING_CAPITAL_REVIEW", "Capital review must explicitly state that yield, price and peg are not guaranteed");
  return Object.freeze(review);
}

function validateExecutionBoundary(mandate) {
  const targetAddresses = mandate.allowedTargets.map(item => item.address);
  const targetMethods = [...new Set(mandate.allowedTargets.flatMap(item => item.methods))].sort();
  if (mandate.executionKind === "exchange-subaccount") {
    if (!/^subaccount:[a-zA-Z0-9._-]{3,96}$/.test(mandate.executionAccount)) fail("INVALID_EXECUTION_BOUNDARY", "Exchange executionAccount must be an explicit subaccount identifier");
    if (mandate.allowedContracts.length !== 0 || mandate.allowedTargets.length !== 0) fail("INVALID_EXECUTION_BOUNDARY", "Exchange subaccounts cannot carry DEX contract permissions");
    return;
  }
  const vault = address(mandate.executionAccount, "executionAccount");
  if (mandate.allowedTargets.length === 0 || !mandate.allowedTargets.some(item => item.address === vault && item.role === "vault")) fail("INVALID_EXECUTION_BOUNDARY", "DEX mandates require the execution vault as an exact vault target");
  if (targetAddresses.join("\n") !== mandate.allowedContracts.join("\n")) fail("INVALID_EXECUTION_BOUNDARY", "DEX allowedContracts must exactly equal the typed target addresses");
  if (targetMethods.join("\n") !== mandate.allowedMethods.join("\n")) fail("INVALID_EXECUTION_BOUNDARY", "DEX allowedMethods must exactly equal the typed target methods");
}

function targetList(value) {
  if (!Array.isArray(value) || value.length > 32) fail("INVALID_FIELD", "allowedTargets has an invalid item count");
  const parsed = value.map((item, index) => {
    exactFields(item, TARGET_FIELDS, `Wallet strategy target ${index}`);
    return Object.freeze({
      address: address(item.address, `allowedTargets[${index}].address`),
      role: enumeration(item.role, `allowedTargets[${index}].role`, ["vault", "pool", "router"]),
      methods: list(item.methods, `allowedTargets[${index}].methods`, 1, 16, method => selector(method, "method")),
    });
  });
  const keys = parsed.map(item => `${item.address}:${item.role}`);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) fail("INVALID_FIELD", "allowedTargets must be unique and sorted by address and role");
  return Object.freeze(parsed);
}

function freeze(value, arrays) {
  const copy = { ...value };
  for (const key of arrays) copy[key] = Object.freeze([...copy[key]]);
  return Object.freeze(copy);
}
function list(value, label, min, max, parser) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail("INVALID_FIELD", `${label} has an invalid item count`);
  const parsed = value.map(parser);
  if (new Set(parsed).size !== parsed.length || [...parsed].sort().join("\n") !== parsed.join("\n")) fail("INVALID_FIELD", `${label} must be unique and sorted`);
  return Object.freeze(parsed);
}
function id(value, label) { return pattern(value, label, /^[a-z][a-z0-9._-]{2,63}$/); }
function digest(value, label) { return pattern(value, label, /^[0-9a-f]{64}$/); }
function selector(value, label) { return pattern(value, label, /^0x[0-9a-f]{8}$/); }
function address(value, label) { return pattern(value, label, /^0x[0-9a-f]{40}$/); }
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
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Strategy evaluation time is invalid"); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
