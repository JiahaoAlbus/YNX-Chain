import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {verifyRetainedEvidence} from "./scripts/video-retained-evidence-guard.mjs";

const names = [
  "video-legacy-viewer-emergency-recovery.receipt",
  "video-viewer-wallet-controlled-takeover-3b1a062b.receipt",
  "video-viewer-wallet-controlled-takeover-3b1a062b.receipt.legacy.successor",
  "video-viewer-wallet-controlled-takeover-3b1a062b.receipt.legacy.successor.expected",
  "video-viewer-wallet-controlled-takeover-3b1a062b.receipt.legacy.successor.stable"
];

function kind(info) {
  if (info.isDirectory()) return "directory";
  if (info.isFile()) return "regular file";
  if (info.isSymbolicLink()) return "symbolic link";
  return "unsupported";
}

function object(path, sha = false) {
  const info = lstatSync(path);
  const value = {path, tuple: `${info.dev}:${info.ino}:${info.uid}:${info.gid}:${(info.mode & 0o777).toString(8)}:${info.nlink}:${info.size}:${kind(info)}`};
  if (sha) value.sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return value;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ynx-video-retained-"));
  const parent = join(root, "var/lib/ynx-video-viewer-wallet-evidence");
  const identity = `${parent}.identity`;
  mkdirSync(parent, {recursive: true});
  writeFileSync(identity, "retained-parent-identity\n");
  names.forEach((name, index) => writeFileSync(join(parent, name), `retained-${index}\n`));
  return {root, parent, identity, manifest: {
    schemaVersion: "ynx-video-retained-evidence-inventory/1",
    parent: object(parent),
    identity: object(identity, true),
    children: names.map((name) => ({name, ...object(join(parent, name), true)}))
  }};
}

async function rejectsWithoutDeleting(f, mutate) {
  const original = new Map(names.map((name) => [name, readFileSync(join(f.parent, name))]));
  const changed = await mutate();
  await assert.rejects(verifyRetainedEvidence(f.manifest, {productionPaths: false}));
  assert.equal(existsSync(f.parent), true);
  assert.equal(existsSync(f.identity), true);
  for (const name of names) assert.equal(existsSync(join(f.parent, name)), true, `${name} must remain present`);
  for (const [name, body] of original) {
    if (changed !== name) assert.deepEqual(readFileSync(join(f.parent, name)), body, `${name} must remain byte-exact`);
  }
}

test("retained evidence exact inventory is readable", async () => {
  const f = fixture();
  const result = await verifyRetainedEvidence(f.manifest, {productionPaths: false});
  assert.equal(result.children.length, 5);
  await assert.rejects(verifyRetainedEvidence(f.manifest), /Expected values to be strictly equal/);
  rmSync(f.root, {recursive: true});
});

test("foreign sibling, replacement, symlink, hardlink and directory-only mutations preserve all retained entries", async (t) => {
  await t.test("foreign sibling", async () => {
    const f = fixture();
    await rejectsWithoutDeleting(f, () => writeFileSync(join(f.parent, "foreign"), "foreign\n"));
    rmSync(f.root, {recursive: true});
  });
  await t.test("same-byte replacement inode", async () => {
    const f = fixture();
    const target = join(f.parent, names[1]);
    await rejectsWithoutDeleting(f, () => {
      const body = readFileSync(target);
      rmSync(target); writeFileSync(target, body);
      assert.notEqual(object(target, true).tuple, f.manifest.children[1].tuple);
      return names[1];
    });
    rmSync(f.root, {recursive: true});
  });
  await t.test("symlink replacement", async () => {
    const f = fixture();
    const target = join(f.parent, names[2]);
    await rejectsWithoutDeleting(f, () => {
      rmSync(target); symlinkSync(join(f.parent, names[0]), target);
      assert.equal(lstatSync(target).isSymbolicLink(), true);
      return names[2];
    });
    rmSync(f.root, {recursive: true});
  });
  await t.test("hardlink replacement", async () => {
    const f = fixture();
    const target = join(f.parent, names[3]);
    await rejectsWithoutDeleting(f, () => {
      rmSync(target); linkSync(join(f.parent, names[0]), target);
      assert.equal(lstatSync(target).nlink, 2);
      return names[3];
    });
    rmSync(f.root, {recursive: true});
  });
  await t.test("directory-only sibling", async () => {
    const f = fixture();
    await rejectsWithoutDeleting(f, () => mkdirSync(join(f.parent, "foreign-directory")));
    rmSync(f.root, {recursive: true});
  });
});
