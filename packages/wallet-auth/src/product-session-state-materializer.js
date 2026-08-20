import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, fchmodSync, fchownSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";

const INPUT_FIELDS = ["expectedRegistryStateBindingSha256", "expectedSourceStateFileSha256", "outputGid", "outputPath", "outputUid", "sourcePath"];
const STATE_FIELDS = ["registrySha256", "schemaVersion", "snapshot", "snapshotSha256"];
const MAXIMUM_STATE_BYTES = 64 * 1024 * 1024;

const NODE_SYSTEM = Object.freeze({
  close: closeSync,
  effectiveUid: () => process.geteuid?.() ?? process.getuid(),
  fchmod: fchmodSync,
  fchown: fchownSync,
  fstat: fstatSync,
  fsync: fsyncSync,
  lstat: lstatSync,
  open: openSync,
  read: (descriptor) => readFileSync(descriptor, "utf8"),
  rename: renameSync,
  unlink: unlinkSync,
  write: (descriptor, bytes) => writeFileSync(descriptor, bytes, "utf8"),
});

export function materializeMigratedProductSessionState(input) {
  return materializeMigratedProductSessionStateWithSystem(input, NODE_SYSTEM);
}

export function materializeMigratedProductSessionStateWithSystem(input, system) {
  exactFields(input, INPUT_FIELDS, "Product Session migrated-state materialization input");
  validateInput(input);
  if (system.effectiveUid() !== 0) fail("PRIVILEGE_REQUIRED", "Migrated Product Session state materialization requires an effective root identity");
  const sourceInfo = system.lstat(input.sourcePath);
  requirePrivateFile(sourceInfo, 0, 0, "source");
  if (sourceInfo.size < 2 || sourceInfo.size > MAXIMUM_STATE_BYTES) fail("UNSAFE_MIGRATED_STATE", "Migrated Product Session source size is outside policy");
  const sourceDescriptor = system.open(input.sourcePath, constants.O_RDONLY | noFollow());
  let sourceBytes;
  try {
    const opened = system.fstat(sourceDescriptor);
    requirePrivateFile(opened, 0, 0, "opened source");
    if (opened.dev !== sourceInfo.dev || opened.ino !== sourceInfo.ino || opened.size !== sourceInfo.size) fail("SOURCE_CHANGED", "Migrated Product Session source changed during privileged open");
    sourceBytes = system.read(sourceDescriptor);
    if (Buffer.byteLength(sourceBytes) !== opened.size) fail("SOURCE_CHANGED", "Migrated Product Session source size changed during privileged read");
  } finally { system.close(sourceDescriptor); }
  validateSourceBytes(sourceBytes, input.expectedSourceStateFileSha256, input.expectedRegistryStateBindingSha256);

  const parent = dirname(input.outputPath), directory = system.lstat(parent);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== input.outputUid || directory.gid !== input.outputGid || (directory.mode & 0o777) !== 0o700) {
    fail("UNSAFE_OUTPUT_DIRECTORY", "Product Session output directory must be the target service identity's private mode-0700 directory");
  }
  try { system.lstat(input.outputPath); fail("OUTPUT_EXISTS", "Product Session materializer never overwrites an output state file"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }

  const temporary = join(parent, `.materialize-${process.pid}-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = system.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow(), 0o600);
    system.write(descriptor, sourceBytes);
    system.fchown(descriptor, input.outputUid, input.outputGid);
    system.fchmod(descriptor, 0o600);
    system.fsync(descriptor);
    const temporaryOpened = system.fstat(descriptor);
    requirePrivateFile(temporaryOpened, input.outputUid, input.outputGid, "temporary output");
    system.close(descriptor); descriptor = undefined;
    const temporaryPath = system.lstat(temporary);
    requirePrivateFile(temporaryPath, input.outputUid, input.outputGid, "temporary output path");
    if (temporaryPath.dev !== temporaryOpened.dev || temporaryPath.ino !== temporaryOpened.ino) fail("OUTPUT_CHANGED", "Materialized Product Session temporary output changed before rename");
    system.rename(temporary, input.outputPath);
    const directoryDescriptor = system.open(parent, constants.O_RDONLY | directoryFlag() | noFollow());
    try { system.fsync(directoryDescriptor); } finally { system.close(directoryDescriptor); }
    verifyOutput(system, input, sourceBytes);
  } finally {
    if (descriptor !== undefined) system.close(descriptor);
    try { system.unlink(temporary); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return Object.freeze({
    bytes: Buffer.byteLength(sourceBytes),
    mode: "0600",
    outputGid: input.outputGid,
    outputUid: input.outputUid,
    registryStateBindingSha256: input.expectedRegistryStateBindingSha256,
    schemaVersion: 1,
    stateFileSha256: input.expectedSourceStateFileSha256,
  });
}

function validateInput(input) {
  if (!isAbsolute(input.sourcePath) || !isAbsolute(input.outputPath) || input.sourcePath === input.outputPath) fail("INVALID_PATH", "Materialization paths must be distinct absolute paths");
  for (const key of ["expectedSourceStateFileSha256", "expectedRegistryStateBindingSha256"]) if (!/^[0-9a-f]{64}$/.test(input[key])) fail("INVALID_DIGEST", "Materialization digests must be lowercase SHA-256 values");
  for (const key of ["outputUid", "outputGid"]) if (!Number.isSafeInteger(input[key]) || input[key] < 1) fail("INVALID_IDENTITY", "Materialization target identity must be a positive numeric uid and gid");
}

function validateSourceBytes(bytes, expectedFileSha256, expectedRegistrySha256) {
  if (typeof bytes !== "string" || sha256(bytes) !== expectedFileSha256) fail("SOURCE_DIGEST_MISMATCH", "Migrated Product Session source does not match its reviewed file digest");
  let parsed;
  try { parsed = JSON.parse(bytes); } catch { fail("INVALID_MIGRATED_STATE", "Migrated Product Session source is not JSON"); }
  exactFields(parsed, STATE_FIELDS, "Migrated Product Session state envelope");
  if (`${canonicalJSON(parsed)}\n` !== bytes || parsed.schemaVersion !== 1 || parsed.registrySha256 !== expectedRegistrySha256 || !/^[0-9a-f]{64}$/.test(parsed.snapshotSha256) || parsed.snapshotSha256 !== sha256(canonicalJSON(parsed.snapshot))) {
    fail("INVALID_MIGRATED_STATE", "Migrated Product Session source failed canonical registry and snapshot binding verification");
  }
}

function verifyOutput(system, input, sourceBytes) {
  const info = system.lstat(input.outputPath);
  requirePrivateFile(info, input.outputUid, input.outputGid, "output");
  if (info.size !== Buffer.byteLength(sourceBytes)) fail("OUTPUT_MISMATCH", "Materialized Product Session state size changed");
  const descriptor = system.open(input.outputPath, constants.O_RDONLY | noFollow());
  try {
    const opened = system.fstat(descriptor);
    requirePrivateFile(opened, input.outputUid, input.outputGid, "opened output");
    if (opened.dev !== info.dev || opened.ino !== info.ino || sha256(system.read(descriptor)) !== input.expectedSourceStateFileSha256) fail("OUTPUT_MISMATCH", "Materialized Product Session state did not read back exactly");
  } finally { system.close(descriptor); }
}

function requirePrivateFile(info, uid, gid, label) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== uid || info.gid !== gid || (info.mode & 0o777) !== 0o600) fail("UNSAFE_MIGRATED_STATE", `Migrated Product Session ${label} must be one owner-bound mode-0600 regular file`);
}
function noFollow() { return constants.O_NOFOLLOW ?? 0; }
function directoryFlag() { return constants.O_DIRECTORY ?? 0; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function fail(code, message) { throw new WalletAuthError(code, message); }
