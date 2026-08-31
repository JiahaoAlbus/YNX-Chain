import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { gatewayStateDigest } from "./gateway-http.js";
import { CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION } from "./gateway-node-host.js";

export const CANONICAL_GATEWAY_BACKUP_SCHEMA_VERSION = 1;
export const CANONICAL_GATEWAY_BACKUP_ALGORITHM = "aes-256-gcm";
const BACKUP_FIELDS = ["algorithm", "authTag", "ciphertext", "createdAt", "iv", "schemaVersion", "sourceStateDigest", "stateSchemaVersion"];
const STATE_FIELDS = ["schemaVersion", "snapshot", "stateDigest"];
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function decodeGatewayBackupKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new WalletAuthError("INVALID_BACKUP_KEY", "Canonical Gateway backup key must be canonical base64url for exactly 32 bytes");
  }
  let bytes;
  try { bytes = Buffer.from(value, "base64url"); } catch { throw new WalletAuthError("INVALID_BACKUP_KEY", "Canonical Gateway backup key is invalid"); }
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) throw new WalletAuthError("INVALID_BACKUP_KEY", "Canonical Gateway backup key is invalid");
  return bytes;
}

export function createGatewayStateBackup(options) {
  optionFields(options, ["backupPath", "key", "statePath"], ["now"], "Canonical Gateway backup create options");
  const statePath = absoluteFilePath(options.statePath, "Canonical Gateway state path");
  const backupPath = absoluteFilePath(options.backupPath, "Canonical Gateway backup path");
  if (statePath === backupPath) throw new WalletAuthError("INVALID_BACKUP_PATH", "Canonical Gateway backup path must differ from the state path");
  const key = backupKey(options.key);
  const state = readGatewayStateEnvelope(statePath);
  const createdAt = currentTime(options.now);
  const metadata = Object.freeze({
    algorithm: CANONICAL_GATEWAY_BACKUP_ALGORITHM,
    createdAt,
    schemaVersion: CANONICAL_GATEWAY_BACKUP_SCHEMA_VERSION,
    sourceStateDigest: state.stateDigest,
    stateSchemaVersion: state.schemaVersion,
  });
  const iv = randomBytes(12);
  const cipher = createCipheriv(CANONICAL_GATEWAY_BACKUP_ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(canonicalJSON(metadata), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonicalJSON(state), "utf8")), cipher.final()]);
  const envelope = Object.freeze({
    ...metadata,
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
  });
  const serialized = canonicalJSON(envelope);
  writeExclusiveSecureFile(backupPath, serialized, "Canonical Gateway backup", "BACKUP_EXISTS");
  return backupSummary(envelope, serialized);
}

export function verifyGatewayStateBackup(options) {
  optionFields(options, ["backupPath", "key"], ["maxAgeMs", "minimumCreatedAt", "now"], "Canonical Gateway backup verify options");
  const opened = openGatewayBackup(options);
  return Object.freeze({ ...backupSummary(opened.envelope, opened.serialized), verified: true });
}

export function restoreGatewayStateBackup(options) {
  optionFields(options, ["backupPath", "key", "statePath"], ["maxAgeMs", "minimumCreatedAt", "now"], "Canonical Gateway backup restore options");
  const statePath = absoluteFilePath(options.statePath, "Canonical Gateway restore state path");
  if (existsSync(statePath)) throw new WalletAuthError("RESTORE_TARGET_EXISTS", "Canonical Gateway restore target must not already exist");
  const opened = openGatewayBackup(options);
  const serializedState = canonicalJSON(opened.state);
  writeExclusiveSecureFile(statePath, serializedState, "Canonical Gateway restored state", "RESTORE_TARGET_EXISTS");
  const restored = readGatewayStateEnvelope(statePath);
  if (restored.stateDigest !== opened.state.stateDigest) throw new WalletAuthError("RESTORE_INTEGRITY", "Canonical Gateway restored state digest does not match the backup");
  return Object.freeze({
    ...backupSummary(opened.envelope, opened.serialized),
    restored: true,
    restoredStateDigest: restored.stateDigest,
  });
}

