import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, writeFileSync,
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
  assert.deepEqual(receipt, { bytes: Buffer.byteLength(bytes), mode: "0600", outputGid: gid, outputUid: uid, registryStateBindingSha256: registrySha256, schemaVersion: 1, stateFileSha256: sha256(bytes) });
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

test("materializer atomically refuses a target created after its absence check and preserves the concurrent bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-race-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const concurrentBytes = "concurrent-owner-state\n", sourceIdentity = statSync(source);
  let concurrentIdentity;
  const system = nodeSystem({
    beforeLink: () => {
      writeFileSync(output, concurrentBytes, { flag: "wx", mode: 0o640 });
      concurrentIdentity = lstatSync(output);
    },
    sourceIdentity,
    sourcePath: source,
  });
  assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system),
    (error) => error instanceof WalletAuthError && error.code === "OUTPUT_EXISTS");
  const after = lstatSync(output);
  assert.equal(readFileSync(output, "utf8"), concurrentBytes);
  assert.equal(after.ino, concurrentIdentity.ino); assert.equal(after.mode, concurrentIdentity.mode); assert.equal(after.nlink, concurrentIdentity.nlink);
  assert.equal(readFileSync(source, "utf8"), bytes);
  assert.deepEqual(readdirSync(outputDirectory), ["v2-state.json"]);
});

test("materializer fails closed and removes its temporary file when atomic no-replace publication is unavailable", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-state-materialize-unsupported-")); chmodSync(directory, 0o700);
  const source = join(directory, "root-migrated.json"), outputDirectory = join(directory, "service"), output = join(outputDirectory, "v2-state.json");
  mkdirSync(outputDirectory, { mode: 0o700 }); writeFileSync(source, bytes, { mode: 0o600 });
  const sourceIdentity = statSync(source), system = nodeSystem({ sourceIdentity, sourcePath: source });
  system.link = () => { const error = new Error("unsupported"); error.code = "ENOSYS"; throw error; };
  assert.throws(() => materializeMigratedProductSessionStateWithSystem(input(source, output), system),
    (error) => error instanceof WalletAuthError && error.code === "ATOMIC_PUBLISH_UNAVAILABLE");
  assert.deepEqual(readdirSync(outputDirectory), []);
  assert.equal(readFileSync(source, "utf8"), bytes);
});

function input(sourcePath, outputPath) {
  return { expectedRegistryStateBindingSha256: registrySha256, expectedSourceStateFileSha256: sha256(bytes), outputGid: gid, outputPath, outputUid: uid, sourcePath };
}
function nodeSystem({ beforeLink, sourceIdentity, sourcePath }) {
  const identity = (path, value) => path === sourcePath || value.dev === sourceIdentity.dev && value.ino === sourceIdentity.ino ? Object.assign(Object.create(Object.getPrototypeOf(value)), value, { uid: 0, gid: 0 }) : value;
  return {
    close: closeSync, effectiveUid: () => 0, fchmod: fchmodSync,
    fchown: (_descriptor, targetUid, targetGid) => { assert.equal(targetUid, uid); assert.equal(targetGid, gid); },
    fstat: (descriptor) => identity(null, fstatSync(descriptor)), fsync: fsyncSync,
    link: (source, target) => { beforeLink?.(); linkSync(source, target); },
    lstat: (path) => identity(path, lstatSync(path)), open: openSync, read: (descriptor) => readFileSync(descriptor, "utf8"),
    unlink: unlinkSync, write: (descriptor, value) => writeFileSync(descriptor, value, "utf8"),
  };
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
