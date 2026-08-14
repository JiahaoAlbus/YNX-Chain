import { exactFields, digestHex, WalletAuthError } from "./canonical.js";

const OPERATION_FIELDS = [
  "schemaVersion", "chainId", "entryPoint", "sender", "nonceKey", "nonceSequence", "calls",
  "callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas",
  "validAfter", "validUntil",
];
const CALL_FIELDS = ["target", "selector", "value", "dataDigest"];
const REQUEST_FIELDS = [
  "schemaVersion", "policyId", "sponsorType", "productClientId", "sessionBinding", "account",
  "productDeviceKey", "orderedScopes", "requestNonce", "expiresAt", "userOperationDigest",
  "antiSybilBinding", "requestedCost", "subjectDailyUsed", "sponsorDailyUsed", "firstAction", "source",
  "asOf", "version",
];
const BINDING_FIELDS = ["productClientId", "sessionBinding", "account", "productDeviceKey", "orderedScopes", "antiSybilBinding"];
const POLICY_FIELDS = [
  "schemaVersion", "policyId", "enabled", "sponsorType", "productClientId", "paymaster", "entryPoint",
  "allowedTargets", "allowedSelectors", "maxCalls", "maxCostPerOperation", "maxCostPerSubjectDay",
  "maxCostPerSponsorDay", "requiresFirstAction", "validAfter", "validUntil", "provider", "fees",
  "risk", "revocation", "source", "asOf", "version",
];

export const SMART_ACCOUNT_SCHEMA_VERSION = 1;
export const SMART_ACCOUNT_CHAIN_ID = 6423;

