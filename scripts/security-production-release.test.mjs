import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  prepareProductionRelease,
  renderProductionReleaseManifest,
  validateProductionReleaseManifest,
  verifyProductionRelease,
} from "./security-production-release.mjs";
import { stagingReleaseInputSha256 } from "./security-stage-release.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseCommit = "a".repeat(40);
const runtimeCommit = "c".repeat(40);
const quantDigest = `sha256:${"b".repeat(64)}`;
const backupDigest = `sha256:${"d".repeat(64)}`;
const now = new Date("2026-07-26T16:30:00.000Z");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function publicFingerprint(publicKey) {
  return `sha256:${sha256(publicKey.export({ type: "spki", format: "der" }))}`;
}

function stagingInput() {
  return {
    schemaVersion: 1,
    sourceCommit: releaseCommit,
    quantWorkerImage: {
      repository: "registry.ynxweb4.com/security/quant-worker",
      digest: quantDigest,
    },
    backupOperatorImage: {
      repository: "registry.ynxweb4.com/security/backup-operator",
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
    awsEndpointCidrs: ["10.20.0.0/24"],
    databaseEndpointCidrs: ["10.30.0.0/24"],
    databasePort: 5432,
  };
}

function productionInput() {
  return {
    ...stagingInput(),
    backupOperatorRoleArn: "arn:aws:iam::123456789012:role/ynx-production-backup",
    backupEncryptionSecretArn: "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/production/backup-key-AbCdEf",
    databaseCredentialSecretArn: "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:ynx/production/database-url-AbCdEf",
    chainStateDestination: "s3://ynx-production-chain-backup/state",
    chainStateReplicaDestination: "s3://ynx-production-chain-replica/state",
    databaseDestination: "s3://ynx-production-database-backup/postgres",
    objectSourceBucket: "ynx-production-artifacts",
    objectDestination: "s3://ynx-production-object-backup/objects",
    chainStatePvcName: "chain-data-production",
    awsEndpointCidrs: ["10.40.0.0/24"],
    databaseEndpointCidrs: ["10.50.0.0/24"],
  };
}

function imageEvidence() {
  const directory = mkdtempSync(resolve(tmpdir(), "ynx-production-image-evidence-"));
  const value = {};
  for (const [role, image] of [
    ["quantWorker", productionInput().quantWorkerImage],
    ["backupOperator", productionInput().backupOperatorImage],
  ]) {
    const sbomPath = resolve(directory, `${role}.cdx.json`);
    const provenancePath = resolve(directory, `${role}.intoto.json`);
    const scanEvidencePath = resolve(directory, `${role}.scan.json`);
    const sbomBytes = Buffer.from(`${JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [{ name: role, version: "1.0.0" }],
    }, null, 2)}\n`);
    const provenanceBytes = Buffer.from(`${JSON.stringify({
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [{ name: image.repository, digest: { sha256: image.digest.slice(7) } }],
    }, null, 2)}\n`);
    const scanBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      imageReference: `${image.repository}@${image.digest}`,
      imageDigest: image.digest,
      scanner: "ynx-approved-container-scanner",
      databaseUpdatedAt: "2026-07-26T15:00:00.000Z",
      scannedAt: "2026-07-26T16:00:00.000Z",
      findings: { critical: 0, high: 0 },
      result: "passed",
    }, null, 2)}\n`);
    writeFileSync(sbomPath, sbomBytes);
    writeFileSync(provenancePath, provenanceBytes);
    writeFileSync(scanEvidencePath, scanBytes);
    value[role] = {
      sbomPath,
      sbomSha256: sha256(sbomBytes),
      provenancePath,
      provenanceSha256: sha256(provenanceBytes),
      scanEvidencePath,
      scanEvidenceSha256: sha256(scanBytes),
    };
  }
  return {
    value,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function signerPolicy(trustedSignerFingerprint) {
  const directory = mkdtempSync(resolve(tmpdir(), "ynx-production-signer-policy-"));
  const path = resolve(directory, "policy.json");
  const bytes = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    policyId: "ynx-production-signers-v1",
    environment: "production",
    approvedBy: ["release-owner", "security-owner"],
    signers: [{
      identity: "ynx-production-secure-signer",
      fingerprint: trustedSignerFingerprint,
      purpose: "production-release-signing",
      status: "active",
      validFrom: "2026-07-26T15:00:00.000Z",
      validUntil: "2026-07-27T15:00:00.000Z",
    }],
  }, null, 2)}\n`);
  writeFileSync(path, bytes);
  return {
    path,
    digest: sha256(bytes),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function publicProbePolicy() {
  const directory = mkdtempSync(resolve(tmpdir(), "ynx-production-probe-policy-"));
  const path = resolve(directory, "policy.json");
  const bytes = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    environment: "production",
    tlsHosts: [
      "rpc.ynxweb4.com",
      "evm.ynxweb4.com",
      "rest.ynxweb4.com",
      "faucet.ynxweb4.com",
      "indexer.ynxweb4.com",
      "explorer.ynxweb4.com",
      "ai.ynxweb4.com",
      "web4.ynxweb4.com",
    ],
    services: [
      { name: "faucet", host: "faucet.ynxweb4.com", healthPath: "/health", versionPath: "/version" },
      { name: "indexer", host: "indexer.ynxweb4.com", healthPath: "/health", versionPath: "/version" },
      { name: "ai-gateway", host: "ai.ynxweb4.com", healthPath: "/health", versionPath: "/version" },
      { name: "web4-hub", host: "web4.ynxweb4.com", healthPath: "/health", versionPath: "/version" },
    ],
    connectTimeoutSeconds: 5,
    totalTimeoutSeconds: 15,
    maxResponseBytes: 65536,
  }, null, 2)}\n`);
  writeFileSync(path, bytes);
  return {
    path,
    digest: sha256(bytes),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function approval() {
  return {
    approvalId: "change-20260726-production",
    approvedAt: "2026-07-26T16:00:00.000Z",
    expiresAt: "2026-07-26T17:00:00.000Z",
    approvers: ["release-owner", "security-owner"],
  };
}

function stagingCanaryEvidence() {
  return {
    schemaVersion: 1,
    action: "staging-canary-promotion",
    sourceCommit: releaseCommit,
    releaseInputSha256: stagingReleaseInputSha256(stagingInput()),
    manifestSha256: "5".repeat(64),
    state: "deployed-staging-verified",
    mutationPerformed: true,
    deployedStaging: true,
    rolloutVerified: true,
    liveManifestReconciled: true,
    readiness: { pass: true },
    canaryObservationPassed: true,
    canaryRemoved: true,
    canaryObservedMilliseconds: 60000,
    canarySamples: [
      { index: 1, asOf: "2026-07-26T15:00:00.000Z", pass: true },
      { index: 2, asOf: "2026-07-26T15:00:30.000Z", pass: true },
      { index: 3, asOf: "2026-07-26T15:01:00.000Z", pass: true },
    ],
  };
}

function writeJson(relativePath, value) {
  const absolute = resolve(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(absolute, bytes, { mode: 0o600 });
  return { absolute, bytes, digest: sha256(bytes) };
}

function currentTree() {
  return {
    kubernetesRoot: resolve(root, "infra/k8s"),
    files: 1,
    bytes: 1,
    cleanup() {},
  };
}

function fixture(renderedManifest) {
  const calls = [];
  const execFile = (command, args) => {
    calls.push({ command, args });
    if (command === "git" && args[0] === "rev-parse") return `${runtimeCommit}\n`;
    if (command === "git" && args[0] === "status") return "";
    if (command === "kubectl" && args[0] === "kustomize") return renderedManifest;
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { calls, execFile };
}

function options({
  evidencePath,
  evidenceDigest,
  trustedSignerFingerprint,
  renderedManifest,
} = {}) {
  const execution = fixture(renderedManifest);
  const supplyChain = imageEvidence();
  const policy = signerPolicy(trustedSignerFingerprint);
  const probes = publicProbePolicy();
  return {
    values: {
      stagingInput: stagingInput(),
      productionInput: productionInput(),
      stagingEvidencePath: evidencePath,
      stagingEvidenceSha256: evidenceDigest,
      runtimeSourceCommit: runtimeCommit,
      version: "1.0.0",
      imageEvidence: supplyChain.value,
      approval: approval(),
      trustedSignerFingerprint,
      signerPolicyPath: policy.path,
      signerPolicySha256: policy.digest,
      publicProbePolicyPath: probes.path,
      publicProbePolicySha256: probes.digest,
      execFile: execution.execFile,
      materializeTree: currentTree,
      now,
    },
    calls: execution.calls,
    cleanup: () => {
      supplyChain.cleanup();
      policy.cleanup();
      probes.cleanup();
    },
  };
}

function productionSignature(attestationBytes, signer, attestationDigest, overrides = {}) {
  return {
    schemaVersion: 2,
    algorithm: "Ed25519",
    signingClass: "production-signed",
    signingIdentity: "ynx-production-secure-signer",
    manifestSha256: attestationDigest,
    publicKeyFingerprint: signer.fingerprint,
    publicKeyJwk: signer.publicKey.export({ format: "jwk" }),
    signature: sign(null, attestationBytes, signer.privateKey).toString("base64"),
    createdAt: "2026-07-26T16:20:00.000Z",
    expiresAt: "2026-07-26T17:00:00.000Z",
    revokedAt: null,
    transparencyRecord: {
      url: "https://transparency.ynxweb4.com/entries/100",
      logIndex: 100,
      integratedAt: "2026-07-26T16:21:00.000Z",
      entrySha256: attestationDigest,
    },
    privateMaterialPersisted: false,
    publicReleaseEligible: true,
    ...overrides,
  };
}

test("production release manifest is immutable, active, public-TLS bound, and hardened", () => {
  const manifest = renderProductionReleaseManifest(productionInput(), {
    kubernetesSourceRoot: resolve(root, "infra/k8s"),
  });
  const validation = validateProductionReleaseManifest(manifest, { sourceCommit: releaseCommit });
  assert.equal(validation.pass, true, validation.failures.join("\n"));
  assert.equal(validation.images.length, 4);
  assert.equal(validation.images.every((image) => /@sha256:[0-9a-f]{64}$/.test(image)), true);
  assert.match(manifest, /security\.ynx\/manifest-class: production-release/);
  assert.match(manifest, /kind: SecretProviderClass/);
  assert.doesNotMatch(manifest, /production-candidate/);
  assert.doesNotMatch(manifest, /^kind: Secret$/m);
});

test("production promotion refuses rebuilt images and shared staging infrastructure", () => {
  const rendered = renderProductionReleaseManifest(productionInput(), {
    kubernetesSourceRoot: resolve(root, "infra/k8s"),
  });
  const stable = writeJson(
    `evidence/security-platform/.production-staging-${process.pid}-inputs.json`,
    stagingCanaryEvidence(),
  );
  const signer = generateKeyPairSync("ed25519");
  const trustedSignerFingerprint = publicFingerprint(signer.publicKey);
  const preparedOptions = options({
    evidencePath: stable.absolute.slice(root.length + 1),
    evidenceDigest: stable.digest,
    trustedSignerFingerprint,
    renderedManifest: rendered,
  });
  try {
    const base = preparedOptions.values;
    assert.throws(
      () => prepareProductionRelease({
        ...base,
        productionInput: {
          ...productionInput(),
          quantWorkerImage: {
            ...productionInput().quantWorkerImage,
            digest: `sha256:${"9".repeat(64)}`,
          },
        },
      }),
      /exact staging source and image digests/,
    );
    assert.throws(
      () => prepareProductionRelease({
        ...base,
        productionInput: {
          ...productionInput(),
          databaseCredentialSecretArn: stagingInput().databaseCredentialSecretArn,
        },
      }),
      /isolated value for databaseCredentialSecretArn/,
    );
    writeFileSync(base.signerPolicyPath, "{}\n");
    assert.throws(
      () => prepareProductionRelease(base),
      /signer policy digest mismatch/,
    );
  } finally {
    rmSync(stable.absolute, { force: true });
    preparedOptions.cleanup();
  }
});

test("prepare binds verified staging canary and supply-chain digests without claiming signing", () => {
  const rendered = renderProductionReleaseManifest(productionInput(), {
    kubernetesSourceRoot: resolve(root, "infra/k8s"),
  });
  const stable = writeJson(
    `evidence/security-platform/.production-staging-${process.pid}-prepare.json`,
    stagingCanaryEvidence(),
  );
  const signer = generateKeyPairSync("ed25519");
  const trustedSignerFingerprint = publicFingerprint(signer.publicKey);
  const preparedOptions = options({
    evidencePath: stable.absolute.slice(root.length + 1),
    evidenceDigest: stable.digest,
    trustedSignerFingerprint,
    renderedManifest: rendered,
  });
  try {
    const prepared = prepareProductionRelease(preparedOptions.values);
    assert.equal(prepared.attestation.sourceCommit, releaseCommit);
    assert.equal(prepared.attestation.stagingCanaryEvidenceSha256, stable.digest);
    assert.equal(prepared.attestation.images.length, 2);
    assert.equal(prepared.attestation.images.every((image) => image.reference.includes("@sha256:")), true);
    assert.equal(prepared.attestation.publicReleaseEligible, true);
    assert.equal(prepared.receipt.productionSigned, false);
    assert.equal(prepared.receipt.deployedPublic, false);
    assert.equal(prepared.receipt.signingPayloadSha256, sha256(`${JSON.stringify(prepared.attestation, null, 2)}\n`));
    writeFileSync(preparedOptions.values.imageEvidence.quantWorker.sbomPath, "{}\n");
    assert.throws(
      () => prepareProductionRelease(preparedOptions.values),
      /SBOM digest mismatch/,
    );
  } finally {
    rmSync(stable.absolute, { force: true });
    preparedOptions.cleanup();
  }
});

test("verify accepts an externally production-signed exact release attestation", () => {
  const rendered = renderProductionReleaseManifest(productionInput(), {
    kubernetesSourceRoot: resolve(root, "infra/k8s"),
  });
  const stable = writeJson(
    `evidence/security-platform/.production-staging-${process.pid}-verify.json`,
    stagingCanaryEvidence(),
  );
  const signerKeys = generateKeyPairSync("ed25519");
  const signer = {
    ...signerKeys,
    fingerprint: publicFingerprint(signerKeys.publicKey),
  };
  const temporary = mkdtempSync(resolve(tmpdir(), "ynx-production-signature-"));
  const attestationPath = resolve(temporary, "attestation.json");
  const signaturePath = resolve(temporary, "attestation.sig.json");
  const preparedOptions = options({
    evidencePath: stable.absolute.slice(root.length + 1),
    evidenceDigest: stable.digest,
    trustedSignerFingerprint: signer.fingerprint,
    renderedManifest: rendered,
  });
  try {
    const prepared = prepareProductionRelease(preparedOptions.values);
    const attestationBytes = Buffer.from(`${JSON.stringify(prepared.attestation, null, 2)}\n`);
    const attestationDigest = sha256(attestationBytes);
    writeFileSync(attestationPath, attestationBytes);
    const signatureRecord = productionSignature(attestationBytes, signer, attestationDigest);
    const signatureBytes = Buffer.from(`${JSON.stringify(signatureRecord, null, 2)}\n`);
    writeFileSync(signaturePath, signatureBytes);
    const receipt = verifyProductionRelease({
      ...preparedOptions.values,
      attestationPath,
      attestationSha256: attestationDigest,
      signaturePath,
      signatureSha256: sha256(signatureBytes),
    });
    assert.equal(receipt.action, "production-release-preflight");
    assert.equal(receipt.productionSigned, true);
    assert.equal(receipt.deployedPublic, false);
    assert.equal(receipt.productionManifestSha256, prepared.attestation.productionManifestSha256);
    assert.match(receipt.transparencyRecordSha256, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(stable.absolute, { force: true });
    rmSync(temporary, { recursive: true, force: true });
    preparedOptions.cleanup();
  }
});

test("verify rejects test signing, missing transparency, and attestation drift", () => {
  const rendered = renderProductionReleaseManifest(productionInput(), {
    kubernetesSourceRoot: resolve(root, "infra/k8s"),
  });
  const stable = writeJson(
    `evidence/security-platform/.production-staging-${process.pid}-reject.json`,
    stagingCanaryEvidence(),
  );
  const signerKeys = generateKeyPairSync("ed25519");
  const signer = {
    ...signerKeys,
    fingerprint: publicFingerprint(signerKeys.publicKey),
  };
  const temporary = mkdtempSync(resolve(tmpdir(), "ynx-production-reject-"));
  const attestationPath = resolve(temporary, "attestation.json");
  const signaturePath = resolve(temporary, "attestation.sig.json");
  const preparedOptions = options({
    evidencePath: stable.absolute.slice(root.length + 1),
    evidenceDigest: stable.digest,
    trustedSignerFingerprint: signer.fingerprint,
    renderedManifest: rendered,
  });
  try {
    const prepared = prepareProductionRelease(preparedOptions.values);
    const attestationBytes = Buffer.from(`${JSON.stringify(prepared.attestation, null, 2)}\n`);
    const attestationDigest = sha256(attestationBytes);
    writeFileSync(attestationPath, attestationBytes);

    for (const overrides of [
      { signingClass: "test-signed" },
      { transparencyRecord: null },
    ]) {
      const signatureRecord = productionSignature(attestationBytes, signer, attestationDigest, overrides);
      const signatureBytes = Buffer.from(`${JSON.stringify(signatureRecord, null, 2)}\n`);
      writeFileSync(signaturePath, signatureBytes);
      assert.throws(
        () => verifyProductionRelease({
          ...preparedOptions.values,
          attestationPath,
          attestationSha256: attestationDigest,
          signaturePath,
          signatureSha256: sha256(signatureBytes),
        }),
        /production signature|transparency record|test-signed public artifact/,
      );
    }

    const drifted = { ...prepared.attestation, productionManifestSha256: "9".repeat(64) };
    const driftedBytes = Buffer.from(`${JSON.stringify(drifted, null, 2)}\n`);
    writeFileSync(attestationPath, driftedBytes);
    const driftedDigest = sha256(driftedBytes);
    const driftedSignature = productionSignature(driftedBytes, signer, driftedDigest);
    const driftedSignatureBytes = Buffer.from(`${JSON.stringify(driftedSignature, null, 2)}\n`);
    writeFileSync(signaturePath, driftedSignatureBytes);
    assert.throws(
      () => verifyProductionRelease({
        ...preparedOptions.values,
        attestationPath,
        attestationSha256: driftedDigest,
        signaturePath,
        signatureSha256: sha256(driftedSignatureBytes),
      }),
      /does not match the prepared release/,
    );
  } finally {
    rmSync(stable.absolute, { force: true });
    rmSync(temporary, { recursive: true, force: true });
    preparedOptions.cleanup();
  }
});
