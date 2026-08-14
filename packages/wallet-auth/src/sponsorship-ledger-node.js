import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { evaluateSponsorship, parseSponsorshipRequest } from "./smart-account.js";

const STATE_FIELDS = ["consumed", "schemaVersion"];
const LOCK_FIELDS = ["acquiredAt", "pid", "schemaVersion", "token"];
const STATE_SCHEMA_VERSION = 1;
const LOCK_SCHEMA_VERSION = 1;
const MAXIMUM_CONSUMED = 100_000;
const MAXIMUM_STATE_BYTES = 32 * 1024 * 1024;
const STATE_LOCK_WAIT_MS = 2_000;
const STATE_LOCK_RETRY_MS = 5;
const MAXIMUM_LOCK_BYTES = 1024;

export class DurableSponsorshipAuthorizationLedger {
  #consumed;
  #maximumConsumed;
  #onCommitted;
  #statePath;

  constructor({ statePath, maximumConsumed = MAXIMUM_CONSUMED, onCommitted = () => {} } = {}) {
    this.#statePath = safeStatePath(statePath);
    this.#maximumConsumed = boundedInteger(maximumConsumed, "maximumConsumed", 1, MAXIMUM_CONSUMED);
    if (typeof onCommitted !== "function") fail("INVALID_CONFIG", "onCommitted must be a function");
    this.#onCommitted = onCommitted;
    const release = acquireLock(this.#statePath);
    try {
      const stored = load(this.#statePath, this.#maximumConsumed);
      this.#consumed = new Set(stored?.consumed ?? []);
      if (!stored) this.#persist();
    } finally { release(); }
  }

  get size() { return this.#consumed.size; }

  authorize(operationInput, requestInput, policyInput, bindingInput, at = new Date()) {
    const release = acquireLock(this.#statePath);
    let committed = false;
    let result;
    try {
      const stored = load(this.#statePath, this.#maximumConsumed);
      this.#consumed = new Set(stored.consumed);
      const request = parseSponsorshipRequest(requestInput);
      const key = replayKey(request);
      if (this.#consumed.has(key)) fail("SPONSORSHIP_REPLAY", "Sponsorship authorization nonce was already consumed");
      result = evaluateSponsorship(operationInput, request, policyInput, bindingInput, at);
      if (!result.eligible) return result;
      if (this.#consumed.size >= this.#maximumConsumed) fail("SPONSORSHIP_LEDGER_FULL", "Sponsorship authorization ledger reached its configured bound");
      this.#consumed.add(key);
      this.#persist();
      committed = true;
    } finally { release(); }
    if (committed) this.#onCommitted(Object.freeze({ size: this.#consumed.size }));
    return result;
  }

  #persist() {
    const consumed = [...this.#consumed].sort();
    persist(this.#statePath, { consumed, schemaVersion: STATE_SCHEMA_VERSION });
  }
}

export function recoverStaleSponsorshipStateLock(statePathInput, { minimumAgeMs } = {}) {
  const statePath = safeStatePath(statePathInput);
  boundedInteger(minimumAgeMs, "minimumAgeMs", 250, 86_400_000);
  load(statePath, MAXIMUM_CONSUMED);
  const lockPath = `${statePath}.lock`;
  const observed = readLock(lockPath);
  const ageMs = Date.now() - Date.parse(observed.record.acquiredAt);
  if (ageMs < minimumAgeMs) fail("SPONSORSHIP_STALE_LOCK_TOO_YOUNG", "Sponsorship authorization state lock is not old enough for recovery");
  if (processIsAlive(observed.record.pid)) fail("SPONSORSHIP_STALE_LOCK_OWNER_ALIVE", "Sponsorship authorization state lock owner is still alive");
  const current = readLock(lockPath);
  if (current.dev !== observed.dev || current.ino !== observed.ino || current.record.token !== observed.record.token || current.record.pid !== observed.record.pid) {
    fail("SPONSORSHIP_STALE_LOCK_CHANGED", "Sponsorship authorization state lock changed during recovery");
  }
  try {
    unlinkSync(lockPath);
    syncDirectory(dirname(statePath));
  } catch { fail("SPONSORSHIP_STATE_LOCK_FAILED", "Sponsorship authorization state lock could not be recovered"); }
  return Object.freeze({ ageMs, ownerPid: observed.record.pid, recovered: true });
}

function acquireLock(statePath) {
  const lockPath = `${statePath}.lock`;
  const deadline = Date.now() + STATE_LOCK_WAIT_MS;
  let descriptor;
  const record = Object.freeze({ acquiredAt: new Date().toISOString(), pid: process.pid, schemaVersion: LOCK_SCHEMA_VERSION, token: randomUUID() });
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(descriptor, `${canonicalJSON(record)}\n`, { encoding: "utf8" });
      fsyncSync(descriptor);
    }
    catch (error) {
      if (descriptor !== undefined) { closeSync(descriptor); descriptor = undefined; try { unlinkSync(lockPath); } catch {} }
      if (error?.code !== "EEXIST") fail("SPONSORSHIP_STATE_LOCK_FAILED", "Sponsorship authorization state lock could not be acquired");
      if (Date.now() >= deadline) fail("SPONSORSHIP_STATE_LOCKED", "Sponsorship authorization state is locked");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STATE_LOCK_RETRY_MS);
    }
  }
  return () => {
    closeSync(descriptor);
    try {
      const current = readLock(lockPath);
      if (current.record.pid !== record.pid || current.record.token !== record.token) fail("SPONSORSHIP_STATE_LOCK_FAILED", "Sponsorship authorization state lock ownership changed");
      unlinkSync(lockPath);
      syncDirectory(dirname(statePath));
    }
    catch { fail("SPONSORSHIP_STATE_LOCK_FAILED", "Sponsorship authorization state lock could not be released"); }
  };
}

function readLock(path) {
  let metadata;
  try { metadata = lstatSync(path); } catch { fail("SPONSORSHIP_STALE_LOCK_INVALID", "Sponsorship authorization state lock is invalid"); }
  validateFile(metadata);
  if (metadata.size > MAXIMUM_LOCK_BYTES) fail("SPONSORSHIP_STALE_LOCK_INVALID", "Sponsorship authorization state lock is invalid");
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    validateFile(opened);
    if (opened.size !== metadata.size || opened.ino !== metadata.ino || opened.dev !== metadata.dev) fail("SPONSORSHIP_STALE_LOCK_INVALID", "Sponsorship authorization state lock changed while reading");
    const raw = readFileSync(descriptor, "utf8");
    let record;
    try { record = JSON.parse(raw); } catch { fail("SPONSORSHIP_STALE_LOCK_INVALID", "Sponsorship authorization state lock is invalid"); }
    if (`${canonicalJSON(record)}\n` !== raw) fail("SPONSORSHIP_STALE_LOCK_INVALID", "Sponsorship authorization state lock is not canonical JSON");
    exactFields(record, LOCK_FIELDS, "Sponsorship authorization state lock");
    if (record.schemaVersion !== LOCK_SCHEMA_VERSION || !Number.isSafeInteger(record.pid) || record.pid < 1 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.acquiredAt) || !Number.isFinite(Date.parse(record.acquiredAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.token)) fail("SPONSORSHIP_STALE_LOCK_INVALID", "Sponsorship authorization state lock fields are invalid");
    return Object.freeze({ dev: opened.dev, ino: opened.ino, record: Object.freeze(record) });
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function load(path, maximumConsumed) {
  let metadata;
  try { metadata = lstatSync(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw unsafe(); }
  validateFile(metadata);
  if (metadata.size > MAXIMUM_STATE_BYTES) fail("SPONSORSHIP_STATE_TOO_LARGE", "Sponsorship authorization state exceeds its configured bound");
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    validateFile(opened);
    if (opened.size !== metadata.size || opened.ino !== metadata.ino || opened.dev !== metadata.dev) throw unsafe();
    const raw = readFileSync(descriptor, "utf8");
    let parsed;
    try { parsed = JSON.parse(raw); } catch { fail("SPONSORSHIP_STATE_INVALID", "Sponsorship authorization state is invalid"); }
    if (`${canonicalJSON(parsed)}\n` !== raw) fail("SPONSORSHIP_STATE_INVALID", "Sponsorship authorization state is not canonical JSON");
    exactFields(parsed, STATE_FIELDS, "Sponsorship authorization state");
    if (parsed.schemaVersion !== STATE_SCHEMA_VERSION || !Array.isArray(parsed.consumed) || parsed.consumed.length > maximumConsumed) fail("SPONSORSHIP_STATE_INVALID", "Sponsorship authorization state schema is invalid");
    const consumed = parsed.consumed.map(replayKeyString);
    if (new Set(consumed).size !== consumed.length || consumed.join("\n") !== [...consumed].sort().join("\n")) fail("SPONSORSHIP_STATE_INVALID", "Sponsorship authorization state entries are invalid");
    return Object.freeze({ consumed: Object.freeze(consumed) });
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function persist(path, state) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, `${canonicalJSON(state)}\n`, { encoding: "utf8" });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch {}
    if (error instanceof WalletAuthError) throw error;
    fail("SPONSORSHIP_STATE_PERSISTENCE_FAILED", "Sponsorship authorization state could not be persisted");
  }
}

function safeStatePath(value) {
  if (typeof value !== "string" || !isAbsolute(value) || value.length > 4096 || value.includes("\0")) fail("INVALID_CONFIG", "statePath must be a bounded absolute path");
  const parent = dirname(value);
  let metadata;
  try { metadata = statSync(parent); } catch { throw unsafe(); }
  if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0 || realpathSync(parent) !== parent) throw unsafe();
  return value;
}
function syncDirectory(path) { const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
function processIsAlive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; return true; } }
function validateFile(metadata) { if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600) throw unsafe(); }
function replayKey(request) { return `${request.account}:${request.productClientId}:${request.requestNonce}`; }
function replayKeyString(value) { if (typeof value !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}:[a-z][a-z0-9._-]{2,63}:[0-9a-f]{64}$/.test(value)) fail("SPONSORSHIP_STATE_INVALID", "Sponsorship authorization state entry is invalid"); return value; }
function boundedInteger(value, label, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_NUMBER", `${label} is outside its allowed range`); return value; }
function unsafe() { return new WalletAuthError("SPONSORSHIP_STATE_UNSAFE", "Sponsorship authorization state path is unsafe"); }
function fail(code, message) { throw new WalletAuthError(code, message); }
