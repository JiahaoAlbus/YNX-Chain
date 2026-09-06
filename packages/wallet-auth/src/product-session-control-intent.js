import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { parseProductSessionGatewaySnapshot } from "./product-session-gateway-snapshot-v2.js";
import { deviceBinding, parseProductSessionApproval } from "./product-session-v2.js";
import { WALLET_SESSION_CONTROL_AUDIENCE, walletSessionControlClockFloor } from "./wallet-session-control.js";

// Pure state model used by the explicit v3 server candidate. This module cannot
// authenticate HTTP owners or attest I/O durability; its callers must do both.
const PATHS = Object.freeze({
  "account-logout": "/v2/product-sessions/wallet/sessions/revoke-all",
  "device-logout": "/v2/product-sessions/wallet/devices/revoke",
});
const MAX_INTENTS = 10_000;
const ACCOUNT = /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/;
const HASH = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const GATEWAY_FIELDS = ["schemaVersion", "authority", "consumedProofs", "idempotency", "audit", "controlIntents"];
const AUTHORITY_FIELDS = ["schemaVersion", "sessions", "issuedChallenges", "consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges", "revokedSessions", "revokedDevices", "revokedAccounts", "revokedDeviceScopes"];
const RECEIPT_FIELDS = ["version", "account", "intentId", "intentDigest", "operation", "target", "cutoff", "appliedAt", "revoked", "sessionBindings", "challengeIds", "revokedSessionCount", "cancelledChallengeCount"];

/** account must come from a verified owner proof, never from an HTTP body. */
export function parseProductSessionControlIntent(input) {
  exactFields(input, ["account", "operation", "body"], "Product Session control intent");
  const account = pattern(input.account, ACCOUNT, "account");
  if (!Object.hasOwn(PATHS, input.operation)) fail("INVALID_CONTROL_INTENT", "Control intent operation is invalid");
  const device = input.operation === "device-logout";
  exactFields(input.body, ["intentId", "intentIssuedAt", "intentExpiresAt", ...(device ? ["deviceBinding"] : [])], "Control intent body");
  const body = {
    intentId: pattern(input.body.intentId, TOKEN, "intentId"),
    intentIssuedAt: time(input.body.intentIssuedAt), intentExpiresAt: time(input.body.intentExpiresAt),
    ...(device ? { deviceBinding: pattern(input.body.deviceBinding, HASH, "deviceBinding") } : {}),
  };
  const lifetime = Date.parse(body.intentExpiresAt) - Date.parse(body.intentIssuedAt);
  if (lifetime <= 0 || lifetime > 600_000) fail("INVALID_CONTROL_INTENT", "Control intent lifetime must be positive and at most ten minutes");
  return freeze({ account, operation: input.operation, body });
}

export function productSessionControlIntentDigest(input) {
  const intent = parseProductSessionControlIntent(input);
  return digestHex("YNX_PRODUCT_SESSION_CONTROL_INTENT_V1", {
    chainId: "ynx_6423-1", audience: WALLET_SESSION_CONTROL_AUDIENCE, method: "POST",
    path: PATHS[intent.operation], ...intent,
  });
}

/** Explicit, pure migration candidate. It never reads or rewrites live state. */
export function migrateProductSessionControlSnapshotV2(input) {
  const old = parseProductSessionGatewaySnapshot(input);
  return parseProductSessionControlSnapshot({
    ...old, schemaVersion: 3,
    authority: { ...old.authority, schemaVersion: 3, revokedDeviceScopes: [] }, controlIntents: [],
  });
}

