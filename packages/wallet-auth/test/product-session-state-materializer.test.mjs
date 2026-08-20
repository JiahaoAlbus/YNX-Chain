import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJSON, WalletAuthError } from "../src/index.js";
import { materializeMigratedProductSessionStateWithSystem } from "../src/product-session-state-materializer.js";

const uid = process.getuid(), gid = process.getgid(), registrySha256 = "ab".repeat(32);
const snapshot = Object.freeze({ authority: Object.freeze({ sessions: Object.freeze([]) }) });
const bytes = `${canonicalJSON({ registrySha256, schemaVersion: 1, snapshot, snapshotSha256: sha256(canonicalJSON(snapshot)) })}\n`;

test("unprivileged materializer fails before attempting to read the root-private migration output", () => {
  let sourceReads = 0;
  const system = { effectiveUid: () => uid, lstat: () => { sourceReads += 1; throw new Error("must not read"); } };
  assert.throws(() => materializeMigratedProductSessionStateWithSystem(input("/root/private.json", "/private/output.json"), system),
    (error) => error instanceof WalletAuthError && error.code === "PRIVILEGE_REQUIRED");
  assert.equal(sourceReads, 0);
});

test("privileged materializer reads one root-private source and atomically installs exact service-owned bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service");
  mkdirSync(outputDirectory, { mode: 0o700 });
  writeFileSync(source, bytes, { mode: 0o600 });
  const sourceIdentity = statSync(source);
  const system = nodeSystem({ sourceIdentity, sourcePath: source });
  const output = join(outputDirectory, "v2-state.json"), expected = input(source, output);
  const receipt = materializeMigratedProductSessionStateWithSystem(expected, system);
  const info = lstatSync(output);
  assert.deepEqual(receipt, { bytes: Buffer.byteLength(bytes), commitPoint: "DIRECTORY_OWNERSHIP_TRANSFERRED", committed: true, mode: "0600", outputGid: gid, outputUid: uid, registryStateBindingSha256: registrySha256, schemaVersion: 1, stateFileSha256: sha256(bytes) });
  assert.equal(readFileSync(output, "utf8"), bytes);
  assert.equal(sha256(readFileSync(output)), sha256(bytes));
  assert.equal(info.uid, uid); assert.equal(info.gid, gid); assert.equal(info.mode & 0o777, 0o600); assert.equal(info.nlink, 1);
  assert.equal(readFileSync(source, "utf8"), bytes); assert.equal(lstatSync(source).mode & 0o777, 0o600);
});

test("materializer rejects source hard links, canonical-byte changes and existing output with zero overwrite", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-negative-")); chmodSync(directory, 0o700);
  const outputDirectory = join(directory, "service"); mkdirSync(outputDirectory, { mode: 0o700 });
  for (const variant of ["hardlink", "trailing-byte", "existing-output"]) {
    const source = join(directory, `${variant}.json`), output = join(outputDirectory, `${variant}.json`);
    writeFileSync(source, variant === "trailing-byte" ? `${bytes}\n` : bytes, { mode: 0o600 });
    if (variant === "hardlink") linkSync(source, join(directory, `${variant}.link`));
    if (variant === "existing-output") writeFileSync(output, "preserve", { mode: 0o600 });
    const sourceIdentity = statSync(source), system = nodeSystem({ sourceIdentity, sourcePath: source });
    const expected = { ...input(source, output), expectedSourceStateFileSha256: sha256(readFileSync(source)) };
    assert.throws(() => materializeMigratedProductSessionStateWithSystem(expected, system));
    assert.equal(readFileSync(source, "utf8"), variant === "trailing-byte" ? `${bytes}\n` : bytes);
    if (variant === "existing-output") assert.equal(readFileSync(output, "utf8"), "preserve");
    else assert.throws(() => lstatSync(output), { code: "ENOENT" });
  }
});

