#!/usr/bin/env node
/**
 * Deterministic source-artifact builder and local test-signing verifier.
 *
 * Local test signing uses an ephemeral in-memory Ed25519 key pair. Only the
 * public JWK and detached signature are persisted. Production signing is never
 * performed by this tool and must be supplied by an approved external signer.
 */

import { execFileSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const bundlePaths = [
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/security.yml",
  ".github/workflows/security-platform-deploy.yml",
  "docs/integration",
  "evidence/security-platform",
  "infra/k8s",
  "EVIDENCE_INDEX.md",
  "FEATURE_COMPLETION_EVIDENCE.md",
  "FOUNDER_KPI_FRAMEWORK.md",
  "MIGRATION_COMPATIBILITY.md",
  "OBSERVABILITY.md",
  "OPERATIONS.md",
  "PROVIDER_INVENTORY.md",
  "README.md",
  "RELEASE_NOTES.md",
  "SECURITY.md",
  "SLO_CAPACITY_PLAN.md",
  "START_HERE_FOR_SUPPORT.md",
  "docs/security-platform/THIRD_PARTY_NOTICES.md",
  "THREAT_MODEL.md",
  "UI_DESIGN_AUDIT.md",
  "UNIT_ECONOMICS.md",
  "package-lock.json",
  "package.json",
  "release/security-platform/public-product-metadata.json",
  "release/security-platform/artifact-registry.json",
  "release/security-platform/completion-audit.json",
  "release/integration",
  "release/security-platform/platform-status.json",
  "release/security-platform/product-release.json",
  "scripts",
  "security-platform",
];

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function writeJson(path, value, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --name value pairs");
    args[key.slice(2)] = value;
  }
  return args;
}

function gitText(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commandVersion(command, args) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split(/\r?\n/)[0];
  } catch {
    return "unavailable";
  }
}

