import { digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { parseCentralWalletSession, verifyCentralWalletSession, assertCentralWalletSessionActive } from "./integration.js";

const SNAPSHOT_FIELDS = [
  "schemaVersion", "consumedNonces", "consumedRequestDigests", "consumedChallenges", "sessions",
  "revokedSessionBindings", "revokedApprovalDigests", "revokedDeviceBindings", "accountLogoutRecords", "audit",
];
const AUDIT_FIELDS = ["sequence", "type", "subject", "at", "previousHash", "hash"];
const INTROSPECTION_FIELDS = ["productClientId", "bundleId", "productDeviceKey", "requiredScopes"];

export const CENTRAL_WALLET_SESSION_INVENTORY_SCHEMA_VERSION = 1;

export class CentralWalletSessionStore {
  #state;
  constructor(snapshot = emptySnapshot()) { this.#state = parseSnapshot(snapshot); }

  complete(input, at = new Date()) {
    validDate(at);
    const before = this.snapshot();
    const session = verifyCentralWalletSession(input, at);
    const challenge = input.gatewayCompletion.challenge.challenge;
    if (this.#state.consumedNonces.includes(session.nonce) || this.#state.consumedRequestDigests.includes(session.requestDigest) || this.#state.consumedChallenges.includes(challenge) || this.#state.sessions.some((item) => item.sessionBinding === session.sessionBinding)) {
      throw new WalletAuthError("REPLAY", "Wallet authorization or Gateway challenge was already consumed");
    }
    try {
      const next = cloneSnapshot(this.#state);
      next.consumedNonces.push(session.nonce);
      next.consumedRequestDigests.push(session.requestDigest);
      next.consumedChallenges.push(challenge);
      next.sessions.push(session);
      sortState(next);
      appendAudit(next, "session-created", session.sessionBinding, at);
      this.#state = parseSnapshot(next);
      return session;
    } catch (error) {
      this.#state = parseSnapshot(before);
      throw error;
    }
  }

  introspect(sessionBinding, context, at = new Date()) {
    exactFields(context, INTROSPECTION_FIELDS, "Central Wallet introspection context");
    const session = this.#state.sessions.find((item) => item.sessionBinding === strictDigest(sessionBinding, "sessionBinding"));
    if (!session) throw new WalletAuthError("SESSION_NOT_FOUND", "Wallet product session was not found");
    const active = assertCentralWalletSessionActive(session, this.revocationState(), at);
    if (context.productClientId !== active.productClientId || context.bundleId !== active.bundleId || context.productDeviceKey !== active.productDeviceKey) throw new WalletAuthError("CROSS_APP_REUSE", "Wallet product session cannot be reused by another App or device");
    const required = sortedStrings(context.requiredScopes, "requiredScopes", 1, 8, /^[a-z][a-z0-9._:-]{1,63}$/);
    if (required.some((scope) => !active.scopes.includes(scope))) throw new WalletAuthError("SCOPE_NOT_ALLOWED", "Wallet product session lacks a required scope");
    return Object.freeze({ active: true, session: active });
  }

  inventory(account, at = new Date()) {
    const normalized = strictAccount(account);
    const asOf = validDate(at).toISOString();
    const sessions = this.#state.sessions
      .filter((session) => session.account === normalized)
      .map((session) => inventorySession(session, this.#state, asOf));
    return Object.freeze({
      schemaVersion: CENTRAL_WALLET_SESSION_INVENTORY_SCHEMA_VERSION,
      account: normalized,
      asOf,
      connectedApps: groupConnectedApps(sessions),
      approvals: groupApprovals(sessions, this.#state.revokedApprovalDigests),
      devices: groupDevices(sessions, this.#state.revokedDeviceBindings),
      sessions: Object.freeze(sessions),
    });
  }

  revokeSession(sessionBinding, at = new Date()) { return this.#revoke("revokedSessionBindings", strictDigest(sessionBinding, "sessionBinding"), "session-revoked", at); }
  revokeApproval(approvalDigest, at = new Date()) { return this.#revoke("revokedApprovalDigests", strictDigest(approvalDigest, "approvalDigest"), "approval-revoked", at); }
  revokeDevice(deviceBinding, at = new Date()) { return this.#revoke("revokedDeviceBindings", strictDigest(deviceBinding, "deviceBinding"), "device-revoked", at); }

  logoutAllDevices(account, at = new Date()) {
    const before = strictTime(validDate(at).toISOString(), "before");
    const normalized = strictAccount(account);
    const next = cloneSnapshot(this.#state);
    next.accountLogoutRecords = next.accountLogoutRecords.filter((record) => record.account !== normalized);
    next.accountLogoutRecords.push({ account: normalized, before });
    sortState(next);
    appendAudit(next, "account-all-devices-logout", digestHex("YNX_WALLET_ACCOUNT_LOGOUT_V1", { account: normalized, before }), at);
    this.#state = parseSnapshot(next);
    return Object.freeze({ account: normalized, before });
  }

  revocationState() {
    return Object.freeze({
      revokedSessionBindings: this.#state.revokedSessionBindings,
      revokedApprovalDigests: this.#state.revokedApprovalDigests,
      revokedDeviceBindings: this.#state.revokedDeviceBindings,
      accountLogoutRecords: this.#state.accountLogoutRecords,
    });
  }

  snapshot() { return freezeSnapshot(cloneSnapshot(this.#state)); }

  #revoke(field, digest, type, at) {
    validDate(at);
    if (this.#state[field].includes(digest)) throw new WalletAuthError("ALREADY_REVOKED", "Wallet revocation was already recorded");
    const next = cloneSnapshot(this.#state);
    next[field].push(digest);
    sortState(next);
    appendAudit(next, type, digest, at);
    this.#state = parseSnapshot(next);
    return digest;
  }
}

export function parseCentralWalletStoreSnapshot(input) { return parseSnapshot(input); }

function emptySnapshot() {
  return { schemaVersion: 1, consumedNonces: [], consumedRequestDigests: [], consumedChallenges: [], sessions: [], revokedSessionBindings: [], revokedApprovalDigests: [], revokedDeviceBindings: [], accountLogoutRecords: [], audit: [] };
}

function parseSnapshot(input) {
  exactFields(input, SNAPSHOT_FIELDS, "Central Wallet session store snapshot");
  if (input.schemaVersion !== 1) throw new WalletAuthError("INVALID_STORE", "Central Wallet session store schema is unsupported");
  const snapshot = {
    schemaVersion: 1,
    consumedNonces: sortedStrings(input.consumedNonces, "consumedNonces", 0, 10000, /^[A-Za-z0-9_-]{32,64}$/),
    consumedRequestDigests: sortedStrings(input.consumedRequestDigests, "consumedRequestDigests", 0, 10000, /^[0-9a-f]{64}$/),
    consumedChallenges: sortedStrings(input.consumedChallenges, "consumedChallenges", 0, 10000, /^[A-Za-z0-9_-]{16,128}$/),
    sessions: parseSessions(input.sessions),
    revokedSessionBindings: sortedStrings(input.revokedSessionBindings, "revokedSessionBindings", 0, 10000, /^[0-9a-f]{64}$/),
    revokedApprovalDigests: sortedStrings(input.revokedApprovalDigests, "revokedApprovalDigests", 0, 10000, /^[0-9a-f]{64}$/),
    revokedDeviceBindings: sortedStrings(input.revokedDeviceBindings, "revokedDeviceBindings", 0, 10000, /^[0-9a-f]{64}$/),
    accountLogoutRecords: parseLogoutRecords(input.accountLogoutRecords),
    audit: parseAudit(input.audit),
  };
  if (snapshot.sessions.length !== snapshot.consumedNonces.length || snapshot.sessions.length !== snapshot.consumedRequestDigests.length || snapshot.sessions.length !== snapshot.consumedChallenges.length || snapshot.sessions.some((session) => !snapshot.consumedNonces.includes(session.nonce) || !snapshot.consumedRequestDigests.includes(session.requestDigest))) {
    throw new WalletAuthError("INVALID_STORE", "Consumed authorization records must exactly cover stored sessions");
  }
  return freezeSnapshot(snapshot);
}

function parseSessions(value) {
  if (!Array.isArray(value) || value.length > 10000) throw new WalletAuthError("INVALID_STORE", "sessions has an invalid item count");
  const sessions = value.map(parseCentralWalletSession);
  const keys = sessions.map((session) => session.sessionBinding);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) throw new WalletAuthError("INVALID_STORE", "sessions must be unique and sorted");
  return sessions;
}

function parseLogoutRecords(value) {
  if (!Array.isArray(value) || value.length > 10000) throw new WalletAuthError("INVALID_STORE", "accountLogoutRecords has an invalid item count");
  const records = value.map((record) => { exactFields(record, ["account", "before"], "Wallet account logout record"); return Object.freeze({ account: strictAccount(record.account), before: strictTime(record.before, "before") }); });
  const keys = records.map((record) => `${record.account}:${record.before}`);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) throw new WalletAuthError("INVALID_STORE", "accountLogoutRecords must be unique and sorted");
  return records;
}

function parseAudit(value) {
  if (!Array.isArray(value) || value.length > 20000) throw new WalletAuthError("INVALID_STORE", "audit has an invalid item count");
  let previousHash = null;
  return value.map((event, index) => {
    exactFields(event, AUDIT_FIELDS, "Central Wallet audit event");
    const unsigned = { sequence: event.sequence, type: event.type, subject: event.subject, at: event.at, previousHash: event.previousHash };
    if (event.sequence !== index + 1 || typeof event.type !== "string" || !/^[a-z][a-z-]{2,63}$/.test(event.type) || typeof event.subject !== "string" || event.subject.length < 1 || event.subject.length > 128 || strictTime(event.at, "audit at") !== event.at || event.previousHash !== previousHash || event.hash !== digestHex("YNX_WALLET_CENTRAL_AUDIT_V1", unsigned)) throw new WalletAuthError("INVALID_STORE", "Central Wallet audit hash chain is invalid");
    previousHash = event.hash;
    return Object.freeze(event);
  });
}

function appendAudit(state, type, subject, at) {
  const unsigned = { sequence: state.audit.length + 1, type, subject, at: validDate(at).toISOString(), previousHash: state.audit.at(-1)?.hash ?? null };
  state.audit.push(Object.freeze({ ...unsigned, hash: digestHex("YNX_WALLET_CENTRAL_AUDIT_V1", unsigned) }));
}

function inventorySession(session, state, asOf) {
  const inactiveReasons = [];
  if (session.issuedAt > asOf) inactiveReasons.push("issued-in-future");
  if (session.expiresAt <= asOf) inactiveReasons.push("expired");
  if (state.revokedSessionBindings.includes(session.sessionBinding)) inactiveReasons.push("session-revoked");
  if (state.revokedApprovalDigests.includes(session.approvalDigest)) inactiveReasons.push("approval-revoked");
  if (state.revokedDeviceBindings.includes(session.deviceBinding)) inactiveReasons.push("device-revoked");
  if (state.accountLogoutRecords.some((record) => record.account === session.account && session.issuedAt <= record.before)) inactiveReasons.push("account-logout");
  return Object.freeze({
    sessionBinding: session.sessionBinding,
    requestingProduct: session.requestingProduct,
    productClientId: session.productClientId,
    bundleId: session.bundleId,
    callback: session.callback,
    productDeviceAlgorithm: session.productDeviceAlgorithm,
    productDeviceKey: session.productDeviceKey,
    deviceBinding: session.deviceBinding,
    approvalDigest: session.approvalDigest,
    scopes: Object.freeze([...session.scopes]),
    purpose: session.purpose,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    active: inactiveReasons.length === 0,
    inactiveReasons: Object.freeze(inactiveReasons),
  });
}

function groupConnectedApps(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = `${session.productClientId}\n${session.bundleId}`;
    const current = groups.get(key) ?? {
      requestingProduct: session.requestingProduct,
      productClientId: session.productClientId,
      bundleId: session.bundleId,
      sessionBindings: [],
      activeSessionBindings: [],
      approvalDigests: [],
      deviceBindings: [],
    };
    current.sessionBindings.push(session.sessionBinding);
    if (session.active) current.activeSessionBindings.push(session.sessionBinding);
    current.approvalDigests.push(session.approvalDigest);
    current.deviceBindings.push(session.deviceBinding);
    groups.set(key, current);
  }
  return freezeGrouped(groups, (group) => ({ ...group, active: group.activeSessionBindings.length > 0 }));
}

function groupApprovals(sessions, revokedApprovalDigests) {
  const groups = new Map();
  for (const session of sessions) {
    const current = groups.get(session.approvalDigest) ?? {
      approvalDigest: session.approvalDigest,
      requestingProduct: session.requestingProduct,
      productClientId: session.productClientId,
      bundleId: session.bundleId,
      sessionBindings: [],
      activeSessionBindings: [],
    };
    current.sessionBindings.push(session.sessionBinding);
    if (session.active) current.activeSessionBindings.push(session.sessionBinding);
    groups.set(session.approvalDigest, current);
  }
  return freezeGrouped(groups, (group) => ({ ...group, revoked: revokedApprovalDigests.includes(group.approvalDigest) }));
}

function groupDevices(sessions, revokedDeviceBindings) {
  const groups = new Map();
  for (const session of sessions) {
    const current = groups.get(session.deviceBinding) ?? {
      deviceBinding: session.deviceBinding,
      requestingProduct: session.requestingProduct,
      productClientId: session.productClientId,
      bundleId: session.bundleId,
      productDeviceAlgorithm: session.productDeviceAlgorithm,
      productDeviceKey: session.productDeviceKey,
      sessionBindings: [],
      activeSessionBindings: [],
    };
    current.sessionBindings.push(session.sessionBinding);
    if (session.active) current.activeSessionBindings.push(session.sessionBinding);
    groups.set(session.deviceBinding, current);
  }
  return freezeGrouped(groups, (group) => ({ ...group, revoked: revokedDeviceBindings.includes(group.deviceBinding) }));
}

function freezeGrouped(groups, finalize) {
  const output = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => Object.freeze(finalize({
      ...group,
      sessionBindings: Object.freeze(uniqueSorted(group.sessionBindings)),
      activeSessionBindings: Object.freeze(uniqueSorted(group.activeSessionBindings)),
      ...(group.approvalDigests ? { approvalDigests: Object.freeze(uniqueSorted(group.approvalDigests)) } : {}),
      ...(group.deviceBindings ? { deviceBindings: Object.freeze(uniqueSorted(group.deviceBindings)) } : {}),
    })));
  return Object.freeze(output);
}

function uniqueSorted(values) { return [...new Set(values)].sort(); }

function sortState(state) {
  for (const field of ["consumedNonces", "consumedRequestDigests", "consumedChallenges", "revokedSessionBindings", "revokedApprovalDigests", "revokedDeviceBindings"]) state[field].sort();
  state.sessions.sort((a, b) => a.sessionBinding.localeCompare(b.sessionBinding));
  state.accountLogoutRecords.sort((a, b) => `${a.account}:${a.before}`.localeCompare(`${b.account}:${b.before}`));
}

function cloneSnapshot(state) { return JSON.parse(JSON.stringify(state)); }
function freezeSnapshot(state) { return Object.freeze({ ...state, consumedNonces: Object.freeze(state.consumedNonces), consumedRequestDigests: Object.freeze(state.consumedRequestDigests), consumedChallenges: Object.freeze(state.consumedChallenges), sessions: Object.freeze(state.sessions), revokedSessionBindings: Object.freeze(state.revokedSessionBindings), revokedApprovalDigests: Object.freeze(state.revokedApprovalDigests), revokedDeviceBindings: Object.freeze(state.revokedDeviceBindings), accountLogoutRecords: Object.freeze(state.accountLogoutRecords), audit: Object.freeze(state.audit) }); }
function sortedStrings(value, label, min, max, pattern) { if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => typeof item !== "string" || !pattern.test(item)) || new Set(value).size !== value.length || [...value].sort().join("\n") !== value.join("\n")) throw new WalletAuthError("INVALID_STORE", `${label} must be bounded, unique and sorted`); return [...value]; }
function strictDigest(value, label) { if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new WalletAuthError("INVALID_STORE", `${label} is invalid`); return value; }
function strictAccount(value) { if (typeof value !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value)) throw new WalletAuthError("INVALID_STORE", "account is invalid"); return value; }
function strictTime(value, label) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) throw new WalletAuthError("INVALID_STORE", `${label} is invalid`); return value; }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new WalletAuthError("INVALID_TIME", "Central Wallet time is invalid"); return value; }
