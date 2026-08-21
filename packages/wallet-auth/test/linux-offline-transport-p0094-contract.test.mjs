import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const builder = fileURLToPath(new URL("../scripts/build-linux-offline-stage-command.mjs", import.meta.url));
const bundle = JSON.parse(readFileSync(`${root}/release/integration/p0-wallet-connectivity/p0-094-wallet-auth-linux-offline-execution-rollback-bundle.json`, "utf8"));
const staging = "/var/tmp/ynx-wallet-auth-p0094-dda13e655bdbf033";
const sourcePath = `${root}/release/integration/p0-wallet-connectivity/p0-094-wallet-auth-source-receiver.command`;
const runtimePath = `${root}/release/integration/p0-wallet-connectivity/p0-094-wallet-auth-runtime-receiver.command`;
const sha = (value) => createHash("sha256").update(value).digest("hex");

test("P0-094 frozen Linux receiver commands regenerate byte-for-byte from accepted inputs", () => {
  const source = execFileSync(process.execPath, [builder, staging, "wallet-auth-source-dda13e65.tar.gz", "6a10469371a550b33a6b2f37a483309fa7ddfbbd4451273f070148dd6ed624f9", "193810", "1"]);
  const runtime = execFileSync(process.execPath, [builder, staging, "wallet-auth-runtime-dependencies-dda13e65.tar.gz", "a17794bd15592f3eae1caab34094bc52ec70ce89efa0cbd9995219e94bc7bd86", "707204", "0"]);
  assert.deepEqual(source, readFileSync(sourcePath));
  assert.deepEqual(runtime, readFileSync(runtimePath));
  assert.equal(sha(source), bundle.artifacts[0].receiverCommandSha256);
  assert.equal(sha(runtime), bundle.artifacts[1].receiverCommandSha256);
  assert.equal(sha(Buffer.concat([source, Buffer.from([0]), runtime])), bundle.generatedCommands.orderedSourceNulRuntimeSha256);
  execFileSync("bash", ["-n", sourcePath]);
  execFileSync("bash", ["-n", runtimePath]);
});

test("P0-094 bundle is pre-lease, no-secret and cannot promote public truth", () => {
  assert.equal(bundle.taskId, "P0-094");
  assert.equal(bundle.status, "SOURCE_ONLY_PRELEASE_NOT_EXECUTION_AUTHORITY");
  assert.equal(bundle.staging.absolutePath, staging);
  assert.equal(bundle.lease.issued, false);
  assert.equal(bundle.executionGate.executionAuthorizedByThisBundle, false);
  assert.equal(bundle.rollback.runtimeRollbackCommandFrozen, false);
  assert.equal(bundle.productionReadPerformed, false);
  assert.equal(bundle.sshUsed, false);
  assert.equal(bundle.deploymentAttempted, false);
  assert.equal(bundle.truth.registryV3Public, false);
  assert.equal(bundle.truth.productsMigrated, 0);
  assert.equal(bundle.truth.computerControl, false);
  const serialized = JSON.stringify(bundle);
  assert.doesNotMatch(serialized, /BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{20,}/u);
  assert.match(bundle.generatedCommands.sourceInvocation, /StrictHostKeyChecking=yes/);
  assert.match(bundle.generatedCommands.sourceInvocation, /< release\/integration\/p0-wallet-connectivity\/artifacts\/wallet-auth-dda13e65\/wallet-auth-source-dda13e65\.tar\.gz$/u);
  assert.match(bundle.generatedCommands.runtimeInvocation, /wallet-auth-runtime-dependencies-dda13e65\.tar\.gz$/u);
});