test("materializer preserves existing regular, symlink and hard-linked targets", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-targets-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const sourceIdentity = statSync(source), system = nodeSystem({ sourceIdentity, sourcePath: source });
  for (const variant of ["regular", "symlink", "hardlink"]) {
    const output = join(outputDirectory, `${variant}.json`), protectedFile = join(directory, `${variant}-protected.json`);
    writeFileSync(protectedFile, `${variant}-preserve\n`, { mode: 0o600 });
    if (variant === "regular") writeFileSync(output, `${variant}-preserve\n`, { mode: 0o600 });
    else if (variant === "symlink") symlinkSync(protectedFile, output);
    else linkSync(protectedFile, output);
    const before = lstatSync(output);
    assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system),
      (error) => error instanceof WalletAuthError && error.code === "OUTPUT_EXISTS");
    const after = lstatSync(output);
    assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode);
    assert.equal(readFileSync(output, "utf8"), `${variant}-preserve\n`);
  }
});

test("materializer rejects a service-owned output directory before creating a formal output", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-service-dir-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const system = nodeSystem({ outputPath: output, protectOutputDirectory: false, sourceIdentity: statSync(source), sourcePath: source });
  assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system),
    (error) => error instanceof WalletAuthError && error.code === "UNSAFE_OUTPUT_DIRECTORY");
  assert.deepEqual(readdirSync(outputDirectory), []);
});

test("root-protected direct O_EXCL creation keeps the verified descriptor open and denies service substitution at every publication boundary", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-protected-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const denied = [], sourceIdentity = statSync(source), system = nodeSystem({
    onBoundary: (name, state) => {
      if (name === "afterDirectoryOwnershipTransfer") {
        assert.equal(state.directoryTransferred, true);
        assert.equal(state.outputDescriptorOpen, false);
        return;
      }
      assert.equal(state.directoryTransferred, false);
      assert.equal(state.outputDescriptorOpen, name !== "beforeAtomicOutputCreate");
      const error = state.attemptServiceReplacement("ATTACKER_REPLACEMENT\n");
      assert.equal(error.code, "EACCES"); denied.push(name);
    },
    outputPath: output,
    sourceIdentity,
    sourcePath: source,
  });
  const receipt = materializeMigratedProductSessionStateWithSystem(input(source, output), system);
  assert.equal(receipt.stateFileSha256, sha256(bytes));
  assert.equal(readFileSync(output, "utf8"), bytes);
  assert.deepEqual(denied, ["beforeAtomicOutputCreate", "afterAtomicOutputCreate", "afterOutputWrite", "afterOutputFchmod", "afterProtectedDescriptorVerification", "afterOutputFchown", "afterServiceDescriptorVerification", "beforeDirectoryOwnershipTransfer"]);
  assert.equal(system.state().outputDescriptorClosedAfterDirectoryTransfer, false);
  assert.deepEqual(readdirSync(outputDirectory), ["v2-state.json"]);
});

test("every injected pre-handoff failure removes only the descriptor-bound output and leaves no bad formal state", () => {
  const boundaries = ["beforeAtomicOutputCreate", "afterAtomicOutputCreate", "afterOutputWrite", "afterOutputFchmod", "afterProtectedDescriptorVerification", "afterOutputFchown", "afterServiceDescriptorVerification", "beforeDirectoryOwnershipTransfer"];
  for (const boundary of boundaries) {
    const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-boundary-")); chmodSync(directory, 0o700);
    const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
    mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
    const sourceIdentity = statSync(source), system = nodeSystem({ failBoundary: boundary, outputPath: output, sourceIdentity, sourcePath: source });
    assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system), /injected boundary failure/);
    assert.deepEqual(readdirSync(outputDirectory), []);
    assert.equal(readFileSync(source, "utf8"), bytes);
  }
});

test("a reported service substitution attempt after descriptor verification rejects the transaction with no formal output", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-replacement-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const system = nodeSystem({
    onBoundary: (name, state) => {
      if (name !== "afterProtectedDescriptorVerification") return;
      const denied = state.attemptServiceReplacement("ATTACKER_REPLACEMENT\n");
      assert.equal(denied.code, "EACCES");
      throw denied;
    },
    outputPath: output,
    sourceIdentity: statSync(source),
    sourcePath: source,
  });
  assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system), { code: "EACCES" });
  assert.deepEqual(readdirSync(outputDirectory), []);
  assert.equal(readFileSync(source, "utf8"), bytes);
});

