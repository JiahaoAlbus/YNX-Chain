import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanaryManifest,
  preflightStagingCanary,
  promoteStagingCanary,
  validateCanaryInputs,
} from "./security-staging-canary.mjs";
import {
  renderStagingReleaseManifest,
  stagingReleaseInputSha256,
} from "./security-stage-release.mjs";
import { validateRollbackTarget } from "./security-staging-rollback.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stableCommit = "a".repeat(40);
const candidateCommit = "c".repeat(40);
const stableDigest = `sha256:${"b".repeat(64)}`;
const candidateDigest = `sha256:${"d".repeat(64)}`;
const backupDigest = `sha256:${"e".repeat(64)}`;
const context = "ynx-staging";
const clusterUid = "11111111-2222-3333-4444-555555555555";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function releaseInput(sourceCommit, quantDigest) {
  return {
    schemaVersion: 1,
    sourceCommit,
    quantWorkerImage: {
      repository: "registry.staging.ynxweb4.com/security/quant-worker",
      digest: quantDigest,
    },
    backupOperatorImage: {
      repository: "registry.staging.ynxweb4.com/security/backup-operator",
      digest: backupDigest,
    },
    awsRegion: "ap-southeast-1",
    backupOperatorRoleArn: "arn:aws:iam::123456789012:role/ynx-staging-backup",
    backupEncryptionSecretArn: "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/staging/backup-key-AbCdEf",
    databaseCredentialSecretArn: "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/staging/database-url-AbCdEf",
    chainStateDestination: "s3://ynx-staging-chain-backup/state",
    chainStateReplicaDestination: "s3://ynx-staging-chain-replica/state",
    databaseDestination: "s3://ynx-staging-database-backup/postgres",
    objectSourceBucket: "ynx-staging-artifacts",
    objectDestination: "s3://ynx-staging-object-backup/objects",
    chainStatePvcName: "chain-data-staging",
    awsEndpointCidrs: ["10.20.0.0/24", "10.20.1.0/24"],
    databaseEndpointCidrs: ["10.30.0.0/24"],
    databasePort: 5432,
  };
}

function stableInput() {
  return releaseInput(stableCommit, stableDigest);
}

function candidateInput() {
  return releaseInput(candidateCommit, candidateDigest);
}

function verifiedEvidence(manifest) {
  return {
    schemaVersion: 1,
    action: "staging-deployment",
    sourceCommit: stableCommit,
    releaseInputSha256: stagingReleaseInputSha256(stableInput()),
    manifestSha256: sha256(manifest),
    state: "deployed-staging-verified",
    mutationPerformed: true,
    deployedStaging: true,
    rolloutVerified: true,
    liveManifestReconciled: true,
    readiness: { pass: true },
  };
}

