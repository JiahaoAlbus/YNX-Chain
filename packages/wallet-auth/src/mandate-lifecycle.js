import { digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { authorizeStrategyAction, parseStrategyMandate, strategyMandateDigest } from "./mandate.js";

export const STRATEGY_MANDATE_STORE_SCHEMA_VERSION = 1;

const SNAPSHOT_FIELDS = [
  "schemaVersion",
  "mandates",
  "revokedMandateDigests",
  "killedMandateDigests",
  "emergencyExits",
  "consumedActionNonces",
  "consumedActionDigests",
  "audit",
];
const EXIT_FIELDS = ["mandateDigest", "at", "reason"];
const AUDIT_FIELDS = ["sequence", "type", "subject", "at", "previousHash", "hash"];

export class StrategyMandateStore {
  #state;

  constructor(snapshot = emptySnapshot()) {
    this.#state = parseStrategyMandateStoreSnapshot(snapshot);
  }

  activate(mandateInput, at = new Date()) {
    const now = validDate(at);
    const mandate = parseStrategyMandate(mandateInput);
    const digest = strategyMandateDigest(mandate);
    const nowText = now.toISOString();
    if (nowText < mandate.issuedAt || nowText >= mandate.expiresAt) {
      fail("INACTIVE_MANDATE", "Strategy mandate is not active at activation time");
    }
    if (this.#state.mandates.some(item => item.mandateId === mandate.mandateId || strategyMandateDigest(item) === digest)) {
      fail("MANDATE_EXISTS", "Strategy mandate is already active in this store");
    }
    const next = clone(this.#state);
    next.mandates.push(mandate);
    sortState(next);
    appendAudit(next, "mandate-activated", digest, now);
    this.#state = parseStrategyMandateStoreSnapshot(next);
    return mandate;
  }

  authorize(mandateId, actionInput, at = new Date()) {
    const now = validDate(at);
    const mandate = this.#mandate(mandateId);
    const mandateDigest = strategyMandateDigest(mandate);
    const nowText = now.toISOString();
    if (nowText >= mandate.expiresAt) fail("INACTIVE_MANDATE", "Strategy mandate has expired");
    if (this.#state.revokedMandateDigests.includes(mandateDigest)) fail("MANDATE_REVOKED", "Strategy mandate was revoked");
    if (this.#state.emergencyExits.some(exit => exit.mandateDigest === mandateDigest)) fail("MANDATE_EXITED", "Strategy mandate completed an emergency exit");
    if (this.#state.killedMandateDigests.includes(mandateDigest)) fail("MANDATE_KILLED", "Strategy mandate kill switch is active");

    const authorized = authorizeStrategyAction(mandate, actionInput, now);
    const nonceKey = strategyActionNonceKey(authorized.nonceDomain, authorized.nonce);
    if (this.#state.consumedActionNonces.includes(nonceKey) || this.#state.consumedActionDigests.includes(authorized.actionDigest)) {
      fail("REPLAY", "Strategy action nonce or digest was already consumed");
    }
    if (this.#state.consumedActionNonces.length >= 100000) fail("CAPACITY", "Strategy action replay store reached its bound");

    const next = clone(this.#state);
    next.consumedActionNonces.push(nonceKey);
    next.consumedActionDigests.push(authorized.actionDigest);
    sortState(next);
    appendAudit(next, "strategy-action-authorized", authorized.actionDigest, now);
    this.#state = parseStrategyMandateStoreSnapshot(next);
    return authorized;
  }

  revoke(mandateId, at = new Date()) {
    return this.#terminal(mandateId, "revokedMandateDigests", "mandate-revoked", at, false);
  }

  kill(mandateId, at = new Date()) {
    return this.#terminal(mandateId, "killedMandateDigests", "mandate-killed", at, false);
  }

  emergencyExit(mandateId, reason, at = new Date()) {
    const now = validDate(at);
    const mandate = this.#mandate(mandateId);
    const mandateDigest = strategyMandateDigest(mandate);
    if (this.#state.revokedMandateDigests.includes(mandateDigest)) fail("MANDATE_REVOKED", "Revoked mandate cannot start an emergency exit");
    if (this.#state.emergencyExits.some(exit => exit.mandateDigest === mandateDigest)) fail("ALREADY_EXITED", "Strategy mandate already completed an emergency exit");
    const next = clone(this.#state);
    next.emergencyExits.push({ mandateDigest, at: now.toISOString(), reason: boundedReason(reason) });
    sortState(next);
    appendAudit(next, "mandate-emergency-exit", mandateDigest, now);
    this.#state = parseStrategyMandateStoreSnapshot(next);
    return Object.freeze(next.emergencyExits.find(exit => exit.mandateDigest === mandateDigest));
  }

  inventory(account, at = new Date()) {
    const now = validDate(at).toISOString();
    const normalizedAccount = strictAccount(account);
    return Object.freeze(this.#state.mandates
      .filter(mandate => mandate.account === normalizedAccount)
      .map(mandate => {
        const mandateDigest = strategyMandateDigest(mandate);
        let status = "active";
        if (this.#state.emergencyExits.some(exit => exit.mandateDigest === mandateDigest)) status = "emergency-exit";
        else if (this.#state.revokedMandateDigests.includes(mandateDigest)) status = "revoked";
        else if (this.#state.killedMandateDigests.includes(mandateDigest)) status = "killed";
        else if (now >= mandate.expiresAt) status = "expired";
        return Object.freeze({ mandate, mandateDigest, status });
      }));
  }

  snapshot() {
    return freezeSnapshot(clone(this.#state));
  }

  #mandate(mandateId) {
    const normalized = strictId(mandateId, "mandateId");
    const mandate = this.#state.mandates.find(item => item.mandateId === normalized);
    if (!mandate) fail("MANDATE_NOT_FOUND", "Strategy mandate was not found");
    return mandate;
  }

  #terminal(mandateId, field, type, at, allowKilled) {
    const now = validDate(at);
    const mandate = this.#mandate(mandateId);
    const mandateDigest = strategyMandateDigest(mandate);
    if (this.#state.revokedMandateDigests.includes(mandateDigest)) fail("MANDATE_REVOKED", "Strategy mandate was already revoked");
    if (!allowKilled && this.#state.killedMandateDigests.includes(mandateDigest)) fail("MANDATE_KILLED", "Strategy mandate kill switch is already active");
    if (this.#state.emergencyExits.some(exit => exit.mandateDigest === mandateDigest)) fail("MANDATE_EXITED", "Strategy mandate already completed an emergency exit");
    const next = clone(this.#state);
    next[field].push(mandateDigest);
    sortState(next);
    appendAudit(next, type, mandateDigest, now);
    this.#state = parseStrategyMandateStoreSnapshot(next);
    return mandateDigest;
  }
}

export function strategyActionNonceKey(nonceDomain, nonce) {
  return digestHex("YNX_WALLET_STRATEGY_ACTION_NONCE_V1", {
    nonceDomain: strictNonceDomain(nonceDomain),
    nonce: strictNonce(nonce),
  });
}

export function parseStrategyMandateStoreSnapshot(input) {
  exactFields(input, SNAPSHOT_FIELDS, "Strategy mandate store snapshot");
  if (input.schemaVersion !== STRATEGY_MANDATE_STORE_SCHEMA_VERSION) fail("INVALID_STORE", "Strategy mandate store schema is unsupported");
  const mandates = parseMandates(input.mandates);
  const mandateDigests = mandates.map(strategyMandateDigest);
  const revokedMandateDigests = sortedDigests(input.revokedMandateDigests, "revokedMandateDigests", mandateDigests);
  const killedMandateDigests = sortedDigests(input.killedMandateDigests, "killedMandateDigests", mandateDigests);
  const emergencyExits = parseEmergencyExits(input.emergencyExits, mandateDigests);
  if (revokedMandateDigests.some(digest => killedMandateDigests.includes(digest) || emergencyExits.some(exit => exit.mandateDigest === digest))) {
    fail("INVALID_STORE", "A revoked mandate cannot also be killed or emergency-exited");
  }
  const consumedActionNonces = sortedDigests(input.consumedActionNonces, "consumedActionNonces");
  const consumedActionDigests = sortedDigests(input.consumedActionDigests, "consumedActionDigests");
  if (consumedActionNonces.length !== consumedActionDigests.length) fail("INVALID_STORE", "Consumed strategy action nonce and digest counts must match");
  const audit = parseAudit(input.audit);
  return freezeSnapshot({
    schemaVersion: STRATEGY_MANDATE_STORE_SCHEMA_VERSION,
    mandates,
    revokedMandateDigests,
    killedMandateDigests,
    emergencyExits,
    consumedActionNonces,
    consumedActionDigests,
    audit,
  });
}

function emptySnapshot() {
  return {
    schemaVersion: STRATEGY_MANDATE_STORE_SCHEMA_VERSION,
    mandates: [],
    revokedMandateDigests: [],
    killedMandateDigests: [],
    emergencyExits: [],
    consumedActionNonces: [],
    consumedActionDigests: [],
    audit: [],
  };
}

function parseMandates(value) {
  if (!Array.isArray(value) || value.length > 10000) fail("INVALID_STORE", "mandates has an invalid item count");
  const mandates = value.map(parseStrategyMandate);
  const ids = mandates.map(mandate => mandate.mandateId);
  const digests = mandates.map(strategyMandateDigest);
  if (new Set(ids).size !== ids.length || new Set(digests).size !== digests.length || [...ids].sort().join("\n") !== ids.join("\n")) {
    fail("INVALID_STORE", "mandates must be unique and sorted by mandateId");
  }
  return Object.freeze(mandates);
}

function sortedDigests(value, label, allowed) {
  if (!Array.isArray(value) || value.length > 100000 || value.some(item => typeof item !== "string" || !/^[0-9a-f]{64}$/.test(item)) || new Set(value).size !== value.length || [...value].sort().join("\n") !== value.join("\n")) {
    fail("INVALID_STORE", `${label} must be bounded, unique and sorted`);
  }
  if (allowed && value.some(item => !allowed.includes(item))) fail("INVALID_STORE", `${label} references an unknown mandate`);
  return Object.freeze([...value]);
}

function parseEmergencyExits(value, mandateDigests) {
  if (!Array.isArray(value) || value.length > 10000) fail("INVALID_STORE", "emergencyExits has an invalid item count");
  const exits = value.map((exit, index) => {
    exactFields(exit, EXIT_FIELDS, `Strategy emergency exit ${index}`);
    const parsed = Object.freeze({
      mandateDigest: strictDigest(exit.mandateDigest, "mandateDigest"),
      at: strictTime(exit.at, "emergency exit at"),
      reason: boundedReason(exit.reason),
    });
    if (!mandateDigests.includes(parsed.mandateDigest)) fail("INVALID_STORE", "Emergency exit references an unknown mandate");
    return parsed;
  });
  const keys = exits.map(exit => exit.mandateDigest);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) fail("INVALID_STORE", "emergencyExits must be unique and sorted");
  return Object.freeze(exits);
}

function parseAudit(value) {
  if (!Array.isArray(value) || value.length > 200000) fail("INVALID_STORE", "audit has an invalid item count");
  let previousHash = null;
  return Object.freeze(value.map((event, index) => {
    exactFields(event, AUDIT_FIELDS, "Strategy mandate audit event");
    const unsigned = {
      sequence: event.sequence,
      type: event.type,
      subject: event.subject,
      at: event.at,
      previousHash: event.previousHash,
    };
    if (event.sequence !== index + 1 || typeof event.type !== "string" || !/^[a-z][a-z-]{2,63}$/.test(event.type) || typeof event.subject !== "string" || !/^[0-9a-f]{64}$/.test(event.subject) || strictTime(event.at, "audit at") !== event.at || event.previousHash !== previousHash || event.hash !== digestHex("YNX_WALLET_STRATEGY_AUDIT_V1", unsigned)) {
      fail("INVALID_STORE", "Strategy mandate audit hash chain is invalid");
    }
    previousHash = event.hash;
    return Object.freeze({ ...event });
  }));
}

function appendAudit(state, type, subject, at) {
  const unsigned = {
    sequence: state.audit.length + 1,
    type,
    subject,
    at: validDate(at).toISOString(),
    previousHash: state.audit.at(-1)?.hash ?? null,
  };
  state.audit.push({ ...unsigned, hash: digestHex("YNX_WALLET_STRATEGY_AUDIT_V1", unsigned) });
}

function sortState(state) {
  state.mandates.sort((left, right) => left.mandateId.localeCompare(right.mandateId));
  for (const field of ["revokedMandateDigests", "killedMandateDigests", "consumedActionNonces", "consumedActionDigests"]) state[field].sort();
  state.emergencyExits.sort((left, right) => left.mandateDigest.localeCompare(right.mandateDigest));
}

function freezeSnapshot(state) {
  return Object.freeze({
    ...state,
    mandates: Object.freeze(state.mandates.map(mandate => parseStrategyMandate(mandate))),
    revokedMandateDigests: Object.freeze([...state.revokedMandateDigests]),
    killedMandateDigests: Object.freeze([...state.killedMandateDigests]),
    emergencyExits: Object.freeze(state.emergencyExits.map(exit => Object.freeze({ ...exit }))),
    consumedActionNonces: Object.freeze([...state.consumedActionNonces]),
    consumedActionDigests: Object.freeze([...state.consumedActionDigests]),
    audit: Object.freeze(state.audit.map(event => Object.freeze({ ...event }))),
  });
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function strictId(value, label) { if (typeof value !== "string" || !/^[a-z][a-z0-9._-]{2,63}$/.test(value)) fail("INVALID_FIELD", `${label} is invalid`); return value; }
function strictDigest(value, label) { if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail("INVALID_FIELD", `${label} is invalid`); return value; }
function strictAccount(value) { if (typeof value !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value)) fail("INVALID_FIELD", "account is invalid"); return value; }
function strictNonceDomain(value) { if (typeof value !== "string" || !/^[a-z0-9][a-z0-9:._-]{15,255}$/.test(value)) fail("INVALID_FIELD", "nonceDomain is invalid"); return value; }
function strictNonce(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail("INVALID_FIELD", "nonce is invalid"); return value; }
function strictTime(value, label) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) fail("INVALID_TIME", `${label} is invalid`); return value; }
function boundedReason(value) { if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 300) fail("INVALID_FIELD", "emergency exit reason is invalid"); return value; }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Strategy mandate store time is invalid"); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
