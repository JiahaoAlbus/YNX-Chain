import { createHash } from "node:crypto";
import {
  closeSync, constants, fchmodSync, fchownSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";

const INPUT_FIELDS = ["expectedRegistryStateBindingSha256", "expectedSourceStateFileSha256", "outputGid", "outputPath", "outputUid", "sourcePath"];
const RECEIPT_FIELDS = ["bytes", "commitPoint", "committed", "mode", "outputGid", "outputUid", "registryStateBindingSha256", "schemaVersion", "stateFileSha256"];
const STATE_FIELDS = ["registrySha256", "schemaVersion", "snapshot", "snapshotSha256"];
const MAXIMUM_STATE_BYTES = 64 * 1024 * 1024;

const NODE_SYSTEM = Object.freeze({
  close: closeSync,
  effectiveUid: () => process.geteuid?.() ?? process.getuid(),
  fchmod: fchmodSync,
  fchown: fchownSync,
  fstat: fstatSync,
  freezeReceipt: Object.freeze,
  fsync: fsyncSync,
  lstat: lstatSync,
  lstatAt: (directoryDescriptor, name) => lstatSync(fdRelativePath(directoryDescriptor, name)),
  open: openSync,
  openAt: (directoryDescriptor, name, flags, mode) => openSync(fdRelativePath(directoryDescriptor, name), flags, mode),
  read: (descriptor) => readFileSync(descriptor, "utf8"),
  readAt: (descriptor, size) => {
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    return bytes.subarray(0, offset).toString("utf8");
  },
  supportsDirectoryFdRelative: process.platform === "linux",
  unlink: unlinkSync,
  unlinkAt: (directoryDescriptor, name) => unlinkSync(fdRelativePath(directoryDescriptor, name)),
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

  requireLinuxPublication(system);
  const parent = dirname(input.outputPath), outputName = basename(input.outputPath), directory = system.lstat(parent);
  requirePrivateDirectory(directory, 0, 0, "protected output");
  let directoryDescriptor = system.open(parent, constants.O_RDONLY | directoryFlag() | noFollow());
  let committedReceipt, descriptor, createdIdentity, directoryTransferred = false;
  try {
    const openedDirectory = system.fstat(directoryDescriptor);
    requirePrivateDirectory(openedDirectory, 0, 0, "opened protected output");
    if (openedDirectory.dev !== directory.dev || openedDirectory.ino !== directory.ino) fail("OUTPUT_DIRECTORY_CHANGED", "Product Session protected output directory changed during privileged open");
    verifyDirectoryPath(system, parent, directoryDescriptor, openedDirectory, 0, 0, "before output creation");
    system.boundary?.("beforeAtomicOutputCreate");
    verifyDirectoryPath(system, parent, directoryDescriptor, openedDirectory, 0, 0, "at output creation");
    try { descriptor = system.openAt(directoryDescriptor, outputName, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow(), 0o600); }
    catch (error) {
      if (error?.code === "EEXIST") fail("OUTPUT_EXISTS", "Product Session materializer never overwrites an output state file");
      if (["EINVAL", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"].includes(error?.code)) fail("ATOMIC_PUBLISH_UNAVAILABLE", "Product Session materializer requires atomic O_EXCL no-replace creation");
      throw error;
    }
    createdIdentity = system.fstat(descriptor);
    requirePrivateFile(createdIdentity, 0, 0, "new protected output");
    system.boundary?.("afterAtomicOutputCreate");
    system.write(descriptor, sourceBytes);
    system.boundary?.("afterOutputWrite");
    system.fchmod(descriptor, 0o600);
    system.boundary?.("afterOutputFchmod");
    system.fsync(descriptor);
    verifyDescriptor(system, descriptor, createdIdentity, 0, 0, sourceBytes, input.expectedSourceStateFileSha256, "protected output");
    system.boundary?.("afterProtectedDescriptorVerification");
    system.fchown(descriptor, input.outputUid, input.outputGid);
    system.boundary?.("afterOutputFchown");
    system.fchmod(descriptor, 0o600);
    system.fsync(descriptor);
    verifyDescriptor(system, descriptor, createdIdentity, input.outputUid, input.outputGid, sourceBytes, input.expectedSourceStateFileSha256, "service output");
    system.boundary?.("afterServiceDescriptorVerification");
    const finalPath = system.lstatAt(directoryDescriptor, outputName);
    requirePrivateFile(finalPath, input.outputUid, input.outputGid, "service output path");
    if (finalPath.dev !== createdIdentity.dev || finalPath.ino !== createdIdentity.ino) fail("OUTPUT_CHANGED", "Materialized Product Session output path changed while its directory was protected");
    verifyDirectoryPath(system, parent, directoryDescriptor, openedDirectory, 0, 0, "before ownership transfer");
    system.fsync(directoryDescriptor);
    system.fchmod(directoryDescriptor, 0o700);
    system.boundary?.("beforeDirectoryOwnershipTransfer");
    verifyDirectoryPath(system, parent, directoryDescriptor, openedDirectory, 0, 0, "at ownership transfer");
    const verifiedOutputDescriptor = descriptor;
    descriptor = undefined;
    system.close(verifiedOutputDescriptor);
    const receipt = {
      bytes: Buffer.byteLength(sourceBytes),
      commitPoint: "DIRECTORY_OWNERSHIP_TRANSFERRED",
      committed: true,
      mode: "0600",
      outputGid: input.outputGid,
      outputUid: input.outputUid,
      registryStateBindingSha256: input.expectedRegistryStateBindingSha256,
      schemaVersion: 1,
      stateFileSha256: input.expectedSourceStateFileSha256,
    };
    exactFields(receipt, RECEIPT_FIELDS, "Product Session state materialization committed receipt");
    committedReceipt = system.freezeReceipt(receipt);
    if (committedReceipt !== receipt || !Object.isFrozen(committedReceipt)) fail("RECEIPT_CONSTRUCTION_FAILED", "Product Session state materialization receipt must be exact and immutable before commit");
    const closeOperation = system.close;
    if (typeof closeOperation !== "function") fail("RECEIPT_CONSTRUCTION_FAILED", "Product Session state materialization close operation must be bound before commit");
    const closeCommittedDirectory = closeOperation.bind(system);
    system.fchown(directoryDescriptor, input.outputUid, input.outputGid);
    directoryTransferred = true;
    const committedDirectoryDescriptor = directoryDescriptor;
    directoryDescriptor = undefined;
    try { closeCommittedDirectory(committedDirectoryDescriptor); } catch { /* the pre-frozen committed receipt remains authoritative */ }
    return committedReceipt;
  } finally {
    let finalizationError;
    if (descriptor !== undefined) {
      const uncommittedOutputDescriptor = descriptor;
      descriptor = undefined;
      try { system.close(uncommittedOutputDescriptor); } catch (error) { finalizationError = error; }
    }
    if (createdIdentity && !directoryTransferred) {
      let current;
      try {
        try { current = system.lstatAt(directoryDescriptor, outputName); } catch (error) { if (error?.code !== "ENOENT") throw error; }
        if (current && current.dev === createdIdentity.dev && current.ino === createdIdentity.ino) {
          system.unlinkAt(directoryDescriptor, outputName);
          system.fsync(directoryDescriptor);
        }
      } catch (error) { finalizationError ??= error; }
    }
    if (directoryDescriptor !== undefined) {
      const finalDirectoryDescriptor = directoryDescriptor;
      directoryDescriptor = undefined;
      try { system.close(finalDirectoryDescriptor); } catch (error) { finalizationError ??= error; }
    }
    if (finalizationError) throw finalizationError;
  }
}

function validateInput(input) {
  if (!isAbsolute(input.sourcePath) || !isAbsolute(input.outputPath) || input.sourcePath === input.outputPath) fail("INVALID_PATH", "Materialization paths must be distinct absolute paths");
  if (![input.sourcePath, input.outputPath].every((path) => basename(path) && ![".", ".."].includes(basename(path)))) fail("INVALID_PATH", "Materialization paths must name files");
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

function verifyDescriptor(system, descriptor, identity, uid, gid, sourceBytes, expectedSha256, label) {
  const opened = system.fstat(descriptor);
  requirePrivateFile(opened, uid, gid, label);
  if (opened.dev !== identity.dev || opened.ino !== identity.ino || opened.size !== Buffer.byteLength(sourceBytes) || sha256(system.readAt(descriptor, opened.size)) !== expectedSha256) fail("OUTPUT_MISMATCH", "Materialized Product Session state did not remain exact on its verified descriptor");
}

function requirePrivateFile(info, uid, gid, label) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== uid || info.gid !== gid || (info.mode & 0o777) !== 0o600) fail("UNSAFE_MIGRATED_STATE", `Migrated Product Session ${label} must be one owner-bound mode-0600 regular file`);
}
function requirePrivateDirectory(info, uid, gid, label) {
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || info.gid !== gid || (info.mode & 0o777) !== 0o700) fail("UNSAFE_OUTPUT_DIRECTORY", `Product Session ${label} directory must be owner-bound mode 0700`);
}
function verifyDirectoryPath(system, path, descriptor, identity, uid, gid, phase) {
  const opened = system.fstat(descriptor);
  requirePrivateDirectory(opened, uid, gid, `opened ${phase}`);
  if (opened.dev !== identity.dev || opened.ino !== identity.ino) fail("OUTPUT_DIRECTORY_CHANGED", `Product Session opened output directory changed ${phase}`);
  const current = system.lstat(path);
  requirePrivateDirectory(current, uid, gid, phase);
  if (current.dev !== identity.dev || current.ino !== identity.ino) fail("OUTPUT_DIRECTORY_CHANGED", `Product Session output directory path changed ${phase}`);
}
function requireLinuxPublication(system) {
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_DIRECTORY) || !Number.isInteger(constants.O_EXCL) || system.supportsDirectoryFdRelative !== true || typeof system.openAt !== "function" || typeof system.lstatAt !== "function" || typeof system.unlinkAt !== "function") fail("ATOMIC_PUBLISH_UNAVAILABLE", "Product Session materializer requires Linux directory-FD-relative no-replace operations");
}
function fdRelativePath(directoryDescriptor, name) { return `/proc/self/fd/${directoryDescriptor}/${name}`; }
function noFollow() { return constants.O_NOFOLLOW; }
function directoryFlag() { return constants.O_DIRECTORY; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function fail(code, message) { throw new WalletAuthError(code, message); }
