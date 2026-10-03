import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDeveloperCoreAdmission } from "../src/admission.mjs";
import { OPENVSCODE_X64 } from "../src/upstream.mjs";

const sessionId = "01234567-1234-4321-8765-0123456789ab", runtimeId = "11234567-1234-4321-8765-0123456789ab";
const context = { sessionId, runtimeId, owner: "a".repeat(64), projectId: "project-a", directory: "/state/native/session", projectDirectory: "/volumes/project" };
context.identityDigest = createHash("sha256").update(`${context.owner}\n${context.projectId}\n${runtimeId}\n${sessionId}`).digest("hex");
function driver(overrides = {}) {
  return { upstream: OPENVSCODE_X64, projectsRoot: "/volumes", calls: [],
    async start(value) { this.calls.push(["start", value]); return { running: true, runtimeId: value.runtimeId }; },
    async stop(value) { this.calls.push(["stop", value]); return { stopped: true, runtimeId: value.runtimeId, identityDigest: value.identityDigest }; },
    async connect(value) { this.calls.push(["connect", value]); return { socket: { destroy() {} }, tokenMode: "private-loopback-without-connection-token" }; },
    ...overrides };
}
const compose = value => createDeveloperCoreAdmission({ driver: value || driver(), architecture: "linux-x64", executionDomain: "ynx-runtime.example" });

test("canonical session hosts map identically after composition restart without creating an authority registry", () => {
  const first = compose(), next = compose(), host = `${sessionId}.ynx-runtime.example`;
  assert.equal(first.launchURL(context), `https://${host}/`);
  assert.equal(next.originForSession(sessionId), first.originForSession(sessionId));
  assert.equal(next.sessionForHost(host), sessionId);
  for (const value of [host + ":443", host + ".attacker.example", host.toUpperCase(), `extra.${host}`, host + "/", "developer.ynxweb4.com", undefined])
    assert.equal(first.sessionForHost(value), null);
  assert.throws(() => first.originForSession("../project"), { code: "core_proxy_origin_invalid" });
});

test("operator composition fails closed on absent driver, architecture drift and unsafe execution domains", () => {
  for (const executionDomain of ["developer.ynxweb4.com", "ynxweb4.com", "native.ynxweb4.com", "https://runtime.example", "Runtime.example", "runtime.example:443", "runtime.example/", "127.0.0.1", "localhost", "runtime.local", "runtime.example.", "-bad.example"])
    assert.throws(() => createDeveloperCoreAdmission({ driver: driver(), architecture: "linux-x64", executionDomain }), TypeError);
  for (const value of [undefined, {}, driver({ upstream: { ...OPENVSCODE_X64, sha256: "0".repeat(64) } }), driver({ projectsRoot: "/volumes/../other" })])
    assert.throws(() => createDeveloperCoreAdmission({ driver: value, architecture: "linux-x64", executionDomain: "runtime.example" }), TypeError);
  assert.throws(() => createDeveloperCoreAdmission({ driver: driver(), architecture: "linux-arm64", executionDomain: "runtime.example" }), TypeError);
});

test("driver calls retain the exact durable context and driver receiver; changed tuples execute nothing", async () => {
  const actual = driver(), admission = compose(actual);
  await admission.driver.start(context); await admission.driver.connect(context); await admission.driver.stop(context);
  assert.deepEqual(actual.calls.map(row => row[0]), ["start", "connect", "stop"]);
  assert.ok(actual.calls.every(row => row[1] === context));
  for (const method of ["start", "connect", "stop"])
    await assert.rejects(admission.driver[method]({ ...context, projectId: "other-project" }), { code: "core_context_invalid" });
  assert.equal(actual.calls.length, 3);
});

test("uncertain start/Stop and token-bearing listener results fail; rejected socket is closed", async () => {
  const admission = compose(driver({ start: async () => ({ running: true, runtimeId: "other" }), stop: async () => ({ stopped: true, ...context, identityDigest: "other" }) }));
  await assert.rejects(admission.driver.start(context), { code: "core_start_unconfirmed" });
  await assert.rejects(admission.driver.stop(context), { code: "core_processes_unconfirmed" });
  let closed = false;
  const unsafe = compose(driver({ connect: async () => ({ socket: { destroy() { closed = true; } }, tokenMode: "connection-token" }) }));
  await assert.rejects(unsafe.driver.connect(context), { code: "core_isolation_invalid" });
  assert.equal(closed, true);
});

test('reviewed composed workbench uses the same normal admission and rejects a changed or legacy session artifact before execution', async () => {
  const artifact = { kind: 'ynx-theia', version: '1.76.0', architecture: 'linux-x64', lockSha256: '1'.repeat(64), manifestSha256: '2'.repeat(64), treeSha256: '3'.repeat(64) };
  const actual = driver({ runtimeArtifact: artifact });
  const admission = createDeveloperCoreAdmission({ driver: actual, architecture: 'linux-x64', executionDomain: 'ynx-runtime.example', runtimeArtifact: artifact });
  const value = { ...context, image: { ...artifact } };
  await admission.driver.start(value); await admission.driver.connect(value); await admission.driver.stop(value);
  assert.equal(actual.calls.length, 3);
  for (const method of ['start', 'connect', 'stop']) {
    await assert.rejects(admission.driver[method](context), { code: 'core_artifact_mismatch' });
    await assert.rejects(admission.driver[method]({ ...value, image: { ...artifact, treeSha256: '4'.repeat(64) } }), { code: 'core_artifact_mismatch' });
  }
  assert.equal(actual.calls.length, 3);
  assert.throws(() => compose(actual), TypeError);
  assert.throws(() => createDeveloperCoreAdmission({ driver: actual, architecture: 'linux-arm64', executionDomain: 'ynx-runtime.example', runtimeArtifact: artifact }), TypeError);
  await assert.rejects(compose().driver.stop(value), { code: 'core_artifact_mismatch' });
});
