import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { evaluateSponsorship, parseSponsorshipRequest } from "./smart-account.js";

const STATE_FIELDS = ["consumed", "schemaVersion"];
const STATE_SCHEMA_VERSION = 1;
const MAXIMUM_CONSUMED = 100_000;
const MAXIMUM_STATE_BYTES = 32 * 1024 * 1024;
const STATE_LOCK_WAIT_MS = 2_000;
const STATE_LOCK_RETRY_MS = 5;

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

function acquireLock(statePath) {
  const lockPath = `${statePath}.lock`;
  const deadline = Date.now() + STATE_LOCK_WAIT_MS;
  let descriptor;
  while (descriptor === undefined) {
    try { descriptor = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if (error?.code !== "EEXIST") fail("SPONSORSHIP_STATE_LOCK_FAILED", "Sponsorship authorization state lock could not be acquired");
      if (Date.now() >= deadline) fail("SPONSORSHIP_STATE_LOCKED", "Sponsorship authorization state is locked");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STATE_LOCK_RETRY_MS);
    }
  }
  return () => {
    closeSync(descriptor);
    try { unlinkSync(lockPath); }
    catch { fail("SPONSORSHIP_STATE_LOCK_FAILED", "Sponsorship authorization state lock could not be released"); }
  };
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
    const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
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
function validateFile(metadata) { if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600) throw unsafe(); }
function replayKey(request) { return `${request.account}:${request.productClientId}:${request.requestNonce}`; }
function replayKeyString(value) { if (typeof value !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}:[a-z][a-z0-9._-]{2,63}:[0-9a-f]{64}$/.test(value)) fail("SPONSORSHIP_STATE_INVALID", "Sponsorship authorization state entry is invalid"); return value; }
function boundedInteger(value, label, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_NUMBER", `${label} is outside its allowed range`); return value; }
function unsafe() { return new WalletAuthError("SPONSORSHIP_STATE_UNSAFE", "Sponsorship authorization state path is unsafe"); }
function fail(code, message) { throw new WalletAuthError(code, message); }
