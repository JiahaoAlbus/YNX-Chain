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
  const driver = createLxdCoreDriver({ ...configuration, run: async args => { calls.push(args); return { stdout: JSON.stringify(args.includes("--raw") ? { type: "sync", status_code: 200, metadata: { running: [] } } : args[0] === "query" ? state : [value]) }; } });
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
  const driver = createLxdCoreDriver({ ...configuration, run: async args => ({ stdout: JSON.stringify(args.includes("--raw") ? { type: "sync", status_code: 200, metadata: { running: [] } } : args[0] === "query" ? { status: "Stopped", pid: 0, processes: 0 } : [value]) }) });
  assert.equal((await driver.stop(context)).neverStarted, false);
  await writeFile(join(directory, "lxd-start-issued"), "another-instance");
  await assert.rejects(driver.stop(context), { code: "core_identity_mismatch" });
});

async function operationsFixture({ journal = true, present = true, initial = "Stopped", pending = false, timeout = false, foreign = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "ynx-lxd-operations-"));
  const context = { directory, identityDigest: digest, runtimeId: "runtime-test", projectDirectory: join(directory, "project"), limits: CORE_LIMITS };
  const value = instance(context); value.status = initial;
  const resource = `/1.0/instances/${value.name}`, operation = { id: uuid, class: "task", status_code: pending ? 103 : 200, resources: { instances: [resource] } };
  const calls = [], stopId = "87654321-1234-1234-1234-123456789012";
  await writeFile(join(directory, "lxd-receipt.json"), JSON.stringify({ identityDigest: digest, runtimeId: context.runtimeId }));
  if (present) { await writeFile(join(directory, "lxd-instance-id"), uuid); await writeFile(join(directory, "lxd-start-issued"), uuid); }
  if (journal) {
    await writeFile(join(directory, "lxd-operation-start-issued.json"), JSON.stringify({ identityDigest: digest, runtimeId: context.runtimeId, resource }));
    await writeFile(join(directory, "lxd-operation-start-operation.json"), JSON.stringify(operation));
  }
  let shouldPend = pending, shouldTimeout = timeout;
  const run = async args => {
    calls.push(args);
    if (!args.includes("--raw")) return { stdout: JSON.stringify(args[0] === "query" ? { status: value.status, pid: value.status === "Stopped" ? 0 : 1, processes: value.status === "Stopped" ? 0 : 1 } : present ? [value] : []) };
    const method = args[3], path = args[4];
    if (path.includes("/operations?")) {
      const listed = foreign ? { ...operation, status_code: 103, resources: { instances: ["/1.0/instances/foreign"] } } : shouldPend ? operation : null;
      return { stdout: JSON.stringify({ type: "sync", status_code: 200, metadata: { running: listed ? [listed] : [] } }) };
    }
    if (method === "PUT") return { stdout: JSON.stringify({ type: "async", status_code: 100, operation: `/1.0/operations/${stopId}`, metadata: { ...operation, id: stopId, status_code: 103 } }) };
    if (path.includes("/wait?")) {
      if (shouldTimeout) throw Object.assign(new Error("transport timeout"), { code: "core_driver_timeout", status: 503 });
      const stopping = path.includes(stopId);
      if (!shouldPend) value.status = stopping ? "Stopped" : "Running";
      return { stdout: JSON.stringify({ type: "sync", status_code: 200, metadata: { ...operation, id: stopping ? stopId : uuid, status_code: shouldPend ? 103 : 200 } }) };
    }
    throw new Error(`Unexpected operation query ${method} ${path}`);
  };
  return { context, calls, value, resource, driver: () => createLxdCoreDriver({ ...configuration, run }), settle: () => { shouldPend = false; shouldTimeout = false; } };
}
test("pending start while Stopped cannot release; after late Running it settles and exact Stop/cold Stop succeed", async () => {
  const f = await operationsFixture({ pending: true });
  await assert.rejects(f.driver().stop(f.context), { code: "core_operation_pending" });
  assert.equal(f.calls.some(args => args[0] === "list"), false); // no Stopped shortcut
  f.settle(); const stopped = await f.driver().stop(f.context); assert.equal(stopped.stopped, true); assert.equal(stopped.neverStarted, false);
  assert.equal(f.calls.filter(args => args[3] === "PUT").length, 1);
  const reopened = f.driver(); assert.equal((await reopened.stop(f.context)).stopped, true); // durable terminal receipts after service restart
});
test("operation wait transport timeout retains unresolved issued identity for a later Stop", async () => {
  const f = await operationsFixture({ pending: true, timeout: true });
  await assert.rejects(f.driver().stop(f.context), { code: "core_driver_timeout" });
  assert.equal(f.calls.some(args => args[3] === "PUT"), false);
  f.settle(); assert.equal((await f.driver().stop(f.context)).stopped, true);
});
test("no instance while exact create is pending cannot claim never started; foreign operation is never waited/cancelled", async () => {
  const pending = await operationsFixture({ journal: false, present: false, pending: true });
  await assert.rejects(pending.driver().stop(pending.context), { code: "core_operation_pending" });
  assert.equal(pending.calls.some(args => args[0] === "list"), false);
  const foreign = await operationsFixture({ journal: false, foreign: true });
  assert.equal((await foreign.driver().stop(foreign.context)).stopped, true);
  assert.equal(foreign.calls.some(args => args[3] !== "GET" && args.includes("--raw") || args.some(value => value.includes("/wait?"))), false);
});
test("issued mutation with lost response ID stays guarded even if operation list and instance are absent", async () => {
  const f = await operationsFixture({ journal: false, present: false });
  await writeFile(join(f.context.directory, "lxd-operation-init-issued.json"), JSON.stringify({ identityDigest: digest, runtimeId: f.context.runtimeId, resource: f.resource }));
  await assert.rejects(f.driver().stop(f.context), { code: "core_operation_unconfirmed" });
  assert.equal(f.calls.length, 0);
});