test("directory-FD-relative creation detects every pre-handoff parent path replacement and never removes the replacement", () => {
  const boundaries = ["beforeAtomicOutputCreate", "afterAtomicOutputCreate", "afterOutputWrite", "afterOutputFchmod", "afterProtectedDescriptorVerification", "afterOutputFchown", "afterServiceDescriptorVerification", "beforeDirectoryOwnershipTransfer"];
  for (const boundary of boundaries) {
    const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-parent-race-")); chmodSync(directory, 0o700);
    const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
    mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
    let detached;
    const system = nodeSystem({
      onBoundary: (name, state) => { if (name === boundary) detached = state.replaceParentPath(); },
      outputPath: output,
      sourceIdentity: statSync(source),
      sourcePath: source,
    });
    assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system),
      (error) => error instanceof WalletAuthError && ["OUTPUT_DIRECTORY_CHANGED", "UNSAFE_OUTPUT_DIRECTORY"].includes(error.code));
    assert.equal(readFileSync(output, "utf8"), "ATTACKER_PARENT_REPLACEMENT\n");
    assert.deepEqual(readdirSync(detached), [], boundary);
  }
});

test("post-commit parent replacement is diagnostic and still returns the explicit committed receipt", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-final-parent-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const system = nodeSystem({
    outputPath: output,
    replaceParentOnDirectoryCloseAfterHandoff: true,
    sourceIdentity: statSync(source),
    sourcePath: source,
  });
  const receipt = materializeMigratedProductSessionStateWithSystem(input(source, output), system);
  const detached = system.state().postCommitDetached;
  assert.equal(receipt.committed, true);
  assert.equal(receipt.commitPoint, "DIRECTORY_OWNERSHIP_TRANSFERRED");
  assert.equal(readFileSync(output, "utf8"), "ATTACKER_PARENT_REPLACEMENT\n");
  assert.equal(readFileSync(join(detached, "v2-state.json"), "utf8"), bytes);
});

test("no post-commit ownership hook can run after the irreversible handoff", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-post-commit-hook-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  let postCommitHookCalled = false;
  const system = nodeSystem({
    onBoundary: (name) => { if (name === "afterDirectoryOwnershipTransfer") { postCommitHookCalled = true; throw Object.assign(new Error("post-commit boundary failure"), { code: "EIO" }); } },
    outputPath: output,
    sourceIdentity: statSync(source),
    sourcePath: source,
  });
  const receipt = materializeMigratedProductSessionStateWithSystem(input(source, output), system);
  assert.equal(receipt.committed, true);
  assert.equal(receipt.commitPoint, "DIRECTORY_OWNERSHIP_TRANSFERRED");
  assert.equal(postCommitHookCalled, false);
  assert.equal(readFileSync(output, "utf8"), bytes);
});

test("receipt freeze failure rolls back before the irreversible directory handoff", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-receipt-freeze-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const system = nodeSystem({ failReceiptFreeze: true, outputPath: output, sourceIdentity: statSync(source), sourcePath: source });
  assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system), { code: "EIO" });
  assert.equal(system.state().directoryTransferred, false);
  assert.equal(system.state().frozenReceipt, undefined);
  assert.deepEqual(readdirSync(outputDirectory), []);
});

test("post-commit finally returns the exact pre-frozen receipt reference", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-final-receipt-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const system = nodeSystem({
    failDirectoryCloseAfterHandoff: true,
    onBoundary: (name) => { if (name === "afterDirectoryOwnershipTransfer") throw Object.assign(new Error("post-commit diagnostic failed"), { code: "EIO" }); },
    outputPath: output,
    sourceIdentity: statSync(source),
    sourcePath: source,
  });
  const receipt = materializeMigratedProductSessionStateWithSystem(input(source, output), system);
  assert.strictEqual(receipt, system.state().frozenReceipt);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(receipt.committed, true);
  assert.equal(readFileSync(output, "utf8"), bytes);
});