export function readGatewayStateEnvelope(value) {
  const statePath = absoluteFilePath(value, "Canonical Gateway state path");
  const serialized = readSecureFile(statePath, "Canonical Gateway state", MAX_BACKUP_BYTES);
  let state;
  try { state = JSON.parse(serialized); } catch { throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway state is invalid JSON"); }
  try { exactFields(state, STATE_FIELDS, "Canonical Gateway state"); } catch { throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway state envelope is invalid"); }
  if (canonicalJSON(state) !== serialized) throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway state must use canonical JSON");
  if (state.schemaVersion !== CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION || typeof state.stateDigest !== "string" || !/^[0-9a-f]{64}$/.test(state.stateDigest)) {
    throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway state envelope is invalid");
  }
  if (gatewayStateDigest(state.snapshot) !== state.stateDigest) throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway state digest is invalid");
  return Object.freeze({ schemaVersion: state.schemaVersion, snapshot: state.snapshot, stateDigest: state.stateDigest });
}

function openGatewayBackup(options) {
  const backupPath = absoluteFilePath(options.backupPath, "Canonical Gateway backup path");
  const key = backupKey(options.key);
  const serialized = readSecureFile(backupPath, "Canonical Gateway backup", MAX_BACKUP_BYTES);
  let envelope;
  try { envelope = JSON.parse(serialized); } catch { throw new WalletAuthError("BACKUP_TAMPERED", "Canonical Gateway backup is invalid JSON"); }
  try { exactFields(envelope, BACKUP_FIELDS, "Canonical Gateway backup"); } catch { throw new WalletAuthError("BACKUP_TAMPERED", "Canonical Gateway backup envelope is invalid"); }
  if (canonicalJSON(envelope) !== serialized) throw new WalletAuthError("BACKUP_TAMPERED", "Canonical Gateway backup must use canonical JSON");
  validateBackupMetadata(envelope, options);
  const iv = base64urlBytes(envelope.iv, 12, "backup IV");
  const authTag = base64urlBytes(envelope.authTag, 16, "backup authentication tag");
  const ciphertext = base64urlBytes(envelope.ciphertext, null, "backup ciphertext");
  if (ciphertext.length < 2 || ciphertext.length > MAX_BACKUP_BYTES) throw new WalletAuthError("BACKUP_TAMPERED", "Canonical Gateway backup ciphertext is outside policy");
  const metadata = Object.freeze({
    algorithm: envelope.algorithm,
    createdAt: envelope.createdAt,
    schemaVersion: envelope.schemaVersion,
    sourceStateDigest: envelope.sourceStateDigest,
    stateSchemaVersion: envelope.stateSchemaVersion,
  });
  let plaintext;
  try {
    const decipher = createDecipheriv(CANONICAL_GATEWAY_BACKUP_ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(canonicalJSON(metadata), "utf8"));
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new WalletAuthError("BACKUP_TAMPERED", "Canonical Gateway backup authentication failed");
  }
  let state;
  try { state = JSON.parse(plaintext); } catch { throw new WalletAuthError("BACKUP_TAMPERED", "Canonical Gateway backup payload is invalid JSON"); }
  try { exactFields(state, STATE_FIELDS, "Canonical Gateway backup state"); } catch { throw new WalletAuthError("BACKUP_TAMPERED", "Canonical Gateway backup state envelope is invalid"); }
  if (canonicalJSON(state) !== plaintext || state.schemaVersion !== CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION || state.schemaVersion !== envelope.stateSchemaVersion || typeof state.stateDigest !== "string" || state.stateDigest !== envelope.sourceStateDigest || gatewayStateDigest(state.snapshot) !== state.stateDigest) {
    throw new WalletAuthError("BACKUP_TAMPERED", "Canonical Gateway backup state integrity is invalid");
  }
  return Object.freeze({ envelope: Object.freeze(envelope), serialized, state: Object.freeze(state) });
}

function validateBackupMetadata(envelope, options) {
  if (envelope.schemaVersion !== CANONICAL_GATEWAY_BACKUP_SCHEMA_VERSION || envelope.algorithm !== CANONICAL_GATEWAY_BACKUP_ALGORITHM || envelope.stateSchemaVersion !== CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION || typeof envelope.sourceStateDigest !== "string" || !/^[0-9a-f]{64}$/.test(envelope.sourceStateDigest)) {
    throw new WalletAuthError("BACKUP_TAMPERED", "Canonical Gateway backup metadata is invalid");
  }
  const createdAt = canonicalTime(envelope.createdAt, "Canonical Gateway backup createdAt");
  const now = currentDate(options.now);
  if (createdAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) throw new WalletAuthError("BACKUP_FUTURE", "Canonical Gateway backup timestamp is in the future");
  if (options.minimumCreatedAt !== undefined) {
    const minimum = canonicalPolicyTime(options.minimumCreatedAt, "Canonical Gateway minimum backup time");
    if (createdAt.getTime() < minimum.getTime()) throw new WalletAuthError("BACKUP_ROLLBACK", "Canonical Gateway backup predates the accepted recovery point");
  }
  if (options.maxAgeMs !== undefined) {
    if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 0) throw new WalletAuthError("INVALID_BACKUP_POLICY", "Canonical Gateway maximum backup age is invalid");
    if (now.getTime() - createdAt.getTime() > options.maxAgeMs) throw new WalletAuthError("BACKUP_EXPIRED", "Canonical Gateway backup exceeds the accepted recovery-point age");
  }
}

function backupSummary(envelope, serialized) {
  return Object.freeze({
    algorithm: envelope.algorithm,
    backupBytes: Buffer.byteLength(serialized, "utf8"),
    backupSha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
    createdAt: envelope.createdAt,
    schemaVersion: envelope.schemaVersion,
    sourceStateDigest: envelope.sourceStateDigest,
    stateSchemaVersion: envelope.stateSchemaVersion,
  });
}

function backupKey(value) {
  if (!(value instanceof Uint8Array)) throw new WalletAuthError("INVALID_BACKUP_KEY", "Canonical Gateway backup key must contain exactly 32 bytes");
  const key = Buffer.from(value);
  if (key.length !== 32) throw new WalletAuthError("INVALID_BACKUP_KEY", "Canonical Gateway backup key must contain exactly 32 bytes");
  return key;
}

function optionFields(value, required, optional, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new WalletAuthError("INVALID_BACKUP_OPTIONS", `${label} are invalid`);
  const keys = Object.keys(value).sort();
  const accepted = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !accepted.has(key))) throw new WalletAuthError("INVALID_BACKUP_OPTIONS", `${label} have unknown or missing fields`);
  if (value.now !== undefined && typeof value.now !== "function") throw new WalletAuthError("INVALID_CLOCK", "Canonical Gateway backup clock is invalid");
}