function writeJson(relativePath, value) {
  const absolute = resolve(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(absolute, bytes, { mode: 0o600 });
  return { absolute, digest: sha256(bytes) };
}

function deployment({
  name,
  sourceCommit,
  image,
  ready = true,
}) {
  return {
    metadata: {
      name,
      generation: 4,
      labels: { "security.ynx/source-commit": sourceCommit },
    },
    spec: {
      replicas: 1,
      template: { spec: { containers: [{ name: "worker", image }] } },
    },
    status: {
      observedGeneration: ready ? 4 : 3,
      availableReplicas: ready ? 1 : 0,
      updatedReplicas: ready ? 1 : 0,
      unavailableReplicas: ready ? 0 : 1,
    },
  };
}

function clusterFixture(candidateManifest, {
  canaryHealthy = true,
  candidateRolloutFails = false,
} = {}) {
  const calls = [];
  const stableImage = `${stableInput().quantWorkerImage.repository}@${stableDigest}`;
  const candidateImage = `${candidateInput().quantWorkerImage.repository}@${candidateDigest}`;
  const execFile = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (command === "git" && args[0] === "rev-parse") return `${candidateCommit}\n`;
    if (command === "git" && args[0] === "status") return "";
    if (command !== "kubectl") throw new Error("unexpected command");
    if (args[0] === "kustomize") return candidateManifest;
    if (args[0] === "config") return `${context}\n`;
    if (args.includes("kube-system")) return JSON.stringify({ metadata: { uid: clusterUid } });
    if (args.includes("version")) return JSON.stringify({ serverVersion: { gitVersion: "v1.33.1" } });
    if (args.includes("--dry-run=server")) return "server dry-run passed";
    if (args.includes("apply")) return options.input.includes("quant-worker-canary")
      ? "canary deployment applied"
      : "candidate release applied";
    if (args.includes("diff")) return "";
    if (args.includes("rollout")) {
      if (candidateRolloutFails && args.includes("--all")) throw new Error("candidate rollout failed");
      return "rollout complete";
    }
    if (args.includes("delete")) return "deployment.apps quant-worker-canary deleted";
    if (args.includes("get") && args.includes("deployment") && args.includes("quant-worker-canary")) {
      return JSON.stringify(deployment({
        name: "quant-worker-canary",
        sourceCommit: candidateCommit,
        image: candidateImage,
        ready: canaryHealthy,
      }));
    }
    if (args.includes("get") && args.includes("deployment") && args.includes("quant-worker")) {
      return JSON.stringify(deployment({
        name: "quant-worker",
        sourceCommit: stableCommit,
        image: stableImage,
      }));
    }
    if (args.includes("pods") && args.includes("app=quant-worker-canary")) {
      return JSON.stringify({
        items: [{
          metadata: {},
          status: {
            phase: "Running",
            conditions: [{ type: "Ready", status: canaryHealthy ? "True" : "False" }],
            containerStatuses: [{
              ready: canaryHealthy,
              restartCount: canaryHealthy ? 0 : 1,
              image: candidateImage,
              imageID: `docker-pullable://${candidateImage}`,
            }],
          },
        }],
      });
    }
    if (args.includes("namespace") && args.includes("ynx-services-staging")) {
      return JSON.stringify({ metadata: { labels: { environment: "staging" } } });
    }
    if (args.includes("deployment")) {
      return JSON.stringify({
        items: [deployment({
          name: "quant-worker",
          sourceCommit: candidateCommit,
          image: candidateImage,
        })],
      });
    }
    if (args.includes("pods")) {
      return JSON.stringify({
        items: [{ status: { conditions: [{ type: "Ready", status: "True" }] } }],
      });
    }
    if (args.includes("networkpolicy")) {
      return JSON.stringify({ items: [{ metadata: { name: "default-deny-all" } }] });
    }
    if (args.includes("peerauthentication")) {
      return JSON.stringify({ items: [{ spec: { mtls: { mode: "STRICT" } } }] });
    }
    if (args.includes("cronjob")) return JSON.stringify({ items: [{ spec: { suspend: false } }] });
    if (args.includes("secretproviderclass")) {
      return JSON.stringify({ items: [{ metadata: { name: "ynx-staging-secrets" } }] });
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { calls, execFile };
}

test("canary input permits only a new quant-worker image and source commit", () => {
  const result = validateCanaryInputs({
    stableInput: stableInput(),
    candidateInput: candidateInput(),
    runtimeSourceCommit: candidateCommit,
    observationSeconds: 60,
    sampleIntervalSeconds: 30,
  });
  assert.equal(result.sampleCount, 3);
  assert.equal(validateCanaryInputs({
    stableInput: stableInput(),
    candidateInput: candidateInput(),
    runtimeSourceCommit: candidateCommit,
    observationSeconds: 65,
    sampleIntervalSeconds: 30,
  }).sampleCount, 4);
  assert.throws(
    () => validateCanaryInputs({
      stableInput: stableInput(),
      candidateInput: { ...candidateInput(), databasePort: 5433 },
      runtimeSourceCommit: candidateCommit,
    }),
    /cannot change infrastructure field/,
  );
  assert.throws(
    () => validateCanaryInputs({
      stableInput: stableInput(),
      candidateInput: releaseInput(candidateCommit, stableDigest),
      runtimeSourceCommit: candidateCommit,
    }),
    /different quant-worker image/,
  );
  assert.throws(
    () => validateCanaryInputs({
      stableInput: stableInput(),
      candidateInput: candidateInput(),
      runtimeSourceCommit: "f".repeat(40),
    }),
    /must match the executing runtime commit/,
  );
});

test("canary manifest isolates selectors while preserving sandbox controls", () => {
  const candidateManifest = renderStagingReleaseManifest(candidateInput());
  const canary = buildCanaryManifest(candidateManifest, {
    sourceCommit: candidateCommit,
    image: candidateInput().quantWorkerImage,
  });
  assert.match(canary, /name: quant-worker-canary/);
  assert.equal((canary.match(/app: quant-worker-canary/g) ?? []).length, 3);
  assert.match(canary, /security\.ynx\/release-track: canary/);
  assert.match(canary, new RegExp(`image: .+@${candidateDigest}`));
  assert.match(canary, /security\.ynx\/workload: quant-worker/);
  assert.match(canary, /allowPrivilegeEscalation: false/);
  assert.doesNotMatch(canary, /^kind: (?:CronJob|SecretProviderClass)$/m);
});

test("canary preflight binds verified stable state and both server dry-runs", () => {
  const stableManifest = renderStagingReleaseManifest(stableInput());
  const candidateManifest = renderStagingReleaseManifest(candidateInput());
  const evidencePath = `evidence/security-platform/.canary-stable-${process.pid}-preflight.json`;
  const stable = writeJson(evidencePath, verifiedEvidence(stableManifest));
  const fixture = clusterFixture(candidateManifest);
  try {
    const { receipt } = preflightStagingCanary({
      stableInput: stableInput(),
      candidateInput: candidateInput(),
      stableEvidencePath: evidencePath,
      stableEvidenceSha256: stable.digest,
      runtimeSourceCommit: candidateCommit,
      context,
      expectedClusterUid: clusterUid,
      observationSeconds: 60,
      sampleIntervalSeconds: 30,
      execFile: fixture.execFile,
      now: new Date("2026-07-26T16:00:00.000Z"),
    });
    assert.equal(receipt.action, "staging-canary-preflight");
    assert.equal(receipt.stableSourceCommit, stableCommit);
    assert.equal(receipt.stableEvidenceSha256, stable.digest);
    assert.equal(receipt.canaryServerDryRunPassed, true);
    assert.equal(receipt.requiredSamples, 3);
    assert.equal(receipt.mutationPerformed, false);
    assert.equal(fixture.calls.filter((call) => call.args.includes("--dry-run=server")).length, 2);
    assert.equal(fixture.calls.some((call) => call.args.includes("delete")), false);
  } finally {
    rmSync(stable.absolute, { force: true });
  }
});

test("healthy canary promotes the complete release and is removed", () => {
  const stableManifest = renderStagingReleaseManifest(stableInput());
  const candidateManifest = renderStagingReleaseManifest(candidateInput());
  const stablePath = `evidence/security-platform/.canary-stable-${process.pid}-success.json`;
  const resultPath = `evidence/security-platform/.canary-result-${process.pid}-success.json`;
  const stable = writeJson(stablePath, verifiedEvidence(stableManifest));
  const fixture = clusterFixture(candidateManifest);
  const waits = [];
  try {
    const result = promoteStagingCanary({
      stableInput: stableInput(),
      candidateInput: candidateInput(),
      stableEvidencePath: stablePath,
      stableEvidenceSha256: stable.digest,
      runtimeSourceCommit: candidateCommit,
      context,
      expectedClusterUid: clusterUid,
      observationSeconds: 60,
      sampleIntervalSeconds: 30,
      operatorId: "staging-operator",
      changeId: "change-20260726-canary",
      acknowledge: "promote-staging-canary",
      evidencePath: resultPath,
      execFile: fixture.execFile,
      wait: (milliseconds) => waits.push(milliseconds),
      now: (() => {
        const values = [
          new Date("2026-07-26T16:00:00.000Z"),
          new Date("2026-07-26T16:00:00.000Z"),
          new Date("2026-07-26T16:00:30.000Z"),
          new Date("2026-07-26T16:01:00.000Z"),
          new Date("2026-07-26T16:01:01.000Z"),
          new Date("2026-07-26T16:01:02.000Z"),
          new Date("2026-07-26T16:01:03.000Z"),
        ];
        return () => values.shift();
      })(),
    });
    assert.equal(result.action, "staging-canary-promotion");
    assert.equal(result.state, "deployed-staging-verified");
    assert.equal(result.deployedStaging, true);
    assert.equal(result.canaryObservationPassed, true);
    assert.equal(result.canaryRemoved, true);
    assert.equal(result.canarySamples.length, 3);
    assert.equal(result.canaryObservedMilliseconds, 60000);
    assert.deepEqual(waits, [30000, 30000]);
    const resultBytes = readFileSync(resolve(root, resultPath));
    assert.equal(JSON.parse(resultBytes).stableEvidenceSha256, stable.digest);
    assert.equal(validateRollbackTarget({
      input: candidateInput(),
      evidenceBytes: resultBytes,
      expectedEvidenceSha256: sha256(resultBytes),
      runtimeSourceCommit: "f".repeat(40),
    }).input.sourceCommit, candidateCommit);
    const mutationCalls = fixture.calls.filter((call) => (
      call.args.includes("apply") && !call.args.includes("--dry-run=server")
    ));
    assert.equal(mutationCalls.length, 2);
    assert.equal(fixture.calls.filter((call) => call.args.includes("delete")).length, 1);
  } finally {
    rmSync(stable.absolute, { force: true });
    rmSync(resolve(root, resultPath), { force: true });
  }
});

test("unhealthy canary is removed before the complete candidate can mutate", () => {
  const stableManifest = renderStagingReleaseManifest(stableInput());
  const candidateManifest = renderStagingReleaseManifest(candidateInput());
  const stablePath = `evidence/security-platform/.canary-stable-${process.pid}-failure.json`;
  const resultPath = `evidence/security-platform/.canary-result-${process.pid}-failure.json`;
  const stable = writeJson(stablePath, verifiedEvidence(stableManifest));
  const fixture = clusterFixture(candidateManifest, { canaryHealthy: false });
  try {
    assert.throws(
      () => promoteStagingCanary({
        stableInput: stableInput(),
        candidateInput: candidateInput(),
        stableEvidencePath: stablePath,
        stableEvidenceSha256: stable.digest,
        runtimeSourceCommit: candidateCommit,
        context,
        expectedClusterUid: clusterUid,
        observationSeconds: 60,
        sampleIntervalSeconds: 30,
        operatorId: "staging-operator",
        changeId: "change-20260726-canary-failure",
        acknowledge: "promote-staging-canary",
        evidencePath: resultPath,
        execFile: fixture.execFile,
        wait: () => {
          throw new Error("wait must not run after a failed first sample");
        },
        now: (() => {
          const values = [
            new Date("2026-07-26T16:00:00.000Z"),
            new Date("2026-07-26T16:00:01.000Z"),
            new Date("2026-07-26T16:00:02.000Z"),
          ];
          return () => values.shift();
        })(),
      }),
      /canary health failed/,
    );
    const result = JSON.parse(readFileSync(resolve(root, resultPath), "utf8"));
    assert.equal(result.state, "canary-promotion-failed");
    assert.equal(result.canaryRemoved, true);
    assert.equal(result.candidateMutationPerformed, false);
    assert.equal(result.deployedStaging, false);
    const mutationCalls = fixture.calls.filter((call) => (
      call.args.includes("apply") && !call.args.includes("--dry-run=server")
    ));
    assert.equal(mutationCalls.length, 1);
    assert.match(mutationCalls[0].input, /quant-worker-canary/);
    assert.equal(fixture.calls.filter((call) => call.args.includes("delete")).length, 1);
  } finally {
    rmSync(stable.absolute, { force: true });
    rmSync(resolve(root, resultPath), { force: true });
  }
});

test("candidate rollout failure preserves applied mutation truth before canary cleanup", () => {
  const stableManifest = renderStagingReleaseManifest(stableInput());
  const candidateManifest = renderStagingReleaseManifest(candidateInput());
  const stablePath = `evidence/security-platform/.canary-stable-${process.pid}-rollout.json`;
  const resultPath = `evidence/security-platform/.canary-result-${process.pid}-rollout.json`;
  const stable = writeJson(stablePath, verifiedEvidence(stableManifest));
  const fixture = clusterFixture(candidateManifest, { candidateRolloutFails: true });
  const rollbackCalls = [];
  try {
    assert.throws(
      () => promoteStagingCanary({
        stableInput: stableInput(),
        candidateInput: candidateInput(),
        stableEvidencePath: stablePath,
        stableEvidenceSha256: stable.digest,
        runtimeSourceCommit: candidateCommit,
        context,
        expectedClusterUid: clusterUid,
        observationSeconds: 60,
        sampleIntervalSeconds: 30,
        operatorId: "staging-operator",
        changeId: "change-20260726-canary-rollout",
        acknowledge: "promote-staging-canary",
        evidencePath: resultPath,
        execFile: fixture.execFile,
        rollback: (options) => {
          rollbackCalls.push(options);
          return {
            state: "deployed-staging-verified",
            sourceCommit: stableCommit,
            manifestSha256: sha256(stableManifest),
            rollbackTargetEvidenceSha256: stable.digest,
            deployedStaging: true,
          };
        },
        wait: () => {},
        now: (() => {
          const values = [
            new Date("2026-07-26T16:00:00.000Z"),
            new Date("2026-07-26T16:00:00.000Z"),
            new Date("2026-07-26T16:00:30.000Z"),
            new Date("2026-07-26T16:01:00.000Z"),
            new Date("2026-07-26T16:01:01.000Z"),
            new Date("2026-07-26T16:01:02.000Z"),
            new Date("2026-07-26T16:01:03.000Z"),
          ];
          return () => values.shift();
        })(),
      }),
      /rollout verification failed/,
    );
    const result = JSON.parse(readFileSync(resolve(root, resultPath), "utf8"));
    assert.equal(result.state, "candidate-promotion-failed-stable-restored");
    assert.equal(result.promotionFailureState, "apply-completed-verification-failed");
    assert.equal(result.candidateMutationPerformed, true);
    assert.equal(result.mutationPerformed, true);
    assert.equal(result.canaryRemoved, true);
    assert.equal(result.automaticRollbackAttempted, true);
    assert.equal(result.stableRestored, true);
    assert.equal(result.deployedStaging, true);
    assert.equal(rollbackCalls.length, 1);
    assert.equal(rollbackCalls[0].acknowledge, "rollback-staging");
    assert.equal(rollbackCalls[0].input.sourceCommit, stableCommit);
    const mutationCalls = fixture.calls.filter((call) => (
      call.args.includes("apply") && !call.args.includes("--dry-run=server")
    ));
    assert.equal(mutationCalls.length, 2);
  } finally {
    rmSync(stable.absolute, { force: true });
    rmSync(resolve(root, resultPath), { force: true });
  }
});