test("output close failure and directory handoff failure both roll back before the commit point", () => {
  for (const failure of ["output-close", "directory-fchown"]) {
    const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-commit-failure-")); chmodSync(directory, 0o700);
    const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
    mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
    const system = nodeSystem({ failDirectoryFchown: failure === "directory-fchown", failOutputClose: failure === "output-close", outputPath: output, sourceIdentity: statSync(source), sourcePath: source });
    assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system), { code: "EIO" });
    assert.deepEqual(readdirSync(outputDirectory), []);
  }
});

test("post-commit directory close failure cannot turn a committed materialization into a missing receipt", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-post-commit-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const system = nodeSystem({ failDirectoryCloseAfterHandoff: true, outputPath: output, sourceIdentity: statSync(source), sourcePath: source });
  const receipt = materializeMigratedProductSessionStateWithSystem(input(source, output), system);
  assert.equal(receipt.committed, true);
  assert.equal(receipt.stateFileSha256, sha256(bytes));
  assert.equal(readFileSync(output, "utf8"), bytes);
});

test("cleanup inode substitution never unlinks the unrelated replacement", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-cleanup-race-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const system = nodeSystem({
    onBoundary: (name, state) => { if (name === "afterProtectedDescriptorVerification") { state.replaceAnchoredOutput("UNRELATED_REPLACEMENT\n"); throw Object.assign(new Error("injected replacement"), { code: "EIO" }); } },
    outputPath: output,
    sourceIdentity: statSync(source),
    sourcePath: source,
  });
  assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system), { code: "EIO" });
  assert.equal(readFileSync(output, "utf8"), "UNRELATED_REPLACEMENT\n");
});

test("materializer fails closed when atomic O_EXCL publication is unavailable", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-unsupported-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const sourceIdentity = statSync(source), system = nodeSystem({ atomicCreateUnsupported: true, outputPath: output, sourceIdentity, sourcePath: source });
  assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system),
    (error) => error instanceof WalletAuthError && error.code === "ATOMIC_PUBLISH_UNAVAILABLE");
  assert.deepEqual(readdirSync(outputDirectory), []);
  assert.equal(readFileSync(source, "utf8"), bytes);
});

