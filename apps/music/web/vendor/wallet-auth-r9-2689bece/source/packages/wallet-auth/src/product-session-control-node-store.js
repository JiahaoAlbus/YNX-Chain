import * as filesystem from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { parseProductSessionGatewaySnapshot } from "./product-session-gateway-snapshot-v2.js";
import { migrateProductSessionControlSnapshotV2, parseProductSessionControlSnapshot } from "./product-session-control-intent.js";
import { inspectProductSessionControlCapacity, parseProductSessionControlCapacityPolicy, productSessionControlPublicCapacityPolicy } from "./product-session-control-capacity.js";

export const PRODUCT_SESSION_CONTROL_NODE_SCHEMA_VERSION = 2;
const MAX_BYTES = 32 * 1024 * 1024;
const digest = value => createHash("sha256").update(typeof value === "string" ? value : canonicalJSON(value)).digest("hex");

export function parseProductSessionControlPersistedState(raw) {
  try {
    const envelope = parseEnvelope(raw, PRODUCT_SESSION_CONTROL_NODE_SCHEMA_VERSION);
    return Object.freeze({ ...envelope, snapshot: parseProductSessionControlSnapshot(envelope.snapshot) });
  } catch { fail("STATE_TAMPERED", "Version-three persisted state failed complete schema and digest validation"); }
}

/** Read-only preflight: safe on current V2 bytes while its atomic writer runs. */
export function inspectProductSessionControlStateFile({ statePath, capacityPolicy }, io = filesystem) {
  const path = absolute(statePath), policy = parseProductSessionControlCapacityPolicy(capacityPolicy);
  safeDirectory(path, io, false);
  const loaded = readOwned(path, io);
  if (!loaded) fail("STATE_NOT_FOUND", "Capacity preflight requires an existing state file");
  let version; try { version = JSON.parse(loaded.raw).schemaVersion; } catch { fail("STATE_TAMPERED", "Capacity preflight state is invalid JSON"); }
  const snapshot = version === 1
    ? migrateProductSessionControlSnapshotV2(parseProductSessionGatewaySnapshot(parseEnvelope(loaded.raw, 1).snapshot))
    : parseProductSessionControlPersistedState(loaded.raw).snapshot;
  const capacity = inspectProductSessionControlCapacity(snapshot, policy);
  return Object.freeze({ readOnly: true, sourceSHA256: digest(loaded.raw), sourceBytes: loaded.identity.size, sourceEnvelopeVersion: version, snapshotSchemaVersion: version === 1 ? 2 : 3, admittedOwners: capacity.admittedOwners, storedIntents: snapshot.controlIntents.length, reservedIntents: capacity.reservedIntents, overReserved: capacity.overReserved, sessions: snapshot.authority.sessions.length, issuedChallenges: snapshot.authority.issuedChallenges.length, policy: productSessionControlPublicCapacityPolicy(policy) });
}

