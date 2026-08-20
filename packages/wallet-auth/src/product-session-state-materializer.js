import { createHash } from "node:crypto";
import {
  closeSync, constants, fchmodSync, fchownSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
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

  requireLinuxPublicationFlags();
  const parent = dirname(input.outputPath), directory = system.lstat(parent);
  requirePrivateDirectory(directory, 0, 0, "protected output");
  const directoryDescriptor = system.open(parent, constants.O_RDONLY | directoryFlag() | noFollow());
  let descriptor, createdIdentity, directoryTransferred = false;
  try {
    const openedDirectory = system.fstat(directoryDescriptor);
    requirePrivateDirectory(openedDirectory, 0, 0, "opened protected output");
    if (openedDirectory.dev !== directory.dev || openedDirectory.ino !== directory.ino) fail("OUTPUT_DIRECTORY_CHANGED", "Product Session protected output directory changed during privileged open");
    try { descriptor = system.open(input.outputPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow(), 0o600); }
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
    const finalPath = system.lstat(input.outputPath);
    requirePrivateFile(finalPath, input.outputUid, input.outputGid, "service output path");
    if (finalPath.dev !== createdIdentity.dev || finalPath.ino !== createdIdentity.ino) fail("OUTPUT_CHANGED", "Materialized Product Session output path changed while its directory was protected");
    system.fsync(directoryDescriptor);
    system.fchmod(directoryDescriptor, 0o700);
    system.boundary?.("beforeDirectoryOwnershipTransfer");
    system.fchown(directoryDescriptor, input.outputUid, input.outputGid);
    directoryTransferred = true;
  } finally {
    if (descriptor !== undefined) system.close(descriptor);
    if (createdIdentity && !directoryTransferred) {
      let current;
      try { current = system.lstat(input.outputPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (current && current.dev === createdIdentity.dev && current.ino === createdIdentity.ino) {
        system.unlink(input.outputPath);
        system.fsync(directoryDescriptor);
      }
    }
    system.close(directoryDescriptor);
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
function requireLinuxPublicationFlags() {
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_DIRECTORY) || !Number.isInteger(constants.O_EXCL)) fail("ATOMIC_PUBLISH_UNAVAILABLE", "Product Session materializer requires Linux no-follow and atomic no-replace flags");
}
function noFollow() { return constants.O_NOFOLLOW; }
function directoryFlag() { return constants.O_DIRECTORY; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function fail(code, message) { throw new WalletAuthError(code, message); }
