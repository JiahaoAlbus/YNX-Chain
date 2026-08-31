import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat, readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

function kind(info) {
  if (info.isDirectory()) return "directory";
  if (info.isFile()) return "regular file";
  if (info.isSymbolicLink()) return "symbolic link";
  return "unsupported";
}

function tuple(info) {
  return `${info.dev}:${info.ino}:${info.uid}:${info.gid}:${(info.mode & 0o777).toString(8)}:${info.nlink}:${info.size}:${kind(info)}`;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function assertObject(path, expected, expectedKind) {
  const info = await lstat(path);
  assert.equal(kind(info), expectedKind, `${path} type mismatch`);
  assert.equal(tuple(info), expected.tuple, `${path} tuple mismatch`);
  if (expectedKind === "regular file") {
    assert.equal(info.nlink, 1, `${path} must have one hard link`);
    assert.equal(await sha256(path), expected.sha256, `${path} SHA mismatch`);
  }
}

export async function verifyRetainedEvidence(manifest, {productionPaths = true} = {}) {
  assert.equal(manifest.schemaVersion, "ynx-video-retained-evidence-inventory/1");
  if (productionPaths) {
    assert.equal(manifest.parent.path, "/var/lib/ynx-video-viewer-wallet-evidence");
    assert.equal(manifest.identity.path, "/var/lib/ynx-video-viewer-wallet-evidence.identity");
  }
  assert.equal(manifest.children.length, 5);
  await assertObject(manifest.parent.path, manifest.parent, "directory");
  await assertObject(manifest.identity.path, manifest.identity, "regular file");
  const expectedNames = manifest.children.map((entry) => entry.name).sort();
  assert.equal(new Set(expectedNames).size, expectedNames.length, "duplicate retained child name");
  for (const name of expectedNames) {
    assert.ok(name && name !== "." && name !== ".." && !name.includes("/"), "invalid retained child name");
  }
  const actualNames = (await readdir(manifest.parent.path)).sort();
  assert.deepEqual(actualNames, expectedNames, "retained direct-child inventory mismatch");
  for (const entry of manifest.children) {
    await assertObject(`${manifest.parent.path}/${entry.name}`, entry, "regular file");
  }
  return Object.freeze({parent: manifest.parent.tuple, identity: manifest.identity.tuple, children: manifest.children.map((entry) => Object.freeze({name: entry.name, tuple: entry.tuple, sha256: entry.sha256}))});
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  assert.ok(process.argv.length === 3 || (process.argv.length === 4 && process.argv[3] === "--fixture-paths"), "usage: video-retained-evidence-guard.mjs <inventory.json> [--fixture-paths]");
  const manifest = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
  const result = await verifyRetainedEvidence(manifest, {productionPaths: process.argv[3] !== "--fixture-paths"});
  process.stdout.write(`${JSON.stringify({status: "RETAINED_EVIDENCE_EXACT", ...result})}\n`);
}
