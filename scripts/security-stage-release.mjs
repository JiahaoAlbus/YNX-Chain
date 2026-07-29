#!/usr/bin/env node
/**
 * Promote the staging deployment candidate into a commit-bound release overlay.
 *
 * Inputs are non-secret infrastructure references. The generator never accepts
 * credential values. It writes a reviewable Kustomize overlay that remains
 * undeployed until security-deploy.mjs completes cluster preflight and apply.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deployStaging,
  preflightStagingDeployment,
} from "./security-deploy.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = resolve(root, "infra/k8s/overlays/staging-release");
const inputFields = new Set([
  "schemaVersion",
  "sourceCommit",
  "quantWorkerImage",
  "backupOperatorImage",
  "awsRegion",
  "backupOperatorRoleArn",
  "backupEncryptionSecretArn",
  "databaseCredentialSecretArn",
  "chainStateDestination",
  "chainStateReplicaDestination",
  "databaseDestination",
  "objectSourceBucket",
  "objectDestination",
  "chainStatePvcName",
  "awsEndpointCidrs",
  "databaseEndpointCidrs",
  "databasePort",
]);
const imageFields = new Set(["repository", "digest"]);

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be --name value pairs");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertExactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((field) => !fields.has(field));
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(",")}`);
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  return value;
}

function safeName(value, label) {
  requiredString(value, label);
  if (!/^[a-z0-9][a-z0-9.-]{2,127}$/.test(value)) throw new Error(`${label} must be a safe name`);
  return value;
}

function validateSourceCommit(value) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) throw new Error("sourceCommit must be a full Git SHA");
}

function yamlString(value) {
  return JSON.stringify(value);
}

function validateImage(image, label) {
  assertExactFields(image, imageFields, label);
  const repository = requiredString(image.repository, `${label} repository`);
  const digest = requiredString(image.digest, `${label} digest`);
  if (!/^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+$/.test(repository)) {
    throw new Error(`${label} repository must include an explicit OCI registry`);
  }
  const registry = repository.split("/")[0];
  if (
    !registry.includes(".")
    || registry === "localhost"
    || registry.endsWith(".invalid")
    || /(?:example|placeholder)/i.test(repository)
  ) {
    throw new Error(`${label} repository is not an accepted registry reference`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`${label} digest must be sha256`);
  return { repository, digest };
}

function parseRoleArn(value) {
  const match = requiredString(value, "backupOperatorRoleArn")
    .match(/^arn:(aws(?:-us-gov|-cn)?):iam::([0-9]{12}):role\/([A-Za-z0-9+=,.@_/-]{1,128})$/);
  if (!match) throw new Error("backupOperatorRoleArn must be a full IAM role ARN");
  return { partition: match[1], accountId: match[2] };
}

function parseSecretArn(value, label) {
  const match = requiredString(value, label)
    .match(/^arn:(aws(?:-us-gov|-cn)?):secretsmanager:([a-z0-9-]+):([0-9]{12}):secret:([A-Za-z0-9/_+=.@-]+)$/);
  if (!match) throw new Error(`${label} must be a full Secrets Manager ARN`);
  return {
    partition: match[1],
    region: match[2],
    accountId: match[3],
  };
}

function s3Uri(value, label) {
  const match = requiredString(value, label).match(/^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/[A-Za-z0-9!_.*'()/-]+)?$/);
  if (!match || /(?:example|placeholder|candidate)/i.test(value)) throw new Error(`${label} must be a real S3 URI`);
  return { uri: value, bucket: match[1] };
}

function privateIpv4Cidr(value, label) {
  const match = requiredString(value, label).match(/^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\/([0-9]{1,2})$/);
  if (!match) throw new Error(`${label} must be an IPv4 CIDR`);
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((octet) => octet < 0 || octet > 255) || prefix < 8 || prefix > 32) {
    throw new Error(`${label} is outside the accepted CIDR boundary`);
  }
  const isPrivate = octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
  if (!isPrivate) throw new Error(`${label} must use a private network range`);
  return value;
}

export function validateStagingReleaseInputs(input) {
  assertExactFields(input, inputFields, "staging release input");
  if (input.schemaVersion !== 1) throw new Error("staging release input schemaVersion must be 1");
  validateSourceCommit(input.sourceCommit);
  const quantWorkerImage = validateImage(input.quantWorkerImage, "quantWorkerImage");
  const backupOperatorImage = validateImage(input.backupOperatorImage, "backupOperatorImage");
  if (!/^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]$/.test(input.awsRegion ?? "")) {
    throw new Error("awsRegion is invalid");
  }
  const role = parseRoleArn(input.backupOperatorRoleArn);
  const backupSecret = parseSecretArn(input.backupEncryptionSecretArn, "backupEncryptionSecretArn");
  const databaseSecret = parseSecretArn(input.databaseCredentialSecretArn, "databaseCredentialSecretArn");
  for (const secret of [backupSecret, databaseSecret]) {
    if (
      secret.partition !== role.partition
      || secret.accountId !== role.accountId
      || secret.region !== input.awsRegion
    ) {
      throw new Error("role and secret references must share partition, account, and region");
    }
  }
  if (input.backupEncryptionSecretArn === input.databaseCredentialSecretArn) {
    throw new Error("backup and database credentials must use separate manager objects");
  }
  const chain = s3Uri(input.chainStateDestination, "chainStateDestination");
  const chainReplica = s3Uri(input.chainStateReplicaDestination, "chainStateReplicaDestination");
  const database = s3Uri(input.databaseDestination, "databaseDestination");
  const object = s3Uri(input.objectDestination, "objectDestination");
  if (new Set([chain.bucket, chainReplica.bucket, database.bucket, object.bucket]).size < 4) {
    throw new Error("backup destinations must use separate buckets");
  }
  const objectSourceBucket = safeName(input.objectSourceBucket, "objectSourceBucket");
  if ([chain.bucket, chainReplica.bucket, database.bucket, object.bucket].includes(objectSourceBucket)) {
    throw new Error("object source bucket must differ from backup destinations");
  }
  const chainStatePvcName = safeName(input.chainStatePvcName, "chainStatePvcName");
  if (!Array.isArray(input.awsEndpointCidrs) || input.awsEndpointCidrs.length === 0) {
    throw new Error("awsEndpointCidrs must not be empty");
  }
  if (!Array.isArray(input.databaseEndpointCidrs) || input.databaseEndpointCidrs.length === 0) {
    throw new Error("databaseEndpointCidrs must not be empty");
  }
  const awsEndpointCidrs = input.awsEndpointCidrs.map((value, index) => (
    privateIpv4Cidr(value, `awsEndpointCidrs[${index}]`)
  ));
  const databaseEndpointCidrs = input.databaseEndpointCidrs.map((value, index) => (
    privateIpv4Cidr(value, `databaseEndpointCidrs[${index}]`)
  ));
  if (new Set(awsEndpointCidrs).size !== awsEndpointCidrs.length) throw new Error("awsEndpointCidrs must be unique");
  if (new Set(databaseEndpointCidrs).size !== databaseEndpointCidrs.length) throw new Error("databaseEndpointCidrs must be unique");
  if (!Number.isInteger(input.databasePort) || input.databasePort < 1 || input.databasePort > 65535) {
    throw new Error("databasePort must be between 1 and 65535");
  }
  return {
    ...input,
    quantWorkerImage,
    backupOperatorImage,
    objectSourceBucket,
    chainStatePvcName,
    awsEndpointCidrs,
    databaseEndpointCidrs,
  };
}

function volumePatch() {
  return `          volumeMounts:
            - name: runtime-secrets
              mountPath: /mnt/secrets-store
              readOnly: true
        volumes:
          - name: runtime-secrets
            csi:
              driver: secrets-store.csi.k8s.io
              readOnly: true
              volumeAttributes:
                secretProviderClass: ynx-staging-secrets`;
}

function cronPatch(name, environment, extraVolumes = "") {
  return `  - target:
      kind: CronJob
      name: ${name}
    patch: |-
      apiVersion: batch/v1
      kind: CronJob
      metadata:
        name: ${name}
        namespace: ynx-services-staging
      spec:
        suspend: false
        jobTemplate:
          spec:
            template:
              spec:
                containers:
                  - name: backup
                    env:
${environment}
${volumePatch()}
${extraVolumes}`;
}

function envValue(name, value) {
  return `                      - name: ${name}
                        value: ${yamlString(value)}`;
}

function cidrEgress(cidrs, port) {
  return cidrs.map((cidr) => `      - ipBlock:
          cidr: ${yamlString(cidr)}`).join("\n");
}

export function buildStagingReleaseFiles(rawInput) {
  const input = validateStagingReleaseInputs(rawInput);
  const chainEnv = [
    envValue("BACKUP_DESTINATION", input.chainStateDestination),
    envValue("BACKUP_CROSS_REGION_REPLICA", input.chainStateReplicaDestination),
    envValue("SOURCE_COMMIT", input.sourceCommit),
  ].join("\n");
  const databaseEnv = [
    envValue("BACKUP_DESTINATION", input.databaseDestination),
    envValue("SOURCE_COMMIT", input.sourceCommit),
  ].join("\n");
  const objectEnv = [
    envValue("SOURCE_BUCKET", input.objectSourceBucket),
    envValue("BACKUP_DESTINATION", input.objectDestination),
    envValue("SOURCE_COMMIT", input.sourceCommit),
  ].join("\n");

  const kustomization = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../staging
  - secret-provider-class.yaml
  - backup-egress-policy.yaml

labels:
  - pairs:
      security.ynx/manifest-class: staging-release
      security.ynx/source-commit: ${input.sourceCommit}
    includeSelectors: false

images:
  - name: ynx/quant-worker
    newName: ${input.quantWorkerImage.repository}
    digest: ${input.quantWorkerImage.digest}
  - name: ynx/backup-operator
    newName: ${input.backupOperatorImage.repository}
    digest: ${input.backupOperatorImage.digest}

patches:
  - target:
      kind: ServiceAccount
      name: backup-operator
    patch: |-
      apiVersion: v1
      kind: ServiceAccount
      metadata:
        name: backup-operator
        namespace: ynx-services-staging
        annotations:
          eks.amazonaws.com/role-arn: ${yamlString(input.backupOperatorRoleArn)}
${cronPatch("chain-state-backup", chainEnv, `
                volumes:
                  - name: chain-data
                    persistentVolumeClaim:
                      claimName: ${input.chainStatePvcName}`)}
${cronPatch("database-backup", databaseEnv)}
${cronPatch("object-storage-backup", objectEnv)}
`;

  const secretProvider = `apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: ynx-staging-secrets
  namespace: ynx-services-staging
  labels:
    security.ynx/manifest-class: staging-release
    security.ynx/source-commit: ${input.sourceCommit}
spec:
  provider: aws
  secretObjects:
    - secretName: backup-encryption-key
      type: Opaque
      data:
        - objectName: backup-encryption-key
          key: key
    - secretName: database-credentials
      type: Opaque
      data:
        - objectName: database-url
          key: url
  parameters:
    region: ${yamlString(input.awsRegion)}
    usePodIdentity: "false"
    objects: |
      - objectName: ${yamlString(input.backupEncryptionSecretArn)}
        objectType: "secretsmanager"
        objectAlias: "backup-encryption-key"
      - objectName: ${yamlString(input.databaseCredentialSecretArn)}
        objectType: "secretsmanager"
        objectAlias: "database-url"
`;

  const egressPolicy = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backup-private-endpoints
  namespace: ynx-services-staging
  labels:
    security.ynx/manifest-class: staging-release
    security.ynx/source-commit: ${input.sourceCommit}
spec:
  podSelector:
    matchLabels:
      app: backup
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - to:
${cidrEgress(input.awsEndpointCidrs, 443)}
      ports:
        - protocol: TCP
          port: 443
    - to:
${cidrEgress(input.databaseEndpointCidrs, input.databasePort)}
      ports:
        - protocol: TCP
          port: ${input.databasePort}
`;

  return new Map([
    ["kustomization.yaml", kustomization],
    ["secret-provider-class.yaml", secretProvider],
    ["backup-egress-policy.yaml", egressPolicy],
  ]);
}

export function writeStagingReleaseOverlay(input, output = outputDirectory) {
  if (resolve(output) !== outputDirectory) {
    throw new Error("staging release output must be infra/k8s/overlays/staging-release");
  }
  if (existsSync(output) && readdirSync(output).length > 0) {
    throw new Error("staging release output already exists and is not empty");
  }
  const files = buildStagingReleaseFiles(input);
  mkdirSync(output, { recursive: true });
  for (const [name, content] of files) {
    writeFileSync(resolve(output, name), content.endsWith("\n") ? content : `${content}\n`, { mode: 0o644 });
  }
  return {
    schemaVersion: 1,
    action: "staging-release-overlay-generated",
    source: "operator-supplied non-secret infrastructure references",
    sourceCommit: input.sourceCommit,
    version: "1",
    asOf: new Date().toISOString(),
    confidence: "validated-input-and-deterministic-generation",
    inputSha256: sha256(Buffer.from(canonicalJson(input))),
    output: "infra/k8s/overlays/staging-release",
    files: [...files].map(([name, content]) => ({
      name,
      sha256: sha256(content),
      bytes: Buffer.byteLength(content),
    })),
    secretValueIncluded: false,
    deployedStaging: false,
    deployedPublic: false,
  };
}

export function renderStagingReleaseManifest(rawInput, {
  execFile = execFileSync,
  kubernetesSourceRoot = resolve(root, "infra/k8s"),
} = {}) {
  const input = validateStagingReleaseInputs(rawInput);
  const sourceRoot = resolve(kubernetesSourceRoot);
  if (!existsSync(resolve(sourceRoot, "overlays/staging/kustomization.yaml"))) {
    throw new Error("Kubernetes source root does not contain the staging overlay");
  }
  const workspace = mkdtempSync(resolve(tmpdir(), "ynx-staging-release-runtime-"));
  const copiedKubernetesRoot = resolve(workspace, "infra/k8s");
  const generatedOverlay = resolve(copiedKubernetesRoot, "overlays/staging-release");
  try {
    cpSync(sourceRoot, copiedKubernetesRoot, { recursive: true });
    if (existsSync(generatedOverlay)) {
      throw new Error("temporary staging release overlay unexpectedly exists");
    }
    mkdirSync(generatedOverlay, { recursive: true });
    for (const [name, content] of buildStagingReleaseFiles(input)) {
      writeFileSync(resolve(generatedOverlay, name), content.endsWith("\n") ? content : `${content}\n`, { mode: 0o600 });
    }
    try {
      const manifest = execFile("kubectl", ["kustomize", generatedOverlay], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (typeof manifest !== "string" || manifest.trim() === "") {
        throw new Error("Kustomize render returned no manifest");
      }
      return manifest;
    } catch {
      throw new Error("ephemeral staging release render failed");
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function stagingReleaseInputSha256(rawInput) {
  const input = validateStagingReleaseInputs(rawInput);
  return sha256(Buffer.from(canonicalJson(input)));
}

function acceptedInput(rawInput) {
  const input = validateStagingReleaseInputs(rawInput);
  return {
    input,
    releaseInputSha256: stagingReleaseInputSha256(input),
  };
}

export function preflightStagingReleaseInput({
  input: rawInput,
  context,
  expectedClusterUid,
  execFile = execFileSync,
  now = new Date(),
}) {
  const { input, releaseInputSha256 } = acceptedInput(rawInput);
  const manifest = renderStagingReleaseManifest(input, { execFile });
  return preflightStagingDeployment({
    context,
    expectedClusterUid,
    sourceCommit: input.sourceCommit,
    manifest,
    releaseInputSha256,
    execFile,
    now,
  });
}

export function deployStagingReleaseInput({
  input: rawInput,
  context,
  expectedClusterUid,
  operatorId,
  changeId,
  acknowledge,
  evidencePath,
  rolloutTimeoutSeconds = 300,
  execFile = execFileSync,
  now = () => new Date(),
}) {
  const { input, releaseInputSha256 } = acceptedInput(rawInput);
  const manifest = renderStagingReleaseManifest(input, { execFile });
  return deployStaging({
    context,
    expectedClusterUid,
    sourceCommit: input.sourceCommit,
    manifest,
    releaseInputSha256,
    operatorId,
    changeId,
    acknowledge,
    evidencePath,
    rolloutTimeoutSeconds,
    execFile,
    now,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    const input = JSON.parse(readFileSync(resolve(args.input), "utf8"));
    let result;
    if (command === "promote") {
      result = writeStagingReleaseOverlay(input);
    } else if (command === "preflight") {
      ({ receipt: result } = preflightStagingReleaseInput({
        input,
        context: args.context,
        expectedClusterUid: args["cluster-uid"],
      }));
    } else if (command === "deploy") {
      result = deployStagingReleaseInput({
        input,
        context: args.context,
        expectedClusterUid: args["cluster-uid"],
        operatorId: args["operator-id"],
        changeId: args["change-id"],
        acknowledge: args.acknowledge,
        evidencePath: args.evidence,
        rolloutTimeoutSeconds: Number(args["rollout-timeout-seconds"] ?? 300),
      });
    } else {
      throw new Error("usage: security-stage-release.mjs promote|preflight|deploy --input PATH [deployment flags]");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
