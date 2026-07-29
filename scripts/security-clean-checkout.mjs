#!/usr/bin/env node
/**
 * Verify release evidence from a clean Git archive.
 *
 * The verifier exports a specified commit to a temporary directory, runs the
 * archived repository's own policy verifier without npm install, directly
 * verifies the selected artifact signature from the archived files, records
 * metadata-only evidence, and removes the temporary directory.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function resolveInside(base, path, label) {
  const output = resolve(base, path);
  const prefix = `${resolve(base)}/`;
  if (output !== resolve(base) && !output.startsWith(prefix)) {
    throw new Error(`${label} must stay inside ${base}`);
  }
  return output;
}

function writeJson(path, value) {
  const output = resolveInside(root, path, "evidence path");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function selectedReleaseArtifact(checkoutRoot) {
  const release = JSON.parse(readFileSync(resolve(checkoutRoot, "release/security-platform/product-release.json"), "utf8"));
  const registry = JSON.parse(readFileSync(resolve(checkoutRoot, "release/security-platform/artifact-registry.json"), "utf8"));
  if (!Array.isArray(release.artifacts) || release.artifacts.length !== 1) {
    throw new Error("clean-checkout verification requires exactly one selected release artifact");
  }
  const artifact = registry.artifacts?.find((entry) => entry.id === release.artifacts[0]);
  if (!artifact) throw new Error("selected release artifact is absent from the archived registry");
  if (artifact.revokedAt) throw new Error("selected release artifact is revoked");
  if (artifact.sourceCommit !== release.sourceCommit) throw new Error("release and artifact source commits differ");
  if (artifact.publicReleaseEligible !== false) throw new Error("local test artifact must not be public-release eligible");
  if (artifact.signingClass !== "test-signed") throw new Error("clean-checkout candidate must remain test-signed");
  return { release, artifact };
}

export function verifyCleanCheckout({ sourceCommit, evidencePath, now = () => new Date() }) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) throw new Error("sourceCommit must be a full Git SHA");
  const startedAt = now();
  const workspace = mkdtempSync(resolve(tmpdir(), "ynx-security-clean-checkout-"));
  const archivePath = resolve(workspace, "source.tar");
  const checkoutRoot = resolve(workspace, "checkout");
  let result;
  let failure;

  try {
    mkdirSync(checkoutRoot, { recursive: true });
    execFileSync("git", ["archive", "--format=tar", `--output=${archivePath}`, sourceCommit], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    execFileSync("tar", ["-xf", archivePath, "-C", checkoutRoot], {
      cwd: workspace,
      stdio: ["ignore", "ignore", "pipe"],
    });
    execFileSync("git", ["init", "--quiet"], {
      cwd: checkoutRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
    execFileSync("git", ["add", "-f", "-A"], {
      cwd: checkoutRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const { release, artifact } = selectedReleaseArtifact(checkoutRoot);
    const policyOutput = run(process.execPath, ["scripts/security-platform.mjs", "verify"], checkoutRoot);
    const directSignatureOutput = JSON.parse(run(process.execPath, [
      "scripts/security-artifact.mjs",
      "verify-signature",
      artifact.manifest,
      artifact.signature,
      artifact.publicKeyFingerprint,
    ], checkoutRoot));
    const signatureRecord = JSON.parse(readFileSync(resolveInside(checkoutRoot, artifact.signature, "artifact signature path"), "utf8"));

    if (!signatureRecord.publicKeyJwk || typeof signatureRecord.publicKeyJwk !== "object") {
      throw new Error("archived signature record does not embed a public JWK");
    }
    if (signatureRecord.privateMaterialPersisted !== false) {
      throw new Error("archived signature record does not assert privateMaterialPersisted=false");
    }
    if ("privateKey" in signatureRecord || "privateKeyPem" in signatureRecord || "seed" in signatureRecord) {
      throw new Error("archived signature record contains a forbidden private-material field");
    }

    const artifactPath = resolveInside(checkoutRoot, artifact.path, "artifact path");
    const completedAt = now();
    result = {
      schemaVersion: 1,
      scenario: "clean-git-archive-artifact-and-registry-verification",
      sourceCommit,
      environment: "local-ephemeral-clean-archive",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      result: "passed-local",
      dependencyInstallPerformed: false,
      archivedRepositoryVerifier: policyOutput,
      archive: {
        sha256: sha256(archivePath),
        bytes: statSync(archivePath).size,
      },
      release: {
        product: release.product,
        version: release.version,
        sourceCommit: release.sourceCommit,
        selectedArtifactId: artifact.id,
        productionSigned: release.productionSigned,
        deployedPublic: release.deployedPublic,
      },
      artifact: {
        sourceCommit: artifact.sourceCommit,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        signingClass: artifact.signingClass,
        publicKeyFingerprint: artifact.publicKeyFingerprint,
        publicReleaseEligible: artifact.publicReleaseEligible,
        localArchiveBytesMatch: statSync(artifactPath).size === artifact.bytes,
        localArchiveSha256Match: sha256(artifactPath) === artifact.sha256,
      },
      directSignatureVerification: directSignatureOutput,
      embeddedPublicJwk: true,
      privateMaterialPersisted: false,
      hiddenWorktreeFilesAvailable: false,
      temporaryWorkspaceRemoved: true,
      limitations: [
        "local Git archive verification only",
        "no remote CI runner evidence",
        "no immutable hosted artifact evidence",
        "no production signature, certificate chain, timestamp, or transparency record",
        "no installation or cold-start evidence",
      ],
    };
  } catch (error) {
    failure = error;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }

  if (failure) throw failure;
  if (evidencePath) writeJson(evidencePath, result);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (command !== "verify") {
      throw new Error("usage: security-clean-checkout.mjs verify --source-commit SHA [--evidence PATH]");
    }
    const result = verifyCleanCheckout({
      sourceCommit: args["source-commit"],
      evidencePath: args.evidence,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