/** One synchronous writer transaction owns decision, persistence and readback. */
export class ProductSessionControlNodeStore {
  #path; #io; #identity; #pending = null; #busy = false;
  constructor({ statePath, io = filesystem }) {
    this.#path = absolute(statePath); this.#io = io;
    const loaded = readState(this.#path, this.#io);
    if (!loaded) fail("STATE_NOT_FOUND", "Version-three state must be explicitly initialized or migrated before startup");
    safeDirectory(this.#path, this.#io, false);
    this.#adopt(loaded);
  }
  snapshot() { return this.#readLatest().snapshot; }
  transact(action) {
    if (this.#busy) fail("STATE_WRITER_BUSY", "The control state writer is already executing a transaction");
    this.#busy = true;
    try {
      const before = this.#readLatest(), prepared = action(before.snapshot);
      exactFields(prepared, ["snapshot", "value"], "Control writer candidate");
      const next = parseProductSessionControlSnapshot(prepared.snapshot);
      const durable = this.#commit(next);
      return Object.freeze({ value: prepared.value, snapshot: durable.snapshot });
    } finally { this.#busy = false; }
  }
  #adopt(loaded) { this.#identity = loaded.identity; this.#pending = null; }
  #readLatest() {
    let loaded;
    try { safeDirectory(this.#path, this.#io, false); loaded = readState(this.#path, this.#io); }
    catch (error) {
      if (error instanceof WalletAuthError && error.code !== "STATE_READ_FAILED") throw error;
      fail(this.#pending ? "STATE_DURABILITY_UNCERTAIN" : "STATE_READ_FAILED", "The latest control state cannot be read; no revocation confirmation is available");
    }
    if (!loaded) fail("STATE_TAMPERED", "Control state disappeared; an empty state must not replace it");
    if (this.#pending) {
      if (sameIdentity(loaded.identity, this.#pending.before)) {
        // The rename did not take effect. Preserve the original durable state;
        // no earlier cutoff was established by the abandoned preparation.
        this.#adopt(loaded); return loaded;
      }
      if (loaded.snapshotDigest !== this.#pending.digest || !sameIdentity(loaded.identity, this.#pending.after)) fail("STATE_TAMPERED", "Control state differs from both sides of the interrupted write");
      // Own rename may have succeeded before directory sync/readback failed.
      // Re-establish durability of those exact latest bytes, never write back
      // the older in-memory snapshot. A failed recovery still confirms nothing.
      const observed = loaded.identity;
      try { syncExisting(this.#path, this.#io); loaded = readState(this.#path, this.#io); }
      catch { fail("STATE_DURABILITY_UNCERTAIN", "The latest control state still cannot be confirmed durably; retry the same intent"); }
      if (!loaded || !sameIdentity(observed, loaded.identity)) fail("STATE_TAMPERED", "Control state changed during interrupted-write recovery");
      this.#adopt(loaded); return loaded;
    }
    if (!sameIdentity(loaded.identity, this.#identity)) fail("STATE_TAMPERED", "Control state identity changed outside the writer");
    return loaded;
  }
  #commit(snapshot) {
    const before = this.#readLatest(), encoded = encodeState(snapshot);
    if (digest(snapshot) === before.snapshotDigest) return before;
    const directory = safeDirectory(this.#path, this.#io), temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = this.#io.openSync(temporary, filesystem.constants.O_WRONLY | filesystem.constants.O_CREAT | filesystem.constants.O_EXCL | noFollow(), 0o600);
      this.#io.writeFileSync(descriptor, encoded, "utf8"); this.#io.fchmodSync(descriptor, 0o600); this.#io.fsyncSync(descriptor);
      const written = this.#io.fstatSync(descriptor); safeStat(written); this.#io.closeSync(descriptor); descriptor = undefined;
      // Identity is checked immediately before the only live-file mutation.
      if (!sameIdentity(readState(this.#path, this.#io)?.identity, before.identity)) fail("STATE_TAMPERED", "Control state changed before commit");
      this.#pending = { before: before.identity, digest: digest(snapshot), after: { dev: written.dev, ino: written.ino, size: written.size, digest: digest(encoded) } };
      this.#io.renameSync(temporary, this.#path);
      syncDirectory(directory, this.#io);
      const loaded = readState(this.#path, this.#io);
      if (!loaded || loaded.snapshotDigest !== this.#pending.digest || !sameIdentity(loaded.identity, this.#pending.after)) fail("STATE_TAMPERED", "Control state did not read back as its exact candidate");
      this.#adopt(loaded); return loaded;
    } catch (error) {
      if (this.#pending) fail("STATE_DURABILITY_UNCERTAIN", "Control state persistence may have committed; retry the same intent to learn its outcome");
      if (error instanceof WalletAuthError && error.code.startsWith("STATE_")) throw error;
      fail("STATE_WRITE_FAILED", "Control state could not be saved; no revocation confirmation is available");
    } finally {
      if (descriptor !== undefined) this.#io.closeSync(descriptor);
      // An unlinked temporary is never a live state. Cleanup failure must not
      // replace the precise commit/unknown outcome or restore older bytes.
      try { this.#io.unlinkSync(temporary); } catch {}
    }
  }
}

/** Explicit creation only. A serving host never silently creates missing state. */
export function initializeProductSessionControlState(statePath, snapshot, io = filesystem) {
  const path = absolute(statePath), encoded = encodeState(parseProductSessionControlSnapshot(snapshot));
  writeExclusive(path, encoded, io);
  const loaded = readState(path, io);
  if (!loaded || loaded.snapshotDigest !== digest(snapshot)) fail("STATE_TAMPERED", "Initialized control state did not read back exactly");
  return Object.freeze({ snapshotDigest: loaded.snapshotDigest });
}

/** Caller must stop every source writer and hold its release lock throughout. */
export function migrateProductSessionControlStateFileV2({ sourcePath, targetPath, backupPath, expectedSourceDigest }, io = filesystem) {
  const source = absolute(sourcePath), target = absolute(targetPath), backup = absolute(backupPath);
  if (new Set([source, target, backup]).size !== 3 || !/^[0-9a-f]{64}$/.test(expectedSourceDigest)) fail("INVALID_STATE_MIGRATION", "Offline migration requires three distinct paths and an exact stopped source digest");
  const before = readOwned(source, io);
  if (!before || digest(before.raw) !== expectedSourceDigest) fail("STATE_TAMPERED", "Offline migration source is missing or differs from the expected stopped bytes");
  const old = parseEnvelope(before.raw, 1), snapshot = migrateProductSessionControlSnapshotV2(parseProductSessionGatewaySnapshot(old.snapshot));
  // O_EXCL prevents overwriting either an earlier backup or a latest v3 state.
  if (io.existsSync(target) || io.existsSync(backup)) fail("STATE_TARGET_EXISTS", "Migration never overwrites an existing target or backup");
  writeExclusive(backup, before.raw, io);
  if (!sameIdentity(readOwned(source, io)?.identity, before.identity)) fail("STATE_TAMPERED", "Source changed while preserving its migration backup; do not activate the target");
  initializeProductSessionControlState(target, snapshot, io);
  if (!sameIdentity(readOwned(source, io)?.identity, before.identity)) fail("STATE_TAMPERED", "Source was not quiescent throughout migration; do not activate the target");
  return Object.freeze({ sourceDigest: expectedSourceDigest, backupDigest: digest(readOwned(backup, io).raw), targetDigest: readState(target, io).snapshotDigest, snapshotSchemaVersion: 3, rollbackRequiresVersionThree: true });
}

function encodeState(snapshot) {
  const encoded = canonicalJSON({ schemaVersion: PRODUCT_SESSION_CONTROL_NODE_SCHEMA_VERSION, snapshotDigest: digest(snapshot), snapshot });
  if (Buffer.byteLength(encoded) > MAX_BYTES) fail("STATE_CAPACITY", "Control state exceeds the durable file capacity");
  return encoded;
}
function parseEnvelope(raw, version) {
  let value; try { value = JSON.parse(raw); } catch { fail("STATE_TAMPERED", "Control state is not valid JSON"); }
  exactFields(value, ["schemaVersion", "snapshotDigest", "snapshot"], "Product Session persisted state");
  if (value.schemaVersion !== version || !/^[0-9a-f]{64}$/.test(value.snapshotDigest) || digest(value.snapshot) !== value.snapshotDigest || canonicalJSON(value) !== raw) fail("STATE_TAMPERED", "Persisted state schema or canonical digest is invalid; explicit migration is required");
  return value;
}
function readState(path, io) {
  const loaded = readOwned(path, io); if (!loaded) return null;
  const envelope = parseProductSessionControlPersistedState(loaded.raw);
  return { ...envelope, identity: loaded.identity };
}
function readOwned(path, io) {
  let descriptor;
  try { descriptor = io.openSync(path, filesystem.constants.O_RDONLY | noFollow()); }
  catch (error) { if (error?.code === "ENOENT") return null; if (error?.code === "ELOOP") fail("STATE_PERMISSIONS", "Control state cannot be a symbolic link"); throw error; }
  try {
    const stat = io.fstatSync(descriptor); safeStat(stat);
    const raw = io.readFileSync(descriptor, "utf8");
    return { raw, identity: { dev: stat.dev, ino: stat.ino, size: stat.size, digest: digest(raw) } };
  } finally { io.closeSync(descriptor); }
}
function safeStat(stat) {
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES || !owned(stat)) fail("STATE_PERMISSIONS", "Control state must be one owner-bound mode-0600 regular file");
}
function safeDirectory(path, io, create = true) {
  const directory = dirname(path); if (create) io.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = io.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || !owned(stat)) fail("STATE_PERMISSIONS", "Control state directory must be a real owner-bound mode-0700 directory");
  return directory;
}
function writeExclusive(path, raw, io) {
  const directory = safeDirectory(path, io); let descriptor;
  try {
    descriptor = io.openSync(path, filesystem.constants.O_WRONLY | filesystem.constants.O_CREAT | filesystem.constants.O_EXCL | noFollow(), 0o600);
    io.writeFileSync(descriptor, raw, "utf8"); io.fsyncSync(descriptor); safeStat(io.fstatSync(descriptor));
    io.closeSync(descriptor); descriptor = undefined; syncDirectory(directory, io);
    if (readOwned(path, io)?.raw !== raw) fail("STATE_TAMPERED", "Explicit state copy did not read back exactly");
  } finally { if (descriptor !== undefined) io.closeSync(descriptor); }
}
function syncExisting(path, io) {
  const descriptor = io.openSync(path, filesystem.constants.O_RDWR | noFollow());
  try { safeStat(io.fstatSync(descriptor)); io.fsyncSync(descriptor); } finally { io.closeSync(descriptor); }
  syncDirectory(safeDirectory(path, io), io);
}
function syncDirectory(path, io) { const descriptor = io.openSync(path, filesystem.constants.O_RDONLY); try { io.fsyncSync(descriptor); } finally { io.closeSync(descriptor); } }
function owned(stat) { return typeof process.getuid !== "function" || stat.uid === process.getuid(); }
function sameIdentity(a, b) { return Boolean(a && b && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.digest === b.digest); }
function absolute(path) { if (typeof path !== "string" || !isAbsolute(path) || path === "/" || resolve(path) !== path) fail("INVALID_STATE_PATH", "Control state requires a canonical absolute file path"); return path; }
function noFollow() { return filesystem.constants.O_NOFOLLOW ?? 0; }
function fail(code, message) { throw new WalletAuthError(code, message); }
