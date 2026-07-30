import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStagingReleaseFiles,
  deployStagingReleaseInput,
  preflightStagingReleaseInput,
  validateStagingReleaseInputs,
  writeStagingReleaseOverlay,
} from "./security-stage-release.mjs";
import { validateStagingReleaseManifest } from "./security-deploy.mjs";

const sourceCommit = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const context = "ynx-staging";
const clusterUid = "11111111-2222-3333-4444-555555555555";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function input() {
  return {
    schemaVersion: 1,
    sourceCommit,
    quantWorkerImage: {
      repository: "registry.staging.ynxweb4.com/security/quant-worker",
      digest: imageDigest,
    },
    backupOperatorImage: {
      repository: "registry.staging.ynxweb4.com/security/backup-operator",
      digest: imageDigest,
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

function backupCronJob(name, extraEnv = "") {
  return `---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${name}
  namespace: ynx-services-staging
spec:
  suspend: true
  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: backup
        spec:
          serviceAccountName: backup-operator
          securityContext:
            runAsNonRoot: true
          containers:
            - name: backup
              image: ynx/backup-operator:candidate
              securityContext:
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
                capabilities:
                  drop:
                    - ALL
              env:
                - name: BACKUP_DESTINATION
                  value: "candidate"
                - name: SOURCE_COMMIT
                  value: "auto"
${extraEnv}
`;
}

function candidateManifest() {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ynx-services-staging
  labels:
    environment: staging
    security.ynx/manifest-class: deployment-candidate
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: backup-operator
  namespace: ynx-services-staging
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quant-worker
  namespace: ynx-services-staging
spec:
  replicas: 1
  template:
    spec:
      securityContext:
        runAsNonRoot: true
      containers:
        - name: worker
          image: ynx/quant-worker:candidate
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
${backupCronJob("chain-state-backup", `              volumeMounts:
                - name: chain-data
                  mountPath: /data
          volumes:
            - name: chain-data
              persistentVolumeClaim:
                claimName: chain-data`)}
${backupCronJob("database-backup", `                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: database-credentials
                      key: url`)}
${backupCronJob("object-storage-backup", `                - name: SOURCE_BUCKET
                  value: "candidate"`)}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: ynx-services-staging
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: strict
  namespace: ynx-services-staging
spec:
  mtls:
    mode: STRICT
`;
}

function renderGeneratedOverlay() {
  const workspace = mkdtempSync(resolve(tmpdir(), "ynx-staging-release-"));
  const staging = resolve(workspace, "staging");
  const release = resolve(workspace, "staging-release");
  mkdirSync(staging, { recursive: true });
  mkdirSync(release, { recursive: true });
  writeFileSync(resolve(staging, "kustomization.yaml"), `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - candidate.yaml
labels:
  - pairs:
      security.ynx/manifest-class: deployment-candidate
    includeSelectors: false
images:
  - name: ynx/quant-worker
    newTag: candidate
  - name: ynx/backup-operator
    newTag: candidate
`);
  writeFileSync(resolve(staging, "candidate.yaml"), candidateManifest());
  for (const [name, content] of buildStagingReleaseFiles(input())) {
    writeFileSync(resolve(release, name), content);
  }
  return execFileSync("kubectl", ["kustomize", release], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function deploymentFixture(rendered) {
  const calls = [];
  const execFile = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (command === "git" && args[0] === "rev-parse") return `${sourceCommit}\n`;
    if (command === "git" && args[0] === "status") return "";
    if (command !== "kubectl") throw new Error("unexpected command");
    if (args[0] === "kustomize") return rendered;
    if (args[0] === "config") return `${context}\n`;
    if (args.includes("kube-system")) return JSON.stringify({ metadata: { uid: clusterUid } });
    if (args.includes("version")) return JSON.stringify({ serverVersion: { gitVersion: "v1.33.1" } });
    if (args.includes("--dry-run=server")) return "server dry-run passed";
    if (args.includes("apply")) return "resources applied";
    if (args.includes("diff")) return "";
    if (args.includes("rollout")) return "rollout complete";
    if (args.includes("namespace") && args.includes("ynx-services-staging")) {
      return JSON.stringify({ metadata: { labels: { environment: "staging" } } });
    }
    if (args.includes("deployment")) {
      return JSON.stringify({
        items: [{
          metadata: { generation: 2 },
          spec: { replicas: 1 },
          status: { observedGeneration: 2, availableReplicas: 1 },
        }],
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
    throw new Error(`unexpected kubectl args: ${args.join(" ")}`);
  };
  return { calls, execFile };
}

test("validated inputs generate a deployable staging release overlay", () => {
  const rendered = renderGeneratedOverlay();
  const result = validateStagingReleaseManifest(rendered, { sourceCommit });
  const deployment = rendered
    .split(/^---\s*$/m)
    .find((document) => /^kind:\s*Deployment$/m.test(document));
  assert.equal(result.pass, true, `${result.failures.join("\n")}\n${deployment}`);
  assert.equal(result.images.length, 4);
  assert.equal(result.images.every((image) => image.endsWith(`@${imageDigest}`)), true);
  assert.match(rendered, /kind: SecretProviderClass/);
  assert.match(rendered, /name: allow-backup-private-endpoints/);
  assert.doesNotMatch(rendered, /deployment-candidate/);
  assert.doesNotMatch(rendered, /^kind: Secret$/m);
});

test("operator input renders ephemerally and binds cluster preflight to its digest", () => {
  const rendered = renderGeneratedOverlay();
  const fixture = deploymentFixture(rendered);
  const { receipt } = preflightStagingReleaseInput({
    input: input(),
    context,
    expectedClusterUid: clusterUid,
    execFile: fixture.execFile,
    now: new Date("2026-07-26T14:00:00.000Z"),
  });
  assert.equal(receipt.overlay, "generated-from-operator-input");
  assert.match(receipt.releaseInputSha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.serverDryRunPassed, true);
  assert.equal(receipt.mutationPerformed, false);
  const renderCall = fixture.calls.find((call) => call.args[0] === "kustomize");
  assert.ok(renderCall);
  assert.equal(existsSync(resolve(renderCall.args[1], "../../..")), false);
  assert.equal(fixture.calls.filter((call) => call.args[0] === "kustomize").length, 1);
});

test("accepted operator input reaches apply and verified readiness without a tracked overlay", () => {
  const rendered = renderGeneratedOverlay();
  const fixture = deploymentFixture(rendered);
  const evidencePath = `evidence/security-platform/.security-stage-release-${process.pid}.json`;
  try {
    const result = deployStagingReleaseInput({
      input: input(),
      context,
      expectedClusterUid: clusterUid,
      operatorId: "staging-operator",
      changeId: "change-20260726-stage-release",
      acknowledge: "apply-staging",
      evidencePath,
      execFile: fixture.execFile,
      now: (() => {
        const values = [
          new Date("2026-07-26T14:00:00.000Z"),
          new Date("2026-07-26T14:01:00.000Z"),
        ];
        return () => values.shift();
      })(),
    });
    assert.equal(result.state, "deployed-staging-verified");
    assert.equal(result.deployedStaging, true);
    assert.match(result.releaseInputSha256, /^[0-9a-f]{64}$/);
    assert.equal(JSON.parse(readFileSync(resolve(root, evidencePath), "utf8")).releaseInputSha256, result.releaseInputSha256);
    const applyCalls = fixture.calls.filter((call) => call.args.includes("apply"));
    assert.equal(applyCalls.length, 2);
    assert.equal(applyCalls[0].args.includes("--dry-run=server"), true);
    assert.equal(applyCalls[1].args.includes("--dry-run=server"), false);
  } finally {
    rmSync(resolve(root, evidencePath), { force: true });
  }
});

test("generated overlay contains references and controls but no value material", () => {
  const files = buildStagingReleaseFiles(input());
  const serialized = [...files.values()].join("\n");
  assert.match(serialized, /eks\.amazonaws\.com\/role-arn/);
  assert.match(serialized, /secrets-store\.csi\.x-k8s\.io/);
  assert.match(serialized, /secretProviderClass: ynx-staging-secrets/);
  assert.match(serialized, /10\.20\.0\.0\/24/);
  assert.doesNotMatch(serialized, /SecretString|secretValue|privateKey|password:/i);
});

test("promotion rejects mutable images, cross-account secrets, public CIDRs, and fake storage", () => {
  assert.throws(
    () => validateStagingReleaseInputs({
      ...input(),
      quantWorkerImage: { repository: "registry.staging.ynxweb4.com/security/quant-worker", digest: "latest" },
    }),
    /digest must be sha256/,
  );
  assert.throws(
    () => validateStagingReleaseInputs({
      ...input(),
      databaseCredentialSecretArn: "arn:aws:secretsmanager:ap-southeast-1:999999999999:secret:ynx/staging/database-url-AbCdEf",
    }),
    /share partition, account, and region/,
  );
  assert.throws(
    () => validateStagingReleaseInputs({
      ...input(),
      awsEndpointCidrs: ["0.0.0.0/0"],
    }),
    /accepted CIDR boundary|private network range/,
  );
  assert.throws(
    () => validateStagingReleaseInputs({
      ...input(),
      objectDestination: "s3://placeholder-bucket/objects",
    }),
    /real S3 URI/,
  );
});

test("promotion rejects credential-like extra fields and output overwrite paths", () => {
  assert.throws(
    () => validateStagingReleaseInputs({
      ...input(),
      credentialValue: "forbidden",
    }),
    /unknown fields: credentialValue/,
  );
  assert.throws(
    () => writeStagingReleaseOverlay(input(), resolve(tmpdir(), "outside-staging-release")),
    /output must be infra\/k8s\/overlays\/staging-release/,
  );
});