function input(sourcePath, outputPath) {
  return { expectedRegistryStateBindingSha256: registrySha256, expectedSourceStateFileSha256: sha256(bytes), outputGid: gid, outputPath, outputUid: uid, sourcePath };
}
function nodeSystem({ atomicCreateUnsupported = false, failBoundary, failDirectoryCloseAfterHandoff = false, failDirectoryFchown = false, failOutputClose = false, failReceiptFreeze = false, onBoundary, outputPath, protectOutputDirectory = true, replaceParentOnDirectoryCloseAfterHandoff = false, sourceIdentity, sourcePath }) {
  let anchorPath, createdIdentity, directoryDescriptor, directoryIdentity, directoryTransferred = false, fileTransferred = false, formalParentPath, frozenReceipt, outputDescriptor, outputDescriptorClosedAfterDirectoryTransfer = false, postCommitDetached;
  const identity = (path, value) => {
    const source = path === sourcePath || value.dev === sourceIdentity.dev && value.ino === sourceIdentity.ino;
    const directory = value.isDirectory() && (!directoryIdentity || value.dev === directoryIdentity.dev && value.ino === directoryIdentity.ino);
    const created = createdIdentity && value.dev === createdIdentity.dev && value.ino === createdIdentity.ino;
    if (source || protectOutputDirectory && directory && !directoryTransferred || created && !fileTransferred) return Object.assign(Object.create(Object.getPrototypeOf(value)), value, { uid: 0, gid: 0 });
    return value;
  };
  const state = () => ({
    attemptServiceReplacement: () => Object.assign(new Error("protected directory"), { code: directoryTransferred ? "UNEXPECTED_ACCESS" : "EACCES" }),
    replaceAnchoredOutput: (value) => { const path = join(anchorPath, outputPath ? outputPath.slice(outputPath.lastIndexOf("/") + 1) : "v2-state.json"); try { unlinkSync(path); } catch {} writeFileSync(path, value, { mode: 0o600 }); },
    replaceParentPath: (value = "ATTACKER_PARENT_REPLACEMENT\n") => {
      const detached = `${formalParentPath}.detached`;
      renameSync(formalParentPath, detached); anchorPath = detached;
      mkdirSync(formalParentPath, { mode: 0o700 });
      writeFileSync(join(formalParentPath, outputPath ? outputPath.slice(outputPath.lastIndexOf("/") + 1) : "v2-state.json"), value, { mode: 0o600 });
      return detached;
    },
    directoryTransferred,
    frozenReceipt,
    outputDescriptorClosedAfterDirectoryTransfer,
    outputDescriptorOpen: outputDescriptor !== undefined,
    postCommitDetached,
  });
  const system = {
    close: closeSync, effectiveUid: () => 0, fchmod: fchmodSync,
    fchown: (descriptor, targetUid, targetGid) => {
      assert.equal(targetUid, uid); assert.equal(targetGid, gid);
      if (fstatSync(descriptor).isDirectory()) { if (failDirectoryFchown) throw Object.assign(new Error("directory handoff failed"), { code: "EIO" }); directoryTransferred = true; }
      else fileTransferred = true;
    },
    fstat: (descriptor) => identity(null, fstatSync(descriptor)),
    freezeReceipt: (value) => {
      if (failReceiptFreeze) throw Object.assign(new Error("receipt freeze failed"), { code: "EIO" });
      frozenReceipt = Object.freeze(value);
      return frozenReceipt;
    },
    fsync: fsyncSync,
    lstat: (path) => identity(path, lstatSync(path)),
    open: (path, flags, mode) => {
      const createsOutput = Boolean(flags & constants.O_CREAT) && path !== sourcePath;
      if (createsOutput && atomicCreateUnsupported) { const error = new Error("unsupported"); error.code = "EINVAL"; throw error; }
      const descriptor = openSync(path, flags, mode);
      const info = fstatSync(descriptor);
      if (info.isDirectory()) { directoryIdentity = info; directoryDescriptor = descriptor; anchorPath = path; formalParentPath = path; }
      return descriptor;
    },
    openAt: (descriptor, name, flags, mode) => {
      assert.equal(descriptor, directoryDescriptor);
      if (atomicCreateUnsupported) { const error = new Error("unsupported"); error.code = "EINVAL"; throw error; }
      const opened = openSync(join(anchorPath, name), flags, mode); createdIdentity = fstatSync(opened); outputDescriptor = opened; return opened;
    },
    read: (descriptor) => readFileSync(descriptor, "utf8"),
    readAt: (descriptor, size) => {
      const buffer = Buffer.alloc(size); let offset = 0;
      while (offset < size) { const count = readSync(descriptor, buffer, offset, size - offset, offset); if (count === 0) break; offset += count; }
      return buffer.subarray(0, offset).toString("utf8");
    },
    lstatAt: (descriptor, name) => { assert.equal(descriptor, directoryDescriptor); return identity(null, lstatSync(join(anchorPath, name))); },
    supportsDirectoryFdRelative: true,
    unlink: unlinkSync, write: (descriptor, value) => writeFileSync(descriptor, value, "utf8"),
    unlinkAt: (descriptor, name) => { assert.equal(descriptor, directoryDescriptor); unlinkSync(join(anchorPath, name)); },
  };
  system.close = (descriptor) => {
    if (descriptor === outputDescriptor) {
      outputDescriptorClosedAfterDirectoryTransfer = directoryTransferred; outputDescriptor = undefined;
      closeSync(descriptor);
      if (failOutputClose) throw Object.assign(new Error("pre-handoff output close failed"), { code: "EIO" });
      return;
    }
    if (descriptor === directoryDescriptor) {
      if (directoryTransferred && replaceParentOnDirectoryCloseAfterHandoff) postCommitDetached = state().replaceParentPath();
      directoryDescriptor = undefined; closeSync(descriptor);
      if (directoryTransferred && failDirectoryCloseAfterHandoff) throw Object.assign(new Error("post-handoff directory close failed"), { code: "EIO" });
      return;
    }
    closeSync(descriptor);
  };
  system.boundary = (name) => { if (name === failBoundary) throw new Error(`injected boundary failure: ${name}`); onBoundary?.(name, state()); };
  system.state = state;
  return system;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