export function parseProductSessionControlSnapshot(input) {
  exactFields(input, GATEWAY_FIELDS, "Control intent candidate snapshot");
  exactFields(input.authority, AUTHORITY_FIELDS, "Control intent candidate authority");
  if (input.schemaVersion !== 3 || input.authority.schemaVersion !== 3) fail("INVALID_CONTROL_STORE", "Control intent candidate requires explicit snapshot version three");
  const { controlIntents, ...gateway } = input;
  const { revokedDeviceScopes, ...authority } = gateway.authority;
  // Existing wire/cache envelopes remain v2; this projection only validates.
  const old = parseProductSessionGatewaySnapshot({ ...gateway, schemaVersion: 2, authority: { ...authority, schemaVersion: 2 } });
  const scopes = orderedRecords(revokedDeviceScopes, (item) => {
    exactFields(item, ["account", "deviceBinding", "before"], "Revoked product device scope");
    return { account: pattern(item.account, ACCOUNT, "account"), deviceBinding: pattern(item.deviceBinding, HASH, "deviceBinding"), before: time(item.before) };
  }, scopeKey, MAX_INTENTS);
  const records = orderedRecords(controlIntents, parseRecord, recordKey, MAX_INTENTS);
  const state = { ...old, schemaVersion: 3, authority: { ...old.authority, schemaVersion: 3, revokedDeviceScopes: scopes }, controlIntents: records };
  const sessions = new Map(state.authority.sessions.map((session) => [session.sessionBinding, session]));
  const challenges = new Map(state.authority.issuedChallenges.map((challenge) => [challenge.challenge, challenge]));
  for (const { intent, receipt } of records) {
    const cutoff = cutoffFor(state, intent);
    if (cutoff === null || cutoff < receipt.cutoff) fail("INVALID_CONTROL_STORE", "Control receipt has no durable cutoff");
    if (intent.operation === "device-logout" && !ownsDevice(state, intent)) fail("INVALID_CONTROL_STORE", "Control receipt device ownership cannot be established");
    for (const binding of receipt.sessionBindings) {
      const session = sessions.get(binding);
      if (!session || !matchesScope(session, intent) || session.issuedAt > receipt.cutoff || session.expiresAt <= receipt.cutoff || !state.authority.revokedSessions.includes(binding)) fail("INVALID_CONTROL_STORE", "Control receipt session scope or exact tombstone is missing");
    }
    for (const id of receipt.challengeIds) {
      const challenge = challenges.get(id);
      if (!challenge || !matchesScope(challenge, intent) || challenge.issuedAt > receipt.cutoff || challenge.expiresAt <= receipt.cutoff) fail("INVALID_CONTROL_STORE", "Control receipt challenge is outside the original scope or cutoff");
    }
  }
  for (const scope of scopes) {
    const receipts = records.filter(({ intent }) => intent.operation === "device-logout" && intent.account === scope.account && intent.body.deviceBinding === scope.deviceBinding);
    if (!receipts.length || scope.before !== receipts.reduce((latest, { receipt }) => maxTime(latest, receipt.cutoff), "")) fail("INVALID_CONTROL_STORE", "Device cutoff requires its exact maximum committed receipt");
  }
  return freeze(state);
}

/** Validation projection only; never persist or run it as a v3 downgrade. */
export function projectProductSessionControlSnapshotV2(input) {
  const { controlIntents, ...state } = parseProductSessionControlSnapshot(input);
  const { revokedDeviceScopes, ...authority } = state.authority;
  return parseProductSessionGatewaySnapshot({ ...state, schemaVersion: 2, authority: { ...authority, schemaVersion: 2 } });
}

