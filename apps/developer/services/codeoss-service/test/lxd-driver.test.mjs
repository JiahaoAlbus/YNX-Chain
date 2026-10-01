import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertLxdIsolation, createLxdCoreDriver } from "../src/lxd-driver.mjs";
import { CORE_LIMITS } from "../src/upstream.mjs";

const image = "a".repeat(64), digest = "b".repeat(64), uuid = "12345678-1234-1234-1234-123456789012";
const configuration = { artifactRoot: "/official/x64", imageFingerprint: image, storagePool: "core-quota", profileName: "ynx-core-isolated", networkName: "ynx-core-egress-approved", acl: "ynx-core-packages" };
function instance(context) {
  return { name: `ynx-core-${digest.slice(0, 32)}`, status: "Stopped", profiles: [configuration.profileName],
    config: { "user.ynx.core.identity": digest, "user.ynx.core.runtime": context.runtimeId, "volatile.uuid": uuid, "volatile.base_image": image },
    expanded_config: { "security.privileged": "false", "security.nesting": "false", "security.devlxd": "false", "security.idmap.isolated": "true", "limits.cpu": "2", "limits.memory": String(CORE_LIMITS.memoryBytes), "limits.processes": "256" },
    expanded_devices: { root: { type: "disk", pool: configuration.storagePool, path: "/", size: "4GiB" }, core: { type: "disk", source: configuration.artifactRoot, path: "/opt/openvscode", readonly: "true" },
      project: { type: "disk", source: context.projectDirectory, path: "/project", shift: "true" }, eth0: { type: "nic", network: configuration.networkName, "security.acls": configuration.acl } } };
}
test("actual inspect fields reject privileged, extra socket/proxy mounts, host path and incorrect quota", () => {
  const context = { identityDigest: digest, runtimeId: "runtime-test", projectDirectory: "/state/project", limits: CORE_LIMITS };
  assert.doesNotThrow(() => assertLxdIsolation(instance(context), context, configuration));
  for (const change of [v => { v.expanded_config["security.privileged"] = "true"; }, v => { v.expanded_devices.socket = { type: "disk", source: "/var/run/docker.sock" }; }, v => { v.expanded_devices.project.source = "/"; }, v => { delete v.expanded_devices.root.size; }, v => { v.config["user.ynx.core.runtime"] = "other"; }]) {
    const value = instance(context); change(value); assert.throws(() => assertLxdIsolation(value, context, configuration));
  }
});
test("partial prepared container is safely cancellable only with exact identity and child-empty state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ynx-lxd-stop-"));
  const context = { directory, identityDigest: digest, runtimeId: "runtime-test", projectDirectory: join(directory, "project"), limits: CORE_LIMITS };
  const value = instance(context); delete value.expanded_devices.project;
  await writeFile(join(directory, "lxd-receipt.json"), JSON.stringify({ identityDigest: digest, runtimeId: context.runtimeId }));
  let calls = [], state = { status: "Stopped", pid: 0, processes: 0 };
  const driver = createLxdCoreDriver({ ...configuration, run: async args => { calls.push(args); return { stdout: JSON.stringify(args[0] === "query" ? state : [value]) }; } });
  assert.equal((await driver.stop(context)).neverStarted, true);
  assert.equal(calls.some(args => args[0] === "stop"), false);
  state.processes = 1; await assert.rejects(driver.stop(context), { code: "core_processes_running" });
  value.config["user.ynx.core.runtime"] = "other"; await assert.rejects(driver.stop(context), { code: "core_identity_mismatch" });
});
test("a durable start-issued record survives restart and never misclassifies a previously started stopped instance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ynx-lxd-issued-"));
  const context = { directory, identityDigest: digest, runtimeId: "runtime-test", projectDirectory: join(directory, "project"), limits: CORE_LIMITS };
  const value = instance(context);
  await writeFile(join(directory, "lxd-receipt.json"), JSON.stringify({ identityDigest: digest, runtimeId: context.runtimeId }));
  await writeFile(join(directory, "lxd-instance-id"), uuid);
  await writeFile(join(directory, "lxd-start-issued"), uuid);
  const driver = createLxdCoreDriver({ ...configuration, run: async args => ({ stdout: JSON.stringify(args[0] === "query" ? { status: "Stopped", pid: 0, processes: 0 } : [value]) }) });
  assert.equal((await driver.stop(context)).neverStarted, false);
  await writeFile(join(directory, "lxd-start-issued"), "another-instance");
  await assert.rejects(driver.stop(context), { code: "core_identity_mismatch" });
});