function currentTime(now) { return currentDate(now).toISOString(); }
function currentDate(now) {
  const value = now === undefined ? new Date() : now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new WalletAuthError("INVALID_CLOCK", "Canonical Gateway backup clock is invalid");
  return value;
}
function canonicalTime(value, label) {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new WalletAuthError("BACKUP_TAMPERED", `${label} is invalid`);
  return new Date(parsed);
}
function canonicalPolicyTime(value, label) {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new WalletAuthError("INVALID_BACKUP_POLICY", `${label} is invalid`);
  return new Date(parsed);
}
function absoluteFilePath(value, label) {
  if (typeof value !== "string" || !isAbsolute(value) || value === "/") throw new WalletAuthError("INVALID_BACKUP_PATH", `${label} must be an absolute file path`);
  return value;
}
function readSecureFile(path, label, maximumBytes) {
  secureDirectoryInfo(dirname(path), label);
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size < 2 || info.size > maximumBytes) throw new WalletAuthError("BACKUP_PERMISSIONS", `${label} must be a private single-link regular file within the size policy`);
    return readFileSync(descriptor, "utf8");
  } catch (caught) {
    if (caught instanceof WalletAuthError) throw caught;
    throw new WalletAuthError("BACKUP_UNAVAILABLE", `${label} is unavailable`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
function writeExclusiveSecureFile(path, serialized, label, existsCode) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  secureDirectoryInfo(directory, label);
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, path);
    fsyncDirectory(directory);
  } catch (caught) {
    if (caught?.code === "EEXIST") throw new WalletAuthError(existsCode, `${label} already exists`);
    throw caught;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* temporary file may not exist */ }
  }
}
function secureDirectoryInfo(directory, label) {
  let info;
  try { info = lstatSync(directory); } catch { throw new WalletAuthError("BACKUP_UNAVAILABLE", `${label} directory is unavailable`); }
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new WalletAuthError("BACKUP_PERMISSIONS", `${label} directory must be a private non-symlink directory using mode 0700`);
  return info;
}
function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
function base64urlBytes(value, exactLength, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new WalletAuthError("BACKUP_TAMPERED", `Canonical Gateway ${label} is invalid`);
  let bytes;
  try { bytes = Buffer.from(value, "base64url"); } catch { throw new WalletAuthError("BACKUP_TAMPERED", `Canonical Gateway ${label} is invalid`); }
  if (bytes.toString("base64url") !== value || (exactLength !== null && bytes.length !== exactLength)) throw new WalletAuthError("BACKUP_TAMPERED", `Canonical Gateway ${label} is invalid`);
  return bytes;
}