/** Prepare is NOT a commit: preparedReceipt is never revocation confirmation. */
export function prepareProductSessionControlIntent(input, intentInput, at, capacity = MAX_INTENTS) {
  const state = parseProductSessionControlSnapshot(input), intent = parseProductSessionControlIntent(intentInput);
  const instant = checkedInstant(state, at);
  const previous = matchingRecord(state, intent); // Conflicts precede expiry checks.
  if (previous) return plan(state, state, previous.receipt, false);
  if (intent.body.intentIssuedAt > instant) fail("ISSUED_IN_FUTURE", "Control intent was issued in the future");
  if (intent.body.intentExpiresAt <= instant) fail("INTENT_EXPIRED", "An uncommitted expired control intent cannot be applied");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_INTENTS) fail("INVALID_CONTROL_CAPACITY", "Control intent capacity is invalid");
  if (state.controlIntents.length >= capacity) fail("CONTROL_INTENT_CAPACITY", "Control intent storage is full; no revocation was prepared");
  if (intent.operation === "device-logout" && !ownsDevice(state, intent)) fail("DEVICE_NOT_FOUND", "Owned product device scope was not found");
  const sessionBindings = state.authority.sessions.filter((session) => matchesScope(session, intent) && session.issuedAt <= instant && session.expiresAt > instant && !recordRevoked(state, session)).map((session) => session.sessionBinding).sort();
  const challengeIds = state.authority.issuedChallenges.filter((challenge) => matchesScope(challenge, intent) && challenge.issuedAt <= instant && challenge.expiresAt > instant && !recordRevoked(state, challenge)).map((challenge) => challenge.challenge).sort();
  const receipt = {
    version: 1, account: intent.account, intentId: intent.body.intentId,
    intentDigest: productSessionControlIntentDigest(intent), operation: intent.operation, target: target(intent),
    cutoff: instant, appliedAt: instant, revoked: true, sessionBindings, challengeIds,
    revokedSessionCount: sessionBindings.length, cancelledChallengeCount: challengeIds.length,
  };
  const next = clone(state);
  next.authority.revokedSessions = [...new Set([...next.authority.revokedSessions, ...sessionBindings])].sort();
  if (intent.operation === "account-logout") {
    const previousCutoff = next.authority.revokedAccounts.find((item) => item.account === intent.account);
    next.authority.revokedAccounts = next.authority.revokedAccounts.filter((item) => item.account !== intent.account);
    next.authority.revokedAccounts.push({ account: intent.account, before: maxTime(previousCutoff?.before ?? "", instant) });
    next.authority.revokedAccounts.sort((a, b) => compare(a.account, b.account));
  } else {
    const key = `${intent.account}:${intent.body.deviceBinding}`;
    const previousCutoff = next.authority.revokedDeviceScopes.find((item) => scopeKey(item) === key);
    next.authority.revokedDeviceScopes = next.authority.revokedDeviceScopes.filter((item) => scopeKey(item) !== key);
    next.authority.revokedDeviceScopes.push({ account: intent.account, deviceBinding: intent.body.deviceBinding, before: maxTime(previousCutoff?.before ?? "", instant) });
    next.authority.revokedDeviceScopes.sort((a, b) => compare(scopeKey(a), scopeKey(b)));
  }
  next.controlIntents.push({ intent, receipt });
  next.controlIntents.sort((a, b) => compare(recordKey(a), recordKey(b)));
  return plan(state, parseProductSessionControlSnapshot(next), receipt, true);
}

/** Call inside the writer's serialization boundary, before composing/persisting. */
export function assertProductSessionControlPlanBase(prepared, latestInput) {
  exactFields(prepared, ["status", "revocationConfirmed", "baseStateDigest", "candidateStateDigest", "mutationRequired", "preparedReceipt", "candidate"], "Prepared control plan");
  if (prepared.status !== "prepared" || prepared.revocationConfirmed !== false || typeof prepared.mutationRequired !== "boolean") fail("INVALID_CONTROL_PLAN", "Prepared control plan cannot assert confirmation");
  const latest = parseProductSessionControlSnapshot(latestInput), candidate = parseProductSessionControlSnapshot(prepared.candidate);
  if (snapshotDigest(latest) !== prepared.baseStateDigest) fail("STALE_CONTROL_STATE", "Control plan must be prepared again from the latest durable state");
  const record = candidate.controlIntents.find((item) => canonicalJSON(item.receipt) === canonicalJSON(prepared.preparedReceipt));
  if (snapshotDigest(candidate) !== prepared.candidateStateDigest || !record) fail("INVALID_CONTROL_PLAN", "Control plan receipt and candidate are inconsistent");
  // A digest is a comparison token, not authorization to replace unrelated
  // history. Recompute the exact transition before the writer composes its
  // proof, clock anchor and audit into the same transaction.
  const expected = prepareProductSessionControlIntent(latest, record.intent, new Date(Math.max(productSessionControlClockFloor(latest), Date.parse(record.receipt.appliedAt))));
  if (expected.candidateStateDigest !== prepared.candidateStateDigest || expected.mutationRequired !== prepared.mutationRequired) fail("INVALID_CONTROL_PLAN", "Control plan changes state outside its fixed intent transition");
  return candidate;
}