function gitBlob(sourceCommit, path) {
  return execFileSync("git", ["show", `${sourceCommit}:${path}`], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function cycloneDxFromLock(lock, sourceCommit) {
  const components = [];
  for (const [path, value] of Object.entries(lock.packages ?? {})) {
    if (!path || !value?.version) continue;
    const inferredName = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)?.[1] ?? "";
    const name = value.name || inferredName;
    if (!name) continue;
    components.push({
      type: "library",
      name,
      version: value.version,
      purl: `pkg:npm/${encodeURIComponent(name)}@${value.version}`,
      properties: [{ name: "ynx:lockPath", value: path }],
    });
  }
  components.sort((a, b) => a.purl.localeCompare(b.purl));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${sourceCommit.slice(0, 8)}-${sourceCommit.slice(8, 12)}-4${sourceCommit.slice(13, 16)}-a${sourceCommit.slice(17, 20)}-${sourceCommit.slice(20, 32)}`,
    version: 1,
    metadata: {
      component: { type: "application", name: "ynx-security-platform", version: sourceCommit },
      properties: [{ name: "ynx:sourceCommit", value: sourceCommit }],
    },
    components,
  };
}

export function provenanceFor({
  sourceCommit,
  artifactName,
  digest,
  bytes,
  sbomName,
  sbomDigest,
  lockHash,
  buildScriptHash,
  buildRun,
  reproducibilityStatus = "not-verified",
  buildStartedAt = null,
  buildFinishedAt = null,
}) {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: artifactName, digest: { sha256: digest } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://ynxweb4.com/security-platform/reproducible-git-archive/v2",
        externalParameters: {
          sourceCommit,
          paths: bundlePaths,
          dependencyLockHash: lockHash,
          buildScriptHash,
        },
        internalParameters: {},
        resolvedDependencies: [{
          uri: "git+https://github.com/JiahaoAlbus/YNX-Chain.git",
          digest: { gitCommit: sourceCommit },
        }],
      },
      runDetails: {
        builder: { id: "https://github.com/JiahaoAlbus/YNX-Chain/.github/workflows/security-platform-deploy.yml" },
        metadata: {
          invocationId: buildRun,
          startedOn: buildStartedAt,
          finishedOn: buildFinishedAt,
        },
        byproducts: [{ name: sbomName, digest: { sha256: sbomDigest } }],
      },
      ynxRelease: {
        bytes,
        signingClass: "unsigned-local",
        publicReleaseEligible: false,
        reproducibilityStatus,
      },
    },
  };
}

function publicFingerprint(publicKey) {
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  return `sha256:${sha256(publicDer)}`;
}

export function createEphemeralTestSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey,
    fingerprint: publicFingerprint(publicKey),
    publicKeyJwk: publicKey.export({ format: "jwk" }),
  };
}

export function signManifest({
  manifestPath,
  signaturePath,
  signingClass = "test-signed",
  signingIdentity = "local-ephemeral-test-signer",
  productionApproved = false,
  now = new Date(),
  validitySeconds = 3600,
  signer = createEphemeralTestSigner(),
}) {
  if (!new Set(["test-signed", "production-signed"]).has(signingClass)) {
    throw new Error("signing class must be test-signed or production-signed");
  }
  if (signingClass === "production-signed") {
    if (!productionApproved) throw new Error("production signing requires explicit operator approval");
    throw new Error("production signing requires an approved external secure signer; local signing is prohibited");
  }
  if (!Number.isInteger(validitySeconds) || validitySeconds < 1 || validitySeconds > 31 * 86_400) {
    throw new Error("test signature validitySeconds must be between 1 and 2678400");
  }
  if (!signer?.privateKey || !signer?.publicKey || !signer?.fingerprint || !signer?.publicKeyJwk) {
    throw new Error("ephemeral test signer is invalid");
  }

  const manifest = readFileSync(manifestPath);
  const record = {
    schemaVersion: 2,
    algorithm: "Ed25519",
    signingClass,
    signingIdentity,
    manifestSha256: sha256(manifest),
    publicKeyFingerprint: signer.fingerprint,
    publicKeyJwk: signer.publicKeyJwk,
    signature: sign(null, manifest, signer.privateKey).toString("base64"),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + validitySeconds * 1000).toISOString(),
    revokedAt: null,
    transparencyRecord: null,
    privateMaterialPersisted: false,
    publicReleaseEligible: false,
  };
  writeJson(signaturePath, record, 0o600);
  return record;
}

export function verifyManifestSignature({
  manifestPath,
  signaturePath,
  trustedFingerprints = [],
  now = new Date(),
}) {
  const manifest = readFileSync(manifestPath);
  const record = JSON.parse(readFileSync(signaturePath, "utf8"));
  if (record.algorithm !== "Ed25519") throw new Error("unsupported artifact signature algorithm");
  if (record.signingClass !== "test-signed" && record.signingClass !== "production-signed") {
    throw new Error("unsupported artifact signing class");
  }
  if (!record.publicKeyJwk || typeof record.publicKeyJwk !== "object") throw new Error("signature record is missing public JWK");
  const publicKey = createPublicKey({ key: record.publicKeyJwk, format: "jwk" });
  const fingerprint = publicFingerprint(publicKey);
  if (record.manifestSha256 !== sha256(manifest)) throw new Error("signed manifest digest mismatch");
  if (record.publicKeyFingerprint !== fingerprint) throw new Error("artifact signer fingerprint mismatch");
  if (trustedFingerprints.length > 0 && !trustedFingerprints.includes(fingerprint)) throw new Error("unknown artifact signing identity");
  if (record.revokedAt) throw new Error("artifact signature is revoked");
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new Error("artifact signature expiry is invalid");
  if (expiresAt <= now.getTime()) throw new Error("artifact signature is expired");
  if (!verify(null, manifest, publicKey, Buffer.from(record.signature, "base64"))) {
    throw new Error("artifact signature verification failed");
  }
  return {
    verified: true,
    signingClass: record.signingClass,
    signingIdentity: record.signingIdentity,
    publicKeyFingerprint: fingerprint,
    expiresAt: record.expiresAt,
  };
}

export function verifyArtifactSet({ artifactPath, manifestPath, signaturePath, trustedFingerprints = [], now = new Date() }) {
  const artifact = readFileSync(artifactPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.artifact.sha256 !== sha256(artifact)) throw new Error("artifact digest mismatch");
  if (manifest.artifact.bytes !== statSync(artifactPath).size) throw new Error("artifact byte count mismatch");
  const signature = verifyManifestSignature({ manifestPath, signaturePath, trustedFingerprints, now });
  if (manifest.signing.class !== "test-signed") throw new Error("manifest signing class does not match local test signature");
  if (manifest.signing.publicKeyFingerprint !== signature.publicKeyFingerprint) throw new Error("manifest signer fingerprint mismatch");
  if (manifest.publicReleaseEligible !== false) throw new Error("local test artifact must not be public-release eligible");
  return { verified: true, artifactSha256: manifest.artifact.sha256, signature };
}

export function assertPublicArtifactEligible(manifest, signatureRecord) {
  if (manifest.publicReleaseEligible !== true) throw new Error("artifact is not marked public-release eligible");
  if (manifest.signing?.class !== "production-signed") throw new Error("unsigned or test-signed public artifact is forbidden");
  if (signatureRecord.signingClass !== "production-signed") throw new Error("production signature is required for public artifact");
  if (!signatureRecord.transparencyRecord) throw new Error("public artifact requires a transparency record");
  return true;
}

function createArchive({ outputDir, sourceCommit }) {
  mkdirSync(outputDir, { recursive: true });
  const artifactName = `ynx-security-platform-${sourceCommit}.tar`;
  const artifactPath = resolve(outputDir, artifactName);
  execFileSync("git", ["archive", "--format=tar", `--output=${artifactPath}`, sourceCommit, ...bundlePaths], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  return {
    artifactName,
    artifactPath,
    artifactSha256: sha256(readFileSync(artifactPath)),
    artifactBytes: statSync(artifactPath).size,
  };
}

function buildMetadata(sourceCommit) {
  return {
    sourceCommit,
    sourceRepository: "https://github.com/JiahaoAlbus/YNX-Chain",
    branch: gitText(["rev-parse", "--abbrev-ref", "HEAD"]),
    lockHash: sha256(gitBlob(sourceCommit, "package-lock.json")),
    buildScriptHash: sha256(gitBlob(sourceCommit, "scripts/security-artifact.mjs")),
    toolchain: {
      node: process.version,
      git: commandVersion("git", ["--version"]),
      platform: process.platform,
      architecture: process.arch,
    },
  };
}

export function build(outputDir = resolve(root, "dist/security-platform"), options = {}) {
  const sourceCommit = options.sourceCommit ?? gitText(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("sourceCommit must be a full Git SHA");
  const buildStartedAt = options.buildStartedAt ?? new Date().toISOString();
  const archive = createArchive({ outputDir, sourceCommit });
  const metadata = buildMetadata(sourceCommit);
  const lock = JSON.parse(gitBlob(sourceCommit, "package-lock.json").toString("utf8"));
  const sbom = cycloneDxFromLock(lock, sourceCommit);
  const sbomName = `${archive.artifactName}.cdx.json`;
  const sbomPath = resolve(outputDir, sbomName);
  writeJson(sbomPath, sbom);
  const sbomDigest = sha256(readFileSync(sbomPath));
  const buildFinishedAt = options.buildFinishedAt ?? new Date().toISOString();
  const buildRun = options.buildRun ?? `local:${sourceCommit}`;
  const provenance = provenanceFor({
    sourceCommit,
    artifactName: archive.artifactName,
    digest: archive.artifactSha256,
    bytes: archive.artifactBytes,
    sbomName,
    sbomDigest,
    lockHash: metadata.lockHash,
    buildScriptHash: metadata.buildScriptHash,
    buildRun,
    reproducibilityStatus: options.reproducibilityStatus ?? "not-verified",
    buildStartedAt,
    buildFinishedAt,
  });
  const provenancePath = resolve(outputDir, `${archive.artifactName}.intoto.json`);
  writeJson(provenancePath, provenance);
  const manifestPath = resolve(outputDir, `${archive.artifactName}.manifest.json`);
  const manifest = {
    schemaVersion: 2,
    product: "YNX Security Platform",
    version: "0.1.0-candidate",
    release: "development-candidate",
    environment: "local",
    sourceCommit,
    sourceRepository: metadata.sourceRepository,
    branch: metadata.branch,
    buildRun,
    buildEnvironment: metadata.toolchain,
    dependencyLockHash: metadata.lockHash,
    buildScriptHash: metadata.buildScriptHash,
    artifact: {
      name: archive.artifactName,
      sha256: archive.artifactSha256,
      bytes: archive.artifactBytes,
      mediaType: "application/x-tar",
      platform: "source",
      architecture: "any",
      minimumOs: "Any operating system with POSIX tar support",
    },
    sbom: { path: basename(sbomPath), sha256: sbomDigest, format: "CycloneDX 1.6" },
    provenance: {
      path: basename(provenancePath),
      sha256: sha256(readFileSync(provenancePath)),
      predicateType: provenance.predicateType,
    },
    reproducibility: {
      status: options.reproducibilityStatus ?? "not-verified",
      independentArtifactSha256: options.independentArtifactSha256 ?? null,
      match: options.reproducibilityStatus === "verified-local",
    },
    signing: {
      class: "unsigned-local",
      signingIdentity: null,
      publicKeyFingerprint: null,
      signaturePath: null,
      certificate: null,
      transparencyRecord: null,
    },
    installEvidence: "not-run-source-archive",
    coldStartEvidence: "not-applicable-source-archive",
    revocationStatus: "active",
    expiresAt: options.expiresAt ?? null,
    publicReleaseEligible: false,
  };
  writeJson(manifestPath, manifest);
  return { manifest, artifactPath: archive.artifactPath, sbomPath, provenancePath, manifestPath };
}

function expectFailure(action, expectedPattern) {
  try {
    action();
  } catch (error) {
    if (!expectedPattern.test(error.message)) throw error;
    return error.message;
  }
  throw new Error(`expected failure ${expectedPattern} was not observed`);
}

export function runLocalArtifactDrill({
  sourceCommit = gitText(["rev-parse", "HEAD"]),
  outputDir = resolve(root, "release/artifacts", sourceCommit),
  evidencePath,
  now = new Date(),
}) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("sourceCommit must be a full Git SHA");
  const startedAt = new Date();
  const comparisonRoot = mkdtempSync(resolve(tmpdir(), "ynx-artifact-repro-"));
  const tamperRoot = mkdtempSync(resolve(tmpdir(), "ynx-artifact-tamper-"));
  try {
    const comparison = createArchive({ outputDir: comparisonRoot, sourceCommit });
    const primary = build(outputDir, {
      sourceCommit,
      reproducibilityStatus: "verified-local",
      independentArtifactSha256: comparison.artifactSha256,
      buildRun: `local-reproducibility-drill:${sourceCommit}`,
      buildStartedAt: startedAt.toISOString(),
      buildFinishedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    });
    if (primary.manifest.artifact.sha256 !== comparison.artifactSha256) {
      throw new Error("independent reproducibility digest mismatch");
    }

    const signaturePath = resolve(outputDir, `${primary.manifest.artifact.name}.manifest.sig.json`);
    const signer = createEphemeralTestSigner();
    const signedManifest = {
      ...primary.manifest,
      signing: {
        class: "test-signed",
        signingIdentity: "local-ephemeral-test-signer",
        publicKeyFingerprint: signer.fingerprint,
        signaturePath: basename(signaturePath),
        certificate: null,
        transparencyRecord: null,
      },
    };
    writeJson(primary.manifestPath, signedManifest);
    const canonicalSignature = signManifest({
      manifestPath: primary.manifestPath,
      signaturePath,
      now,
      validitySeconds: 30 * 86_400,
      signer,
    });

    const verification = verifyArtifactSet({
      artifactPath: primary.artifactPath,
      manifestPath: primary.manifestPath,
      signaturePath,
      trustedFingerprints: [canonicalSignature.publicKeyFingerprint],
      now,
    });

    const tamperedManifestPath = resolve(tamperRoot, "tampered-manifest.json");
    const tamperedSignaturePath = resolve(tamperRoot, "tampered-signature.json");
    copyFileSync(primary.manifestPath, tamperedManifestPath);
    copyFileSync(signaturePath, tamperedSignaturePath);
    const tamperedManifest = JSON.parse(readFileSync(tamperedManifestPath, "utf8"));
    tamperedManifest.artifact.sha256 = "0".repeat(64);
    writeJson(tamperedManifestPath, tamperedManifest);
    const tamperedManifestRejected = expectFailure(
      () => verifyManifestSignature({ manifestPath: tamperedManifestPath, signaturePath: tamperedSignaturePath, now }),
      /digest mismatch/,
    );

    const wrongIdentityRejected = expectFailure(
      () => verifyManifestSignature({
        manifestPath: primary.manifestPath,
        signaturePath,
        trustedFingerprints: ["sha256:unknown-test-identity"],
        now,
      }),
      /unknown artifact signing identity/,
    );

    const tamperedArtifactPath = resolve(tamperRoot, "tampered-artifact.tar");
    copyFileSync(primary.artifactPath, tamperedArtifactPath);
    writeFileSync(tamperedArtifactPath, Buffer.concat([readFileSync(tamperedArtifactPath), Buffer.from("tamper") ]));
    const tamperedArtifactRejected = expectFailure(
      () => verifyArtifactSet({
        artifactPath: tamperedArtifactPath,
        manifestPath: primary.manifestPath,
        signaturePath,
        trustedFingerprints: [canonicalSignature.publicKeyFingerprint],
        now,
      }),
      /artifact digest mismatch/,
    );

    const unsignedPublicRejected = expectFailure(
      () => assertPublicArtifactEligible(
        { ...signedManifest, publicReleaseEligible: true, signing: { ...signedManifest.signing, class: "test-signed" } },
        canonicalSignature,
      ),
      /unsigned or test-signed public artifact is forbidden/,
    );

    const completedAt = new Date();
    const result = {
      schemaVersion: 1,
      scenario: "local-reproducible-build-test-signature-and-tamper-rejection",
      sourceCommit,
      environment: "local",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      result: "passed-local",
      artifact: {
        path: primary.artifactPath.replace(`${root}/`, ""),
        sha256: signedManifest.artifact.sha256,
        bytes: signedManifest.artifact.bytes,
        mediaType: signedManifest.artifact.mediaType,
      },
      sbom: signedManifest.sbom,
      provenance: signedManifest.provenance,
      reproducibility: signedManifest.reproducibility,
      signing: {
        class: canonicalSignature.signingClass,
        identity: canonicalSignature.signingIdentity,
        publicKeyFingerprint: canonicalSignature.publicKeyFingerprint,
        privateMaterialPersisted: canonicalSignature.privateMaterialPersisted,
        publicReleaseEligible: false,
      },
      verification,
      rejectionEvidence: {
        tamperedManifestRejected,
        wrongIdentityRejected,
        tamperedArtifactRejected,
        unsignedPublicRejected,
      },
      limitations: [
        "local source archive only",
        "ephemeral test signature only",
        "no production certificate chain",
        "no transparency service record",
        "no hosted immutable download URL",
        "no installation or cold-start claim",
      ],
    };
    if (evidencePath) writeJson(resolve(root, evidencePath), result, 0o600);
    return result;
  } finally {
    rmSync(comparisonRoot, { recursive: true, force: true });
    rmSync(tamperRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (command === "build") {
      const result = build(process.argv[3] ? resolve(process.argv[3]) : undefined);
      process.stdout.write(`${JSON.stringify(result.manifest, null, 2)}\n`);
    } else if (command === "local-drill") {
      const args = parseArgs(process.argv.slice(3));
      const result = runLocalArtifactDrill({
        sourceCommit: args["source-commit"] ?? gitText(["rev-parse", "HEAD"]),
        outputDir: args.output ? resolve(args.output) : undefined,
        evidencePath: args.evidence,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (command === "verify-signature") {
      const result = verifyManifestSignature({
        manifestPath: resolve(process.argv[3]),
        signaturePath: resolve(process.argv[4]),
        trustedFingerprints: process.argv[5] ? [process.argv[5]] : [],
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      throw new Error("usage: security-artifact.mjs build [dir] | local-drill --source-commit SHA [--output DIR] [--evidence PATH] | verify-signature MANIFEST SIGNATURE [TRUSTED_FINGERPRINT]");
    }
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
