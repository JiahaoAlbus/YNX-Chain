import test from "node:test";
import assert from "node:assert/strict";
import { acquireProductionLease } from "./security-production-lease.mjs";

const context = "ynx-production";
const operatorId = "production-operator";
const changeId = "change-20260727-production";
const token = "11111111-2222-4333-8444-555555555555";

function fixture(existing = null) {
  const calls = [];
  let lease = existing;
  let revision = Number(existing?.metadata?.resourceVersion ?? 0);
  const execFile = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (command !== "kubectl") throw new Error("unexpected command");
    if (args.includes("get")) return lease === null ? "" : JSON.stringify(lease);
    if (args.includes("create")) {
      if (lease !== null) throw new Error("conflict");
      lease = JSON.parse(options.input);
      revision += 1;
      lease.metadata.resourceVersion = String(revision);
      return JSON.stringify(lease);
    }
    if (args.includes("replace")) {
      const candidate = JSON.parse(options.input);
      if (lease === null || candidate.metadata.resourceVersion !== lease.metadata.resourceVersion) {
        throw new Error("conflict");
      }
      lease = candidate;
      revision += 1;
      lease.metadata.resourceVersion = String(revision);
      return JSON.stringify(lease);
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  return { calls, execFile, lease: () => lease };
}

function clock(...values) {
  return () => values.shift();
}

function existingLease({
  holderIdentity = "ynx:other:change:22222222-3333-4444-8555-666666666666",
  renewTime = "2026-07-27T02:59:30.000Z",
  duration = 600,
} = {}) {
  return {
    apiVersion: "coordination.k8s.io/v1",
    kind: "Lease",
    metadata: {
      name: "ynx-production-release-lock",
      namespace: "default",
      resourceVersion: "7",
    },
    spec: {
      holderIdentity,
      acquireTime: "2026-07-27T02:50:00.000Z",
      renewTime,
      leaseDurationSeconds: duration,
      leaseTransitions: 2,
    },
  };
}

test("creates, renews, and CAS-releases a production Lease", () => {
  const cluster = fixture();
  const lease = acquireProductionLease({
    context,
    operatorId,
    changeId,
    action: "production-deployment",
    durationSeconds: 600,
    execFile: cluster.execFile,
    uuid: () => token,
    now: clock(
      new Date("2026-07-27T03:00:00.000Z"),
      new Date("2026-07-27T03:05:00.000Z"),
      new Date("2026-07-27T03:06:00.000Z"),
    ),
  });
  assert.equal(lease.receipt.leaseDurationSeconds, 600);
  const renewal = lease.renew();
  assert.equal(renewal.renewedAt, "2026-07-27T03:05:00.000Z");
  const released = lease.release();
  assert.equal(released.expired, true);
  assert.equal(cluster.lease().spec.holderIdentity, "ynx-released");
  assert.equal(cluster.calls.filter((call) => call.args.includes("replace")).length, 2);
});

test("rejects a non-expired Lease without mutation", () => {
  const cluster = fixture(existingLease());
  assert.throws(
    () => acquireProductionLease({
      context,
      operatorId,
      changeId,
      action: "production-deployment",
      execFile: cluster.execFile,
      uuid: () => token,
      now: () => new Date("2026-07-27T03:00:00.000Z"),
    }),
    /locked by another active operator/,
  );
  assert.equal(cluster.calls.some((call) => call.args.includes("replace")), false);
});

test("atomically takes over an expired Lease and increments transitions", () => {
  const cluster = fixture(existingLease({
    renewTime: "2026-07-27T02:30:00.000Z",
    duration: 300,
  }));
  const lease = acquireProductionLease({
    context,
    operatorId,
    changeId,
    action: "production-blue-green-update",
    execFile: cluster.execFile,
    uuid: () => token,
    now: clock(
      new Date("2026-07-27T03:00:00.000Z"),
      new Date("2026-07-27T03:01:00.000Z"),
    ),
  });
  assert.equal(cluster.lease().spec.leaseTransitions, 3);
  assert.match(cluster.lease().spec.holderIdentity, new RegExp(token));
  lease.release();
});

test("renewal fails closed after resourceVersion ownership drift", () => {
  const cluster = fixture();
  const lease = acquireProductionLease({
    context,
    operatorId,
    changeId,
    action: "production-manual-rollback",
    execFile: cluster.execFile,
    uuid: () => token,
    now: clock(
      new Date("2026-07-27T03:00:00.000Z"),
      new Date("2026-07-27T03:01:00.000Z"),
    ),
  });
  cluster.lease().metadata.resourceVersion = "999";
  assert.throws(() => lease.renew(), /lost production Lease ownership/);
});

test("release fails closed when another holder replaced the Lease", () => {
  const cluster = fixture();
  const lease = acquireProductionLease({
    context,
    operatorId,
    changeId,
    action: "production-deployment",
    execFile: cluster.execFile,
    uuid: () => token,
    now: clock(
      new Date("2026-07-27T03:00:00.000Z"),
      new Date("2026-07-27T03:01:00.000Z"),
    ),
  });
  cluster.lease().spec.holderIdentity = "ynx:other:holder:33333333-4444-4555-8666-777777777777";
  assert.throws(() => lease.release(), /lost production Lease ownership/);
});

test("an expired holder cannot revive or release its Lease", () => {
  const renewalCluster = fixture();
  const renewalLease = acquireProductionLease({
    context,
    operatorId,
    changeId,
    action: "production-deployment",
    durationSeconds: 300,
    execFile: renewalCluster.execFile,
    uuid: () => token,
    now: clock(
      new Date("2026-07-27T03:00:00.000Z"),
      new Date("2026-07-27T03:05:00.000Z"),
    ),
  });
  assert.throws(() => renewalLease.renew(), /expired before renewal/);

  const releaseCluster = fixture();
  const releaseLease = acquireProductionLease({
    context,
    operatorId,
    changeId,
    action: "production-deployment",
    durationSeconds: 300,
    execFile: releaseCluster.execFile,
    uuid: () => token,
    now: clock(
      new Date("2026-07-27T03:00:00.000Z"),
      new Date("2026-07-27T03:05:00.000Z"),
    ),
  });
  assert.throws(() => releaseLease.release(), /expired before release/);
});

test("invalid duration and token are rejected before cluster access", () => {
  const cluster = fixture();
  assert.throws(
    () => acquireProductionLease({
      context,
      operatorId,
      changeId,
      action: "production-deployment",
      durationSeconds: 60,
      execFile: cluster.execFile,
    }),
    /between 300 and 1800/,
  );
  assert.throws(
    () => acquireProductionLease({
      context,
      operatorId,
      changeId,
      action: "production-deployment",
      execFile: cluster.execFile,
      uuid: () => "not-a-uuid",
    }),
    /invalid UUID/,
  );
  assert.equal(cluster.calls.length, 0);
});