/** Only pass a trusted durable readback; this pure function cannot attest I/O. */
export function observeDurableProductSessionControlIntent(durableInput, intentInput, at) {
  const state = parseProductSessionControlSnapshot(durableInput), intent = parseProductSessionControlIntent(intentInput);
  const instant = checkedInstant(state, at), record = matchingRecord(state, intent);
  if (record) return freeze({ status: "confirmed", revocationConfirmed: true, receipt: record.receipt });
  const expired = intent.body.intentExpiresAt <= instant;
  return freeze({ status: "unknown", revocationConfirmed: false, reason: expired ? "intent-expired" : "not-recorded", retryAllowed: !expired });
}

/** Admission guard used before issue, complete, and cached success. */
export function assertProductSessionControlApprovalAllowed(input, registry, request, approval, at) {
  const state = parseProductSessionControlSnapshot(input);
  checkedInstant(state, at);
  const verified = parseProductSessionApproval(registry, request, approval, at);
  if (recordRevoked(state, verified)) fail("SESSION_REVOKED", "Wallet approval predates the account or product device logout");
  return verified;
}

/** Revocation/expiry check only; the caller still enforces product/device proof context. */
export function assertProductSessionControlSessionAllowed(input, sessionBinding, at) {
  const state = parseProductSessionControlSnapshot(input), instant = checkedInstant(state, at);
  const session = state.authority.sessions.find((item) => item.sessionBinding === pattern(sessionBinding, HASH, "sessionBinding"));
  if (!session) fail("SESSION_NOT_FOUND", "Product Session was not found");
  if (session.expiresAt <= instant) fail("SESSION_EXPIRED", "Product Session has expired");
  if (recordRevoked(state, session)) fail("SESSION_REVOKED", "Product Session was revoked");
  return session;
}

function parseRecord(input) {
  exactFields(input, ["intent", "receipt"], "Committed control intent");
  const intent = parseProductSessionControlIntent(input.intent), receipt = input.receipt;
  exactFields(receipt, RECEIPT_FIELDS, "Control intent receipt");
  const cutoff = time(receipt.cutoff), appliedAt = time(receipt.appliedAt);
  if (receipt.version !== 1 || receipt.revoked !== true || receipt.account !== intent.account || receipt.intentId !== intent.body.intentId || receipt.intentDigest !== productSessionControlIntentDigest(intent) || receipt.operation !== intent.operation || canonicalJSON(receipt.target) !== canonicalJSON(target(intent)) || cutoff !== appliedAt || cutoff < intent.body.intentIssuedAt || cutoff >= intent.body.intentExpiresAt) fail("INVALID_CONTROL_STORE", "Control receipt is not bound to its original intent and execution time");
  const sessionBindings = stringSet(receipt.sessionBindings, HASH), challengeIds = stringSet(receipt.challengeIds, TOKEN);
  if (receipt.revokedSessionCount !== sessionBindings.length || receipt.cancelledChallengeCount !== challengeIds.length) fail("INVALID_CONTROL_STORE", "Control receipt counts do not match the frozen target lists");
  return { intent, receipt: { ...receipt, target: target(intent), sessionBindings, challengeIds } };
}