export function parseUserOperationEnvelope(input) {
  exactFields(input, OPERATION_FIELDS, "Smart Account UserOperation envelope");
  const operation = {
    schemaVersion: exactInteger(input.schemaVersion, "schemaVersion", SMART_ACCOUNT_SCHEMA_VERSION),
    chainId: exactInteger(input.chainId, "chainId", SMART_ACCOUNT_CHAIN_ID),
    entryPoint: address(input.entryPoint, "entryPoint"),
    sender: address(input.sender, "sender"),
    nonceKey: hex(input.nonceKey, "nonceKey", 48),
    nonceSequence: nonnegative(input.nonceSequence, "nonceSequence"),
    calls: calls(input.calls),
    callGasLimit: positive(input.callGasLimit, "callGasLimit"),
    verificationGasLimit: positive(input.verificationGasLimit, "verificationGasLimit"),
    preVerificationGas: positive(input.preVerificationGas, "preVerificationGas"),
    maxFeePerGas: positive(input.maxFeePerGas, "maxFeePerGas"),
    maxPriorityFeePerGas: positive(input.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
    validAfter: timestamp(input.validAfter, "validAfter"),
    validUntil: timestamp(input.validUntil, "validUntil"),
  };
  if (operation.entryPoint === operation.sender) fail("INVALID_USER_OPERATION", "EntryPoint and sender must differ");
  if (operation.maxPriorityFeePerGas > operation.maxFeePerGas) fail("INVALID_USER_OPERATION", "Priority fee cannot exceed maximum fee");
  if (operation.validUntil <= operation.validAfter) fail("INVALID_USER_OPERATION", "UserOperation validity window is empty");
  return freeze(operation, ["calls"]);
}

export function userOperationDigest(input) {
  return digestHex("YNX_SMART_ACCOUNT_USER_OPERATION_V1", parseUserOperationEnvelope(input));
}

export function parseSponsorshipPolicy(input) {
  exactFields(input, POLICY_FIELDS, "Smart Account sponsorship policy");
  const policy = {
    schemaVersion: exactInteger(input.schemaVersion, "schemaVersion", 1),
    policyId: identifier(input.policyId, "policyId"),
    enabled: boolean(input.enabled, "enabled"),
    sponsorType: enumeration(input.sponsorType, "sponsorType", ["first-action", "product", "merchant", "developer-testnet"]),
    productClientId: identifier(input.productClientId, "productClientId"),
    paymaster: address(input.paymaster, "paymaster"),
    entryPoint: address(input.entryPoint, "entryPoint"),
    allowedTargets: uniqueSorted(input.allowedTargets, "allowedTargets", 1, 32, (value) => address(value, "allowed target")),
    allowedSelectors: uniqueSorted(input.allowedSelectors, "allowedSelectors", 1, 64, (value) => hex(value, "allowed selector", 8)),
    maxCalls: boundedInteger(input.maxCalls, "maxCalls", 1, 16),
    maxCostPerOperation: positive(input.maxCostPerOperation, "maxCostPerOperation"),
    maxCostPerSubjectDay: positive(input.maxCostPerSubjectDay, "maxCostPerSubjectDay"),
    maxCostPerSponsorDay: positive(input.maxCostPerSponsorDay, "maxCostPerSponsorDay"),
    requiresFirstAction: boolean(input.requiresFirstAction, "requiresFirstAction"),
    validAfter: timestamp(input.validAfter, "validAfter"),
    validUntil: timestamp(input.validUntil, "validUntil"),
    provider: boundedText(input.provider, "provider", 1, 128),
    fees: boundedText(input.fees, "fees", 1, 280),
    risk: boundedText(input.risk, "risk", 1, 500),
    revocation: httpsURL(input.revocation, "revocation"),
    source: httpsURL(input.source, "source"),
    asOf: timestamp(input.asOf, "asOf"),
    version: boundedText(input.version, "version", 1, 64),
  };
  if (policy.validUntil <= policy.validAfter) fail("INVALID_SPONSOR_POLICY", "Sponsorship policy validity window is empty");
  if (policy.maxCostPerOperation > policy.maxCostPerSubjectDay || policy.maxCostPerSubjectDay > policy.maxCostPerSponsorDay) fail("INVALID_SPONSOR_POLICY", "Sponsorship budgets must be monotonically bounded");
  if ((policy.sponsorType === "first-action") !== policy.requiresFirstAction) fail("INVALID_SPONSOR_POLICY", "First-action policy must require an unused subject");
  return freeze(policy, ["allowedTargets", "allowedSelectors"]);
}

export function parseSponsorshipRequest(input) {
  exactFields(input, REQUEST_FIELDS, "Smart Account sponsorship request");
  return Object.freeze({
    schemaVersion: exactInteger(input.schemaVersion, "schemaVersion", 2),
    policyId: identifier(input.policyId, "policyId"),
    sponsorType: enumeration(input.sponsorType, "sponsorType", ["first-action", "product", "merchant", "developer-testnet"]),
    productClientId: identifier(input.productClientId, "productClientId"),
    sessionBinding: hex(input.sessionBinding, "sessionBinding", 64),
    account: ynxAccount(input.account),
    productDeviceKey: compressedP256(input.productDeviceKey, "productDeviceKey"),
    orderedScopes: orderedScopes(input.orderedScopes),
    requestNonce: hex(input.requestNonce, "requestNonce", 64),
    expiresAt: timestamp(input.expiresAt, "expiresAt"),
    userOperationDigest: hex(input.userOperationDigest, "userOperationDigest", 64),
    antiSybilBinding: hex(input.antiSybilBinding, "antiSybilBinding", 64),
    requestedCost: positive(input.requestedCost, "requestedCost"),
    subjectDailyUsed: nonnegative(input.subjectDailyUsed, "subjectDailyUsed"),
    sponsorDailyUsed: nonnegative(input.sponsorDailyUsed, "sponsorDailyUsed"),
    firstAction: boolean(input.firstAction, "firstAction"),
    source: httpsURL(input.source, "source"),
    asOf: timestamp(input.asOf, "asOf"),
    version: boundedText(input.version, "version", 1, 64),
  });
}

export function parseSponsorshipBinding(input) {
  if (input === undefined || input === null) fail("INVALID_SPONSOR_BINDING", "Canonical Product Session binding is required");
  try {
    exactFields(input, BINDING_FIELDS, "Smart Account sponsorship binding");
    return Object.freeze({
      productClientId: identifier(input.productClientId, "productClientId"),
      sessionBinding: hex(input.sessionBinding, "sessionBinding", 64),
      account: ynxAccount(input.account),
      productDeviceKey: compressedP256(input.productDeviceKey, "productDeviceKey"),
      orderedScopes: orderedScopes(input.orderedScopes),
      antiSybilBinding: hex(input.antiSybilBinding, "antiSybilBinding", 64),
    });
  } catch (error) {
    if (error instanceof WalletAuthError && error.code === "INVALID_SPONSOR_BINDING") throw error;
    fail("INVALID_SPONSOR_BINDING", "Canonical Product Session binding is invalid");
  }
}

export function evaluateSponsorship(operationInput, requestInput, policyInput, bindingInput, at = new Date()) {
  const operation = parseUserOperationEnvelope(operationInput);
  const request = parseSponsorshipRequest(requestInput);
  const policy = parseSponsorshipPolicy(policyInput);
  const binding = parseSponsorshipBinding(bindingInput);
  const now = validDate(at).toISOString();
  const reasons = [];
  if (!policy.enabled) reasons.push("policy-disabled");
  if (request.policyId !== policy.policyId || request.sponsorType !== policy.sponsorType || request.productClientId !== policy.productClientId) reasons.push("policy-binding-mismatch");
  if (request.productClientId !== binding.productClientId) reasons.push("product-binding-mismatch");
  if (request.sessionBinding !== binding.sessionBinding) reasons.push("session-binding-mismatch");
  if (request.account !== binding.account) reasons.push("account-binding-mismatch");
  if (request.productDeviceKey !== binding.productDeviceKey) reasons.push("device-binding-mismatch");
  if (!sameOrdered(request.orderedScopes, binding.orderedScopes)) reasons.push("scope-binding-mismatch");
  if (request.antiSybilBinding !== binding.antiSybilBinding) reasons.push("anti-sybil-binding-mismatch");
  if (request.userOperationDigest !== userOperationDigest(operation)) reasons.push("operation-digest-mismatch");
  if (operation.entryPoint !== policy.entryPoint) reasons.push("entry-point-mismatch");
  if (operation.calls.length > policy.maxCalls) reasons.push("call-count-exceeded");
  if (operation.calls.some((call) => !policy.allowedTargets.includes(call.target))) reasons.push("target-not-allowed");
  if (operation.calls.some((call) => !policy.allowedSelectors.includes(call.selector))) reasons.push("selector-not-allowed");
  if (request.requestedCost > policy.maxCostPerOperation) reasons.push("operation-budget-exceeded");
  if (request.subjectDailyUsed + request.requestedCost > policy.maxCostPerSubjectDay) reasons.push("subject-daily-budget-exceeded");
  if (request.sponsorDailyUsed + request.requestedCost > policy.maxCostPerSponsorDay) reasons.push("sponsor-daily-budget-exceeded");
  if (policy.requiresFirstAction && !request.firstAction) reasons.push("first-action-already-used");
  if (now < policy.validAfter || now >= policy.validUntil || now < operation.validAfter || now >= operation.validUntil || now < request.asOf || now >= request.expiresAt) reasons.push("outside-validity-window");
  return Object.freeze({
    eligible: reasons.length === 0,
    reasons: Object.freeze(reasons),
    policyId: policy.policyId,
    userOperationDigest: request.userOperationDigest,
    paymaster: policy.paymaster,
    approvedCost: reasons.length === 0 ? request.requestedCost : 0,
    remainingSubjectBudget: Math.max(0, policy.maxCostPerSubjectDay - request.subjectDailyUsed - (reasons.length === 0 ? request.requestedCost : 0)),
    remainingSponsorBudget: Math.max(0, policy.maxCostPerSponsorDay - request.sponsorDailyUsed - (reasons.length === 0 ? request.requestedCost : 0)),
  });
}

export class SponsorshipAuthorizationLedger {
  #consumed = new Set();
  #maximumConsumed;
  constructor({ maximumConsumed = 100_000 } = {}) {
    this.#maximumConsumed = boundedInteger(maximumConsumed, "maximumConsumed", 1, 1_000_000);
  }
  get size() { return this.#consumed.size; }
  authorize(operationInput, requestInput, policyInput, bindingInput, at = new Date()) {
    const request = parseSponsorshipRequest(requestInput);
    const key = `${request.account}:${request.productClientId}:${request.requestNonce}`;
    if (this.#consumed.has(key)) fail("SPONSORSHIP_REPLAY", "Sponsorship authorization nonce was already consumed");
    const result = evaluateSponsorship(operationInput, request, policyInput, bindingInput, at);
    if (!result.eligible) return result;
    if (this.#consumed.size >= this.#maximumConsumed) fail("SPONSORSHIP_LEDGER_FULL", "Sponsorship authorization ledger reached its configured bound");
    this.#consumed.add(key);
    return result;
  }
}

function calls(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) fail("INVALID_USER_OPERATION", "calls must contain between one and sixteen entries");
  return Object.freeze(value.map((item) => {
    exactFields(item, CALL_FIELDS, "Smart Account call");
    return Object.freeze({ target: address(item.target, "target"), selector: hex(item.selector, "selector", 8), value: nonnegative(item.value, "value"), dataDigest: hex(item.dataDigest, "dataDigest", 64) });
  }));
}
function orderedScopes(value) { if (!Array.isArray(value) || value.length < 1 || value.length > 32) fail("INVALID_FIELD", "orderedScopes has an invalid item count"); const parsed = value.map((item) => pattern(item, "scope", /^[a-z][a-z0-9.-]{2,63}$/)); if (new Set(parsed).size !== parsed.length) fail("INVALID_FIELD", "orderedScopes must be unique"); return Object.freeze(parsed); }
function sameOrdered(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function freeze(value, arrays) { const copy = { ...value }; for (const key of arrays) copy[key] = Object.freeze([...copy[key]]); return Object.freeze(copy); }
function uniqueSorted(value, label, min, max, parser) { if (!Array.isArray(value) || value.length < min || value.length > max) fail("INVALID_FIELD", `${label} has an invalid item count`); const parsed = value.map(parser); if (new Set(parsed).size !== parsed.length || [...parsed].sort().join("\n") !== parsed.join("\n")) fail("INVALID_FIELD", `${label} must be unique and sorted`); return Object.freeze(parsed); }
function address(value, label) { return pattern(value, label, /^0x[0-9a-f]{40}$/); }
function compressedP256(value, label) { return pattern(value, label, /^(?:02|03)[0-9a-f]{64}$/); }
function ynxAccount(value) { return pattern(value, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/); }
function identifier(value, label) { return pattern(value, label, /^[a-z][a-z0-9._-]{2,63}$/); }
function hex(value, label, digits) { return pattern(value, label, new RegExp(`^(?:0x)?[0-9a-f]{${digits}}$`)); }
function pattern(value, label, regex) { const text = boundedText(value, label, 1, 512); if (!regex.test(text)) fail("INVALID_FIELD", `${label} is invalid`); return text; }
function boundedText(value, label, min, max) { if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value) fail("INVALID_FIELD", `${label} is invalid`); return value; }
function timestamp(value, label) { const text = pattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) fail("INVALID_TIME", `${label} is invalid`); return text; }
function httpsURL(value, label) { const text = boundedText(value, label, 1, 512); let parsed; try { parsed = new URL(text); } catch { fail("INVALID_URL", `${label} is invalid`); } if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.toString() !== text) fail("INVALID_URL", `${label} must be a canonical HTTPS URL`); return text; }
function positive(value, label) { return boundedInteger(value, label, 1, Number.MAX_SAFE_INTEGER); }
function nonnegative(value, label) { return boundedInteger(value, label, 0, Number.MAX_SAFE_INTEGER); }
function boundedInteger(value, label, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail("INVALID_NUMBER", `${label} is outside its allowed range`); return value; }
function exactInteger(value, label, expected) { return boundedInteger(value, label, expected, expected); }
function boolean(value, label) { if (typeof value !== "boolean") fail("INVALID_FIELD", `${label} must be boolean`); return value; }
function enumeration(value, label, choices) { if (!choices.includes(value)) fail("INVALID_FIELD", `${label} is unsupported`); return value; }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Evaluation time is invalid"); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
