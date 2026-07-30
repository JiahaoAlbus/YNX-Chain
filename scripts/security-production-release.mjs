#!/usr/bin/env node
/**
 * Prepare and verify a production release promotion.
 *
 * The deterministic signing payload binds a verified staging canary, immutable
 * container images, supply-chain evidence, and the rendered production
 * manifest. This runtime verifies an external production signature but cannot
 * create one.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
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
  assertPublicArtifactEligible,
  verifyManifestSignature,
} from "./security-artifact.mjs";
import { validateRenderedManifest } from "./security-integration.mjs";
import {
  stagingReleaseInputSha256,
  validateStagingReleaseInputs,
} from "./security-stage-release.mjs";
import {
  materializeKubernetesTreeAtCommit,
  validateRollbackTarget,
} from "./security-staging-rollback.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const productionNamespace = "ynx-services";
const productionManifestClass = "production-release";
const expectedPublicHosts = new Set([
  "rpc.ynxweb4.com",
  "evm.ynxweb4.com",
  "rest.ynxweb4.com",
  "faucet.ynxweb4.com",
  "indexer.ynxweb4.com",
  "explorer.ynxweb4.com",
  "ai.ynxweb4.com",
  "web4.ynxweb4.com",
]);
const attestationFields = new Set([
  "schemaVersion",
  "kind",
  "product",
  "version",
  "sourceCommit",
  "releaseInputSha256",
  "stagingCanaryEvidenceSha256",
  "productionManifestSha256",
  "publicProbePolicySha256",
  "signerPolicySha256",
  "images",
  "approval",
  "publicReleaseEligible",
  "signing",
]);
const imageEvidenceFields = new Set([
  "sbomPath",
  "sbomSha256",
  "provenancePath",
  "provenanceSha256",
  "scanEvidencePath",
  "scanEvidenceSha256",
]);
const approvalFields = new Set(["approvalId", "approvedAt", "expiresAt", "approvers"]);
const signerPolicyFields = new Set(["schemaVersion", "policyId", "environment", "approvedBy", "signers"]);
const signerFields = new Set([
  "identity",
  "fingerprint",
  "purpose",
  "status",
  "validFrom",
  "validUntil",
]);
const probePolicyFields = new Set([
  "schemaVersion",
  "environment",
  "tlsHosts",
  "services",
  "connectTimeoutSeconds",
  "totalTimeoutSeconds",
  "maxResponseBytes",
]);
const probeServiceFields = new Set(["name", "host", "healthPath", "versionPath"]);
const expectedProbeServices = new Map([
  ["ai-gateway", "ai.ynxweb4.com"],
  ["faucet", "faucet.ynxweb4.com"],
  ["indexer", "indexer.ynxweb4.com"],
  ["web4-hub", "web4.ynxweb4.com"],
]);

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((field) => !fields.has(field));
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(",")}`);
}

function fullCommit(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) throw new Error(`${label} must be a full Git SHA`);
  return value;
}

function digest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) throw new Error(`${label} must be sha256`);
  return value;
}

function fingerprint(value) {
  if (!/^sha256:[0-9a-f]{64}$/.test(value ?? "")) {
    throw new Error("trustedSignerFingerprint must be a sha256 fingerprint");
  }
  return value;
}

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  return value;
}

function repositoryPath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath === "") throw new Error(`${label} is required`);
  const absolute = resolve(root, relativePath);
  if (!absolute.startsWith(`${root}/`)) throw new Error(`${label} must stay inside the repository`);
  return absolute;
}

function externalOutputPath(path, label) {
  if (typeof path !== "string" || path === "") throw new Error(`${label} is required`);
  const absolute = resolve(path);
  if (absolute === root || absolute.startsWith(`${root}/`)) {
    throw new Error(`${label} must stay outside the Git worktree`);
  }
  return absolute;
}

function imageReference(image) {
  return `${image.repository}@${image.digest}`;
}

function gitPreflight(execFile, runtimeSourceCommit) {
  fullCommit(runtimeSourceCommit, "runtimeSourceCommit");
  let head;
  let status;
  try {
    head = execFile("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    status = execFile("git", ["status", "--porcelain=v1"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("production release Git preflight failed");
  }
  if (head !== runtimeSourceCommit) throw new Error("runtimeSourceCommit does not match Git HEAD");
  if (status !== "") throw new Error("production release preparation requires a clean Git worktree");
}

function validateApproval(rawApproval, now) {
  exactObject(rawApproval, approvalFields, "production approval");
  const approvalId = safeIdentifier(rawApproval.approvalId, "approvalId");
  if (!Array.isArray(rawApproval.approvers) || rawApproval.approvers.length < 2) {
    throw new Error("production approval requires at least two approvers");
  }
  const approvers = rawApproval.approvers.map((value) => safeIdentifier(value, "approver"));
  if (new Set(approvers).size !== approvers.length) {
    throw new Error("production approval requires distinct approvers");
  }
  const approvedAt = Date.parse(rawApproval.approvedAt);
  const expiresAt = Date.parse(rawApproval.expiresAt);
  if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) || approvedAt >= expiresAt) {
    throw new Error("production approval window is invalid");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("production release clock is invalid");
  }
  if (approvedAt > now.getTime() || expiresAt <= now.getTime()) {
    throw new Error("production approval is not currently valid");
  }
  if (expiresAt - approvedAt > 24 * 60 * 60 * 1000) {
    throw new Error("production approval window must not exceed 24 hours");
  }
  return {
    approvalId,
    approvedAt: new Date(approvedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    approvers,
  };
}

function readEvidenceFile(path, expectedSha256, label) {
  digest(expectedSha256, `${label} sha256`);
  let bytes;
  try {
    bytes = readFileSync(resolve(path));
  } catch {
    throw new Error(`${label} read failed`);
  }
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
    throw new Error(`${label} size is invalid`);
  }
  if (sha256(bytes) !== expectedSha256) throw new Error(`${label} digest mismatch`);
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return value;
}

function validateImageEvidence(rawEvidence, productionInput, now) {
  exactObject(rawEvidence, new Set(["quantWorker", "backupOperator"]), "imageEvidence");
  const result = {};
  for (const [role, image] of [
    ["quantWorker", productionInput.quantWorkerImage],
    ["backupOperator", productionInput.backupOperatorImage],
  ]) {
    exactObject(rawEvidence[role], imageEvidenceFields, `${role} evidence`);
    const sbomSha256 = digest(rawEvidence[role].sbomSha256, `${role} sbomSha256`);
    const provenanceSha256 = digest(rawEvidence[role].provenanceSha256, `${role} provenanceSha256`);
    const scanEvidenceSha256 = digest(rawEvidence[role].scanEvidenceSha256, `${role} scanEvidenceSha256`);
    const sbom = readEvidenceFile(rawEvidence[role].sbomPath, sbomSha256, `${role} SBOM`);
    const provenance = readEvidenceFile(
      rawEvidence[role].provenancePath,
      provenanceSha256,
      `${role} provenance`,
    );
    const scan = readEvidenceFile(
      rawEvidence[role].scanEvidencePath,
      scanEvidenceSha256,
      `${role} scan evidence`,
    );
    const scannedAt = Date.parse(scan.scannedAt);
    const databaseUpdatedAt = Date.parse(scan.databaseUpdatedAt);
    if (
      sbom.bomFormat !== "CycloneDX"
      || typeof sbom.specVersion !== "string"
      || !Array.isArray(sbom.components)
    ) {
      throw new Error(`${role} SBOM is not a CycloneDX component inventory`);
    }
    if (
      provenance.predicateType !== "https://slsa.dev/provenance/v1"
      || !Array.isArray(provenance.subject)
      || !provenance.subject.some((subject) => subject.digest?.sha256 === image.digest.slice(7))
    ) {
      throw new Error(`${role} provenance is not bound to the image digest`);
    }
    if (
      scan.schemaVersion !== 1
      || scan.imageReference !== imageReference(image)
      || scan.imageDigest !== image.digest
      || scan.result !== "passed"
      || scan.findings?.critical !== 0
      || scan.findings?.high !== 0
      || typeof scan.scanner !== "string"
      || !Number.isFinite(scannedAt)
      || !Number.isFinite(databaseUpdatedAt)
      || scannedAt > now.getTime()
      || now.getTime() - scannedAt > 24 * 60 * 60 * 1000
      || databaseUpdatedAt > scannedAt
      || scannedAt - databaseUpdatedAt > 7 * 24 * 60 * 60 * 1000
    ) {
      throw new Error(`${role} scan evidence does not prove a current clean image scan`);
    }
    result[role] = {
      sbomSha256,
      provenanceSha256,
      scanEvidenceSha256,
    };
  }
  return result;
}

function validateSignerPolicy({
  signerPolicyPath,
  signerPolicySha256,
  trustedSignerFingerprint,
  now,
}) {
  digest(signerPolicySha256, "signerPolicySha256");
  const policy = readEvidenceFile(
    signerPolicyPath,
    signerPolicySha256,
    "production signer policy",
  );
  exactObject(policy, signerPolicyFields, "production signer policy");
  if (
    policy.schemaVersion !== 1
    || policy.environment !== "production"
    || typeof policy.policyId !== "string"
    || !Array.isArray(policy.approvedBy)
    || policy.approvedBy.length < 2
    || new Set(policy.approvedBy).size !== policy.approvedBy.length
    || !policy.approvedBy.every((value) => /^[A-Za-z0-9._:@/-]{3,256}$/.test(value))
    || !Array.isArray(policy.signers)
  ) {
    throw new Error("production signer policy identity or approval is invalid");
  }
  const matches = policy.signers.filter((signer) => signer?.fingerprint === trustedSignerFingerprint);
  if (matches.length !== 1) throw new Error("trusted signer is not uniquely authorized by policy");
  const signer = matches[0];
  exactObject(signer, signerFields, "production signer");
  const validFrom = Date.parse(signer.validFrom);
  const validUntil = Date.parse(signer.validUntil);
  if (
    signer.status !== "active"
    || signer.purpose !== "production-release-signing"
    || typeof signer.identity !== "string"
    || !Number.isFinite(validFrom)
    || !Number.isFinite(validUntil)
    || validFrom > now.getTime()
    || validUntil <= now.getTime()
  ) {
    throw new Error("production signer is not active for release signing");
  }
  return {
    policyId: policy.policyId,
    signerIdentity: signer.identity,
    signerPolicySha256,
  };
}

export function validatePublicProbePolicy({
  publicProbePolicyPath,
  publicProbePolicySha256,
}) {
  digest(publicProbePolicySha256, "publicProbePolicySha256");
  const policy = readEvidenceFile(
    publicProbePolicyPath,
    publicProbePolicySha256,
    "public probe policy",
  );
  exactObject(policy, probePolicyFields, "public probe policy");
  if (
    policy.schemaVersion !== 1
    || policy.environment !== "production"
    || !Array.isArray(policy.tlsHosts)
    || policy.tlsHosts.length !== expectedPublicHosts.size
    || new Set(policy.tlsHosts).size !== policy.tlsHosts.length
    || policy.tlsHosts.some((host) => !expectedPublicHosts.has(host))
    || !Array.isArray(policy.services)
    || policy.services.length !== expectedProbeServices.size
    || !Number.isInteger(policy.connectTimeoutSeconds)
    || policy.connectTimeoutSeconds < 1
    || policy.connectTimeoutSeconds > 10
    || !Number.isInteger(policy.totalTimeoutSeconds)
    || policy.totalTimeoutSeconds < policy.connectTimeoutSeconds
    || policy.totalTimeoutSeconds > 30
    || !Number.isInteger(policy.maxResponseBytes)
    || policy.maxResponseBytes < 1024
    || policy.maxResponseBytes > 1024 * 1024
  ) {
    throw new Error("public probe policy boundary is invalid");
  }
  const serviceNames = new Set();
  for (const service of policy.services) {
    exactObject(service, probeServiceFields, "public probe service");
    if (
      serviceNames.has(service.name)
      || expectedProbeServices.get(service.name) !== service.host
      || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(service.healthPath)
      || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(service.versionPath)
      || service.healthPath.includes("..")
      || service.versionPath.includes("..")
      || service.healthPath === service.versionPath
    ) {
      throw new Error("public probe service mapping is invalid");
    }
    serviceNames.add(service.name);
  }
  return {
    policy,
    publicProbePolicySha256,
  };
}

function validatePromotionInputs({
  stagingInput: rawStagingInput,
  productionInput: rawProductionInput,
  runtimeSourceCommit,
  version,
}) {
  const stagingInput = validateStagingReleaseInputs(rawStagingInput);
  const productionInput = validateStagingReleaseInputs(rawProductionInput);
  fullCommit(runtimeSourceCommit, "runtimeSourceCommit");
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version ?? "")) {
    throw new Error("production version must be a stable semantic version");
  }
  if (
    stagingInput.sourceCommit !== productionInput.sourceCommit
    || imageReference(stagingInput.quantWorkerImage) !== imageReference(productionInput.quantWorkerImage)
    || imageReference(stagingInput.backupOperatorImage) !== imageReference(productionInput.backupOperatorImage)
  ) {
    throw new Error("production must promote the exact staging source and image digests");
  }
  for (const field of [
    "backupOperatorRoleArn",
    "backupEncryptionSecretArn",
    "databaseCredentialSecretArn",
    "chainStateDestination",
    "chainStateReplicaDestination",
    "databaseDestination",
    "objectSourceBucket",
    "objectDestination",
    "chainStatePvcName",
  ]) {
    if (stagingInput[field] === productionInput[field]) {
      throw new Error(`production must use an isolated value for ${field}`);
    }
  }
  return { stagingInput, productionInput, runtimeSourceCommit, version };
}

function loadStagingCanaryEvidence({
  stagingInput,
  stagingEvidencePath,
  stagingEvidenceSha256,
  runtimeSourceCommit,
}) {
  digest(stagingEvidenceSha256, "stagingEvidenceSha256");
  let bytes;
  try {
    bytes = readFileSync(repositoryPath(stagingEvidencePath, "stagingEvidencePath"));
  } catch {
    throw new Error("staging canary evidence read failed");
  }
  if (sha256(bytes) !== stagingEvidenceSha256) {
    throw new Error("staging canary evidence digest does not match");
  }
  let evidence;
  try {
    evidence = JSON.parse(bytes);
  } catch {
    throw new Error("staging canary evidence is not valid JSON");
  }
  if (
    evidence.action !== "staging-canary-promotion"
    || evidence.canaryObservationPassed !== true
    || evidence.canaryRemoved !== true
    || !Array.isArray(evidence.canarySamples)
    || evidence.canarySamples.length < 3
    || !evidence.canarySamples.every((sample) => (
      sample.pass === true && Number.isFinite(Date.parse(sample.asOf))
    ))
  ) {
    throw new Error("staging evidence does not prove a completed canary promotion");
  }
  const observedMilliseconds = (
    Date.parse(evidence.canarySamples.at(-1).asOf)
    - Date.parse(evidence.canarySamples[0].asOf)
  );
  if (
    !Number.isFinite(observedMilliseconds)
    || observedMilliseconds < 60_000
    || evidence.canaryObservedMilliseconds !== observedMilliseconds
  ) {
    throw new Error("staging evidence does not prove the canary observation window");
  }
  const target = validateRollbackTarget({
    input: stagingInput,
    evidenceBytes: bytes,
    expectedEvidenceSha256: stagingEvidenceSha256,
    runtimeSourceCommit,
    requireDistinctRuntime: false,
  });
  return {
    ...target,
    evidenceSha256: stagingEvidenceSha256,
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
                secretProviderClass: ynx-production-secrets`;
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
        namespace: ${productionNamespace}
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
                        value: ${JSON.stringify(value)}`;
}

function cidrEgress(cidrs) {
  return cidrs.map((cidr) => `      - ipBlock:
          cidr: ${JSON.stringify(cidr)}`).join("\n");
}

export function buildProductionReleaseFiles(rawInput) {
  const input = validateStagingReleaseInputs(rawInput);
  const chainEnvironment = [
    envValue("BACKUP_DESTINATION", input.chainStateDestination),
    envValue("BACKUP_CROSS_REGION_REPLICA", input.chainStateReplicaDestination),
    envValue("SOURCE_COMMIT", input.sourceCommit),
  ].join("\n");
  const databaseEnvironment = [
    envValue("BACKUP_DESTINATION", input.databaseDestination),
    envValue("SOURCE_COMMIT", input.sourceCommit),
  ].join("\n");
  const objectEnvironment = [
    envValue("SOURCE_BUCKET", input.objectSourceBucket),
    envValue("BACKUP_DESTINATION", input.objectDestination),
    envValue("SOURCE_COMMIT", input.sourceCommit),
  ].join("\n");

  const kustomization = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../production
  - secret-provider-class.yaml
  - backup-egress-policy.yaml

labels:
  - pairs:
      security.ynx/manifest-class: ${productionManifestClass}
      security.ynx/source-commit: ${input.sourceCommit}
      security.ynx/tier: production
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
        namespace: ${productionNamespace}
        annotations:
          eks.amazonaws.com/role-arn: ${JSON.stringify(input.backupOperatorRoleArn)}
${cronPatch("chain-state-backup", chainEnvironment, `
                volumes:
                  - name: chain-data
                    persistentVolumeClaim:
                      claimName: ${input.chainStatePvcName}`)}
${cronPatch("database-backup", databaseEnvironment)}
${cronPatch("object-storage-backup", objectEnvironment)}
`;

  const secretProvider = `apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: ynx-production-secrets
  namespace: ${productionNamespace}
  labels:
    security.ynx/manifest-class: ${productionManifestClass}
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
    region: ${JSON.stringify(input.awsRegion)}
    usePodIdentity: "false"
    objects: |
      - objectName: ${JSON.stringify(input.backupEncryptionSecretArn)}
        objectType: "secretsmanager"
        objectAlias: "backup-encryption-key"
      - objectName: ${JSON.stringify(input.databaseCredentialSecretArn)}
        objectType: "secretsmanager"
        objectAlias: "database-url"
`;

  const egressPolicy = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backup-private-endpoints
  namespace: ${productionNamespace}
  labels:
    security.ynx/manifest-class: ${productionManifestClass}
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
${cidrEgress(input.awsEndpointCidrs)}
      ports:
        - protocol: TCP
          port: 443
    - to:
${cidrEgress(input.databaseEndpointCidrs)}
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

export function renderProductionReleaseManifest(rawInput, {
  kubernetesSourceRoot,
  execFile = execFileSync,
}) {
  const input = validateStagingReleaseInputs(rawInput);
  const sourceRoot = resolve(kubernetesSourceRoot);
  if (!existsSync(resolve(sourceRoot, "overlays/production/kustomization.yaml"))) {
    throw new Error("Kubernetes source root does not contain the production overlay");
  }
  const workspace = mkdtempSync(resolve(tmpdir(), "ynx-production-release-"));
  const copiedRoot = resolve(workspace, "infra/k8s");
  const output = resolve(copiedRoot, "overlays/production-release");
  try {
    cpSync(sourceRoot, copiedRoot, { recursive: true });
    if (existsSync(output)) throw new Error("temporary production release overlay unexpectedly exists");
    mkdirSync(output, { recursive: true });
    for (const [name, content] of buildProductionReleaseFiles(input)) {
      writeFileSync(resolve(output, name), content.endsWith("\n") ? content : `${content}\n`, { mode: 0o600 });
    }
    try {
      const manifest = execFile("kubectl", ["kustomize", output], {
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
      throw new Error("production release render failed");
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function manifestDocuments(manifest) {
  return manifest.split(/^---\s*$/m).filter((document) => document.trim());
}

export function validateProductionReleaseManifest(manifest, { sourceCommit }) {
  fullCommit(sourceCommit, "sourceCommit");
  const base = validateRenderedManifest({
    environment: "production",
    manifest,
    backupMode: "active",
  });
  const failures = [...base.failures];
  const documents = manifestDocuments(manifest);
  const images = [...manifest.matchAll(/\n\s*(?:-\s*)?image:\s*([^\s]+)/g)].map((match) => match[1]);
  if (images.length === 0) failures.push("production: release manifest contains no workload images");
  for (const image of images) {
    if (!/@sha256:[0-9a-f]{64}$/.test(image)) failures.push(`production: image is not digest-pinned: ${image}`);
  }
  if (/security\.ynx\/(?:tier|manifest-class):\s*production-candidate\b/.test(manifest)) {
    failures.push("production: production-candidate manifests cannot be released");
  }
  if (!new RegExp(`security\\.ynx/manifest-class:\\s*${productionManifestClass}\\b`).test(manifest)) {
    failures.push("production: production-release manifest class is required");
  }
  if (!/^kind:\s*SecretProviderClass\b/m.test(manifest)) failures.push("production: SecretProviderClass is required");
  if (/^kind:\s*Secret\b/m.test(manifest)) failures.push("production: tracked Kubernetes Secret objects are forbidden");
  if (/^kind:\s*(?:ClusterRole|ClusterRoleBinding|CustomResourceDefinition|PersistentVolume)\b/m.test(manifest)) {
    failures.push("production: cluster-wide privilege or storage resources are forbidden");
  }
  const allowedNamespaces = new Set([productionNamespace, "ynx-security-platform", "ingress-nginx"]);
  for (const document of documents) {
    const kind = document.match(/^kind:\s*([^\s]+)/m)?.[1];
    const name = document.match(/\nmetadata:\n(?:[\s\S]*?\n)?\s*name:\s*([^\s]+)/)?.[1];
    const resourceNamespace = kind === "Namespace"
      ? name
      : document.match(/\n\s*namespace:\s*([^\s]+)/)?.[1];
    if (resourceNamespace && !allowedNamespaces.has(resourceNamespace)) {
      failures.push(`production: resource targets unauthorized namespace: ${resourceNamespace}`);
    }
    if (/^kind:\s*(?:Deployment|CronJob)\b/m.test(document)) {
      if (!new RegExp(`security\\.ynx/source-commit:\\s*${sourceCommit}\\b`).test(document)) {
        failures.push(`production: workload ${name ?? "unknown"} is not bound to sourceCommit`);
      }
    }
  }
  const ingress = documents.find((document) => /^kind:\s*Ingress$/m.test(document));
  const tlsSection = ingress?.match(/\n  tls:\n([\s\S]*)/)?.[1] ?? "";
  const tlsHosts = new Set([...tlsSection.matchAll(/\n\s*-\s*([a-z0-9.-]+\.ynxweb4\.com)\s*$/gm)].map((match) => match[1]));
  const ruleHosts = new Set([...(ingress ?? "").matchAll(/\n\s*-\s*host:\s*([^\s]+)/g)].map((match) => match[1]));
  for (const host of [...tlsHosts, ...ruleHosts]) {
    if (!expectedPublicHosts.has(host)) failures.push(`production: unauthorized public host: ${host}`);
  }
  for (const host of expectedPublicHosts) {
    if (!tlsHosts.has(host)) failures.push(`production: TLS host is missing: ${host}`);
  }
  if (!/cert-manager\.io\/cluster-issuer:\s*letsencrypt-production\b/.test(manifest)) {
    failures.push("production: production certificate issuer is required");
  }
  if (!/nginx\.ingress\.kubernetes\.io\/enable-modsecurity:\s*["']?true\b/.test(manifest)) {
    failures.push("production: ingress ModSecurity is required");
  }
  if (!/nginx\.ingress\.kubernetes\.io\/ssl-redirect:\s*["']?true\b/.test(manifest)) {
    failures.push("production: HTTPS redirect is required");
  }
  const quantWorker = documents.find((document) => (
    /^kind:\s*Deployment$/m.test(document) && /\n\s*name:\s*quant-worker\b/.test(document)
  ));
  if (!quantWorker || !/\n\s*replicas:\s*3\b/.test(quantWorker)) {
    failures.push("production: quant-worker must use three replicas");
  }
  return {
    pass: failures.length === 0,
    failures,
    documents: documents.length,
    images,
    bytes: Buffer.byteLength(manifest),
    sha256: sha256(manifest),
  };
}

function prepareContext({
  stagingInput,
  productionInput,
  stagingEvidencePath,
  stagingEvidenceSha256,
  runtimeSourceCommit,
  version,
  imageEvidence,
  approval,
  trustedSignerFingerprint,
  signerPolicyPath,
  signerPolicySha256,
  publicProbePolicyPath,
  publicProbePolicySha256,
  execFile,
  materializeTree,
  now,
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("production release clock is invalid");
  }
  const inputs = validatePromotionInputs({
    stagingInput,
    productionInput,
    runtimeSourceCommit,
    version,
  });
  const supplyChain = validateImageEvidence(imageEvidence, inputs.productionInput, now);
  const acceptedApproval = validateApproval(approval, now);
  const signerFingerprint = fingerprint(trustedSignerFingerprint);
  const signerPolicy = validateSignerPolicy({
    signerPolicyPath,
    signerPolicySha256,
    trustedSignerFingerprint: signerFingerprint,
    now,
  });
  const publicProbePolicy = validatePublicProbePolicy({
    publicProbePolicyPath,
    publicProbePolicySha256,
  });
  gitPreflight(execFile, runtimeSourceCommit);
  const staging = loadStagingCanaryEvidence({
    stagingInput: inputs.stagingInput,
    stagingEvidencePath,
    stagingEvidenceSha256,
    runtimeSourceCommit,
  });
  const tree = materializeTree({
    sourceCommit: inputs.productionInput.sourceCommit,
    execFile,
  });
  let manifest;
  try {
    manifest = renderProductionReleaseManifest(inputs.productionInput, {
      kubernetesSourceRoot: tree.kubernetesRoot,
      execFile,
    });
  } finally {
    tree.cleanup();
  }
  const validation = validateProductionReleaseManifest(manifest, {
    sourceCommit: inputs.productionInput.sourceCommit,
  });
  if (!validation.pass) {
    throw new Error(`production release manifest is invalid: ${validation.failures.join("; ")}`);
  }
  const images = [
    {
      role: "backup-operator",
      reference: imageReference(inputs.productionInput.backupOperatorImage),
      ...supplyChain.backupOperator,
    },
    {
      role: "quant-worker",
      reference: imageReference(inputs.productionInput.quantWorkerImage),
      ...supplyChain.quantWorker,
    },
  ];
  const attestation = {
    schemaVersion: 1,
    kind: "ynx-production-release-attestation",
    product: "YNX Security Platform",
    version: inputs.version,
    sourceCommit: inputs.productionInput.sourceCommit,
    releaseInputSha256: stagingReleaseInputSha256(inputs.productionInput),
    stagingCanaryEvidenceSha256: staging.evidenceSha256,
    productionManifestSha256: validation.sha256,
    signerPolicySha256: signerPolicy.signerPolicySha256,
    publicProbePolicySha256: publicProbePolicy.publicProbePolicySha256,
    images,
    approval: acceptedApproval,
    publicReleaseEligible: true,
    signing: {
      class: "production-signed",
      publicKeyFingerprint: signerFingerprint,
    },
  };
  const attestationBytes = Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`);
  return {
    inputs,
    manifest,
    validation,
    attestation,
    attestationBytes,
    staging,
    publicProbePolicy: publicProbePolicy.policy,
  };
}

export function prepareProductionRelease({
  execFile = execFileSync,
  materializeTree = materializeKubernetesTreeAtCommit,
  now = new Date(),
  ...options
}) {
  const prepared = prepareContext({
    ...options,
    execFile,
    materializeTree,
    now,
  });
  return {
    attestation: prepared.attestation,
    receipt: {
      schemaVersion: 1,
      action: "production-release-signing-payload-prepared",
      source: "clean Git commit, verified staging canary, and deterministic Kustomize render",
      sourceCommit: prepared.inputs.productionInput.sourceCommit,
      runtimeSourceCommit: prepared.inputs.runtimeSourceCommit,
      version: prepared.inputs.version,
      asOf: now.toISOString(),
      confidence: "direct-local-verification",
      stagingCanaryEvidenceSha256: prepared.staging.evidenceSha256,
      productionManifestSha256: prepared.validation.sha256,
      signerPolicySha256: prepared.attestation.signerPolicySha256,
      publicProbePolicySha256: prepared.attestation.publicProbePolicySha256,
      productionManifestBytes: prepared.validation.bytes,
      productionManifestDocuments: prepared.validation.documents,
      imageDigests: prepared.validation.images.map((image) => image.match(/@sha256:([0-9a-f]{64})$/)?.[1]),
      signingPayloadSha256: sha256(prepared.attestationBytes),
      productionSigned: false,
      deployedPublic: false,
      mutationPerformed: false,
    },
  };
}

function validateAttestationShape(attestation) {
  exactObject(attestation, attestationFields, "production attestation");
  if (
    attestation.schemaVersion !== 1
    || attestation.kind !== "ynx-production-release-attestation"
    || attestation.product !== "YNX Security Platform"
    || attestation.publicReleaseEligible !== true
  ) {
    throw new Error("production attestation identity is invalid");
  }
  if (!Array.isArray(attestation.images) || attestation.images.length !== 2) {
    throw new Error("production attestation must contain two image records");
  }
}

export function verifyProductionReleaseBundle({
  attestationPath,
  attestationSha256,
  signaturePath,
  signatureSha256,
  execFile = execFileSync,
  materializeTree = materializeKubernetesTreeAtCommit,
  now = new Date(),
  ...options
}) {
  digest(attestationSha256, "attestationSha256");
  digest(signatureSha256, "signatureSha256");
  const prepared = prepareContext({
    ...options,
    execFile,
    materializeTree,
    now,
  });
  let attestationBytes;
  let signatureBytes;
  try {
    attestationBytes = readFileSync(resolve(attestationPath));
    signatureBytes = readFileSync(resolve(signaturePath));
  } catch {
    throw new Error("production signing evidence read failed");
  }
  if (sha256(attestationBytes) !== attestationSha256) throw new Error("production attestation digest mismatch");
  if (sha256(signatureBytes) !== signatureSha256) throw new Error("production signature record digest mismatch");
  let attestation;
  let signatureRecord;
  try {
    attestation = JSON.parse(attestationBytes);
    signatureRecord = JSON.parse(signatureBytes);
  } catch {
    throw new Error("production signing evidence is not valid JSON");
  }
  validateAttestationShape(attestation);
  if (canonicalJson(attestation) !== canonicalJson(prepared.attestation)) {
    throw new Error("signed production attestation does not match the prepared release");
  }
  const signature = verifyManifestSignature({
    manifestPath: resolve(attestationPath),
    signaturePath: resolve(signaturePath),
    trustedFingerprints: [options.trustedSignerFingerprint],
    now,
  });
  assertPublicArtifactEligible(attestation, signatureRecord);
  if (
    signature.signingClass !== "production-signed"
    || signature.publicKeyFingerprint !== options.trustedSignerFingerprint
    || signatureRecord.privateMaterialPersisted !== false
    || signatureRecord.publicReleaseEligible !== true
  ) {
    throw new Error("production signature policy is not satisfied");
  }
  const transparency = signatureRecord.transparencyRecord;
  if (
    typeof transparency !== "object"
    || transparency === null
    || !/^https:\/\//.test(transparency.url ?? "")
    || !Number.isInteger(transparency.logIndex)
    || !Number.isFinite(Date.parse(signatureRecord.createdAt))
    || !Number.isFinite(Date.parse(transparency.integratedAt))
    || transparency.entrySha256 !== attestationSha256
    || Date.parse(transparency.integratedAt) < Date.parse(signatureRecord.createdAt)
    || Date.parse(transparency.integratedAt) > now.getTime()
  ) {
    throw new Error("production transparency record is invalid");
  }
  const receipt = {
    schemaVersion: 1,
    action: "production-release-preflight",
    source: "clean Git commit, staging canary evidence, production signature, and transparency record",
    sourceCommit: prepared.inputs.productionInput.sourceCommit,
    runtimeSourceCommit: prepared.inputs.runtimeSourceCommit,
    version: prepared.inputs.version,
    asOf: now.toISOString(),
    confidence: "cryptographically-verified-local-preflight",
    stagingCanaryEvidenceSha256: prepared.staging.evidenceSha256,
    signerPolicySha256: prepared.attestation.signerPolicySha256,
    publicProbePolicySha256: prepared.attestation.publicProbePolicySha256,
    productionManifestSha256: prepared.validation.sha256,
    productionManifestBytes: prepared.validation.bytes,
    productionManifestDocuments: prepared.validation.documents,
    attestationSha256,
    signatureSha256,
    signerFingerprintSha256: sha256(signature.publicKeyFingerprint),
    transparencyRecordSha256: sha256(canonicalJson(transparency)),
    productionSigned: true,
    deployedPublic: false,
    mutationPerformed: false,
  };
  return {
    receipt,
    manifest: prepared.manifest,
    attestation,
    publicProbePolicy: prepared.publicProbePolicy,
  };
}

export function verifyProductionRelease(options) {
  return verifyProductionReleaseBundle(options).receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    const options = {
      stagingInput: JSON.parse(readFileSync(resolve(args["staging-input"]), "utf8")),
      productionInput: JSON.parse(readFileSync(resolve(args["production-input"]), "utf8")),
      stagingEvidencePath: args["staging-evidence"],
      stagingEvidenceSha256: args["staging-evidence-sha256"],
      runtimeSourceCommit: args["runtime-source-commit"],
      version: args.version,
      imageEvidence: JSON.parse(readFileSync(resolve(args["image-evidence"]), "utf8")),
      approval: JSON.parse(readFileSync(resolve(args.approval), "utf8")),
      trustedSignerFingerprint: args["trusted-signer-fingerprint"],
      signerPolicyPath: args["signer-policy"],
      signerPolicySha256: args["signer-policy-sha256"],
      publicProbePolicyPath: args["public-probe-policy"],
      publicProbePolicySha256: args["public-probe-policy-sha256"],
    };
    let result;
    if (command === "prepare") {
      result = prepareProductionRelease(options);
      const output = externalOutputPath(args["attestation-output"], "attestationOutput");
      if (existsSync(output)) throw new Error("attestationOutput already exists");
      mkdirSync(resolve(output, ".."), { recursive: true });
      writeFileSync(output, `${JSON.stringify(result.attestation, null, 2)}\n`, { mode: 0o600 });
    } else if (command === "verify") {
      result = verifyProductionRelease({
        ...options,
        attestationPath: args.attestation,
        attestationSha256: args["attestation-sha256"],
        signaturePath: args.signature,
        signatureSha256: args["signature-sha256"],
      });
    } else {
      throw new Error("usage: security-production-release.mjs prepare|verify --staging-input PATH --production-input PATH --staging-evidence PATH --staging-evidence-sha256 SHA256 --runtime-source-commit SHA --version X.Y.Z --image-evidence PATH --approval PATH --trusted-signer-fingerprint SHA256 --signer-policy PATH --signer-policy-sha256 SHA256 --public-probe-policy PATH --public-probe-policy-sha256 SHA256 --attestation-output PATH [signature flags]");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