function matchingRecord(state, intent) {
  const record = state.controlIntents.find((item) => recordKey(item) === recordKey({ intent }));
  if (record && productSessionControlIntentDigest(intent) !== record.receipt.intentDigest) fail("IDEMPOTENCY_CONFLICT", "The original account intent ID is already bound to a different operation or body");
  return record;
}
function target(intent) { return { account: intent.account, ...(intent.operation === "device-logout" ? { deviceBinding: intent.body.deviceBinding } : {}) }; }
function recordKey({ intent }) { return `${intent.account}:${intent.body.intentId}`; }
function scopeKey(item) { return `${item.account}:${item.deviceBinding}`; }
function binding(record) { return deviceBinding(record, record.account); }
function matchesScope(record, intent) { return record.account === intent.account && (intent.operation === "account-logout" || binding(record) === intent.body.deviceBinding); }
function ownsDevice(state, intent) { return [...state.authority.sessions, ...state.authority.issuedChallenges].some((record) => matchesScope(record, intent)); }
function cutoffFor(state, intent) {
  return intent.operation === "account-logout"
    ? state.authority.revokedAccounts.find((item) => item.account === intent.account)?.before ?? null
    : state.authority.revokedDeviceScopes.find((item) => item.account === intent.account && item.deviceBinding === intent.body.deviceBinding)?.before ?? null;
}
function recordRevoked(state, record) {
  const authority = state.authority, device = binding(record);
  return Boolean(record.sessionBinding && authority.revokedSessions.includes(record.sessionBinding)) || authority.revokedDevices.includes(device)
    || authority.revokedAccounts.some((item) => item.account === record.account && record.issuedAt <= item.before)
    || authority.revokedDeviceScopes.some((item) => item.account === record.account && item.deviceBinding === device && record.issuedAt <= item.before);
}
function checkedInstant(state, at) {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) fail("INVALID_TIME", "Control operation requires a valid authority instant");
  const instant = time(at.toISOString());
  if (at.getTime() < productSessionControlClockFloor(state)) fail("CLOCK_UNAVAILABLE", "Control operation authority clock is behind committed state");
  return instant;
}
export function productSessionControlClockFloor(state) {
  const timestamps = [...state.authority.revokedAccounts.map((item) => item.before), ...state.authority.revokedDeviceScopes.map((item) => item.before), ...state.controlIntents.map((item) => item.receipt.appliedAt), ...state.authority.sessions.map((item) => item.issuedAt), ...state.authority.issuedChallenges.map((item) => item.issuedAt)];
  return timestamps.reduce((floor, timestamp) => Math.max(floor, Date.parse(timestamp)), walletSessionControlClockFloor(state));
}
function snapshotDigest(state) { return digestHex("YNX_PRODUCT_SESSION_CONTROL_STATE_V3", state); }
function plan(base, candidate, receipt, mutationRequired) { return freeze({ status: "prepared", revocationConfirmed: false, baseStateDigest: snapshotDigest(base), candidateStateDigest: snapshotDigest(candidate), mutationRequired, preparedReceipt: receipt, candidate }); }
function stringSet(input, expression) {
  if (!Array.isArray(input) || input.length > 20_000 || input.some((value) => typeof value !== "string" || !expression.test(value)) || input.some((value, index) => index && input[index - 1] >= value)) fail("INVALID_CONTROL_STORE", "Control receipt targets must be valid, unique and sorted");
  return [...input];
}
function orderedRecords(input, parse, key, limit) {
  if (!Array.isArray(input) || input.length > limit) fail("INVALID_CONTROL_STORE", "Control state collection is invalid or exceeds capacity");
  const values = input.map(parse);
  if (values.some((value, index) => index && key(values[index - 1]) >= key(value))) fail("INVALID_CONTROL_STORE", "Control state records must be unique and sorted");
  return values;
}
function time(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) < 0 || new Date(value).toISOString() !== value) fail("INVALID_TIME", "Control timestamp is invalid"); return value; }
function pattern(value, expression, label) { if (typeof value !== "string" || !expression.test(value)) fail("INVALID_CONTROL_INTENT", `Control intent ${label} is invalid`); return value; }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function maxTime(a, b) { return a > b ? a : b; }
function clone(value) { return JSON.parse(canonicalJSON(value)); }
function freeze(value) { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
