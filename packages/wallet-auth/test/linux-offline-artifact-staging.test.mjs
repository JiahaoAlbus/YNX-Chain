import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("../scripts/ynx-wallet-stage-offline-artifact-linux.mjs", import.meta.url));
const builder = fileURLToPath(new URL("../scripts/build-linux-offline-stage-command.mjs", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");

function directory(label) {
  const path = `/tmp/ynx-wallet-auth-stage-test-${label}-${randomUUID()}`;
  return { parent: path, path };
}

function stage(path, name, bytes, initialize = "1", digest = sha(bytes)) {
  return spawnSync(process.execPath, [helper, path, name, digest, String(bytes.length), initialize], {
    encoding: "utf8", input: bytes, env: { ...process.env, YNX_STAGE_TEST_ALLOW_NON_ROOT: "1" },
  });
}

test("Linux staging receives two exact offline artifacts without a pre-existing upload directory", () => {
  const { parent, path } = directory("success");
  try {
    const source = Buffer.from("source archive exact bytes");
    const runtime = Buffer.from("runtime archive exact bytes");
    const first = stage(path, "wallet-auth-source-dda13e65.tar.gz", source);
    assert.equal(first.status, 0, first.stderr);
    const second = stage(path, "wallet-auth-runtime-dependencies-dda13e65.tar.gz", runtime, "0");
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(readFileSync(join(path, "wallet-auth-source-dda13e65.tar.gz")), source);
    assert.deepEqual(readFileSync(join(path, "wallet-auth-runtime-dependencies-dda13e65.tar.gz")), runtime);
    assert.equal(lstatSync(path).mode & 0o777, 0o700);
    for (const name of readdirSync(path)) {
      const status = lstatSync(join(path, name));
      assert.equal(status.isFile(), true); assert.equal(status.mode & 0o777, 0o600); assert.equal(status.nlink, 1);
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("digest mismatch removes the exact temporary inode and publishes no artifact", () => {
  const { parent, path } = directory("digest");
  try {
    const result = stage(path, "wallet-auth-source-dda13e65.tar.gz", Buffer.from("wrong"), "1", sha("expected"));
    assert.notEqual(result.status, 0); assert.match(result.stderr, /ARTIFACT_SHA256_MISMATCH/);
    assert.deepEqual(readdirSync(path), []);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("existing directory, existing output and unsafe directory mode fail closed without overwrite", () => {
  const { parent, path } = directory("negative");
  try {
    const bytes = Buffer.from("preserve me");
    const first = stage(path, "wallet-auth-source-dda13e65.tar.gz", bytes);
    assert.equal(first.status, 0, first.stderr);
    const duplicateInitialize = stage(path, "wallet-auth-runtime-dependencies-dda13e65.tar.gz", bytes, "1");
    assert.notEqual(duplicateInitialize.status, 0); assert.match(duplicateInitialize.stderr, /STAGING_DIRECTORY_EXISTS_OR_UNCREATABLE/);
    const existing = stage(path, "wallet-auth-source-dda13e65.tar.gz", Buffer.from("attacker"), "0");
    assert.notEqual(existing.status, 0); assert.match(existing.stderr, /ARTIFACT_ALREADY_EXISTS/);
    assert.deepEqual(readFileSync(join(path, "wallet-auth-source-dda13e65.tar.gz")), bytes);
    chmodSync(path, 0o755);
    const unsafe = stage(path, "wallet-auth-runtime-dependencies-dda13e65.tar.gz", bytes, "0");
    assert.notEqual(unsafe.status, 0); assert.match(unsafe.stderr, /STAGING_DIRECTORY_MODE/);
    assert.equal(existsSync(join(path, "wallet-auth-runtime-dependencies-dda13e65.tar.gz")), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("command builder emits a root-only Linux stdin receiver and never assumes a remote upload path", () => {
  const command = execFileSync(process.execPath, [builder,
    "/var/tmp/ynx-wallet-auth-p0071-dda13e65", "wallet-auth-source-dda13e65.tar.gz", "a".repeat(64), "193810", "1",
  ], { encoding: "utf8" });
  assert.match(command, /^sudo -n \/usr\/bin\/env -u YNX_STAGE_TEST_ALLOW_NON_ROOT \/usr\/bin\/node --input-type=module -e /);
  assert.match(command, /\/var\/tmp\/ynx-wallet-auth-p0071-dda13e65/);
  assert.doesNotMatch(command, /\/private\/tmp/);
  assert.doesNotMatch(command, /scp/);
  assert.doesNotMatch(command, /#!\/usr\/bin\/env/);
  assert.match(command, /ROOT_REQUIRED/);
  execFileSync("bash", ["-n", "-c", command]);
});
