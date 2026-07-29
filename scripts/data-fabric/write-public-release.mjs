#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalJSON} from "../lib/sdk-release.mjs";

const [
  publishDir,
  commit,
  release,
  immutableBaseURL,
  publicKeySha256,
  signingAlgorithm,
  signingClass,
  approvalID,
  provenanceIdentity,
  releaseApprover,
] = process.argv.slice(2);
if (
  !publishDir
  || !/^[0-9a-f]{12}$/.test(commit ?? "")
  || release !== `ynx-data-fabric-${commit}`
  || !/^[0-9a-f]{64}$/.test(publicKeySha256 ?? "")
  || !["ed25519-over-sha256", "rsa-pkcs1-sha256-over-sha256"].includes(signingAlgorithm)
  || [signingClass, approvalID, provenanceIdentity, releaseApprover].some((value) => !value || value.length > 256)
) {
  throw new Error("usage: write-public-release.mjs <publish-dir> <commit> <release> <immutable-base-url> <public-key-sha256> <signing-algorithm> <signing-class> <approval-id> <provenance-identity> <release-approver>");
}
const baseURL = new URL(immutableBaseURL);
if (
  baseURL.protocol !== "https:"
  || baseURL.username
  || baseURL.password
  || baseURL.search
  || baseURL.hash
  || !baseURL.pathname.endsWith(`/${release}`)
) {
  throw new Error("immutable base URL must be HTTPS, credential-free, query-free, and end with the commit-bound release");
}
const normalizedBaseURL = baseURL.toString().replace(/\/$/, "");
const sha256 = (body) => crypto.createHash("sha256").update(body).digest("hex");
const required = [
  [`${release}-linux-amd64.tar.gz`, "linux-amd64-archive"],
  [`${release}-release-index.json`, "testnet-candidate-index"],
  [`${release}-release-manifest.json`, "internal-release-manifest"],
  [`${release}-provenance.json`, "build-provenance"],
  [`${release}-go-runtime.spdx.json`, "sbom"],
  [`${release}-install-testnet-release.sh`, "installer"],
  [`${release}-cold-start-evidence.json`, "cold-start-evidence"],
];
const artifacts = required.map(([name, role]) => {
  const body = fs.readFileSync(path.join(publishDir, name));
  return {role, path: name, url: `${normalizedBaseURL}/${name}`, bytes: body.length, sha256: sha256(body)};
});

const coldStart = JSON.parse(fs.readFileSync(path.join(publishDir, `${release}-cold-start-evidence.json`), "utf8"));
const archive = artifacts.find((artifact) => artifact.role === "linux-amd64-archive");
const requiredColdStartChecks = [
  "archiveIntegrity",
  "extractedManifestIntegrity",
  "executableELFInventory",
  "daemonHealth",
  "runtimeIdentity",
  "metrics",
  "operatorSurface",
  "unauthorizedWriteRejected",
  "fileIntegrityAudit",
  "backupRestore",
  "workerProcessLoad",
  "payBridgeProcessLoad",
];
if (
  coldStart.schema !== "ynx-data-fabric-cold-start-evidence/v1"
  || coldStart.commit !== commit
  || coldStart.release !== release
  || coldStart.target?.os !== "linux"
  || coldStart.target?.architecture !== "amd64"
  || (coldStart.environment !== "linux-runtime" && coldStart.environment !== "contract-test")
  || coldStart.status !== "verified"
  || coldStart.archiveSha256 !== archive.sha256
  || requiredColdStartChecks.some((check) => coldStart.checks?.[check] !== true)
  || (coldStart.environment === "linux-runtime" && (!Array.isArray(coldStart.binaries) || coldStart.binaries.length !== 4))
) {
  throw new Error("cold-start evidence is not bound to the release archive");
}

const record = {
  schema: "ynx-data-fabric-public-release/v1",
  product: "ynx-data-fabric",
  commit,
  release,
  channel: "public-testnet",
  target: {os: "linux", architecture: "amd64"},
  states: {
    downloadHosted: true,
    productionSigned: true,
  },
  signing: {
    algorithm: signingAlgorithm,
    class: signingClass,
    approvalId: approvalID,
    provenanceIdentity,
    publicKeySha256,
    signaturePath: `${release}-public-release.sig`,
  },
  hosting: {
    immutable: true,
    baseURL: normalizedBaseURL,
    releaseRecordURL: `${normalizedBaseURL}/${release}-public-release.json`,
    signatureURL: `${normalizedBaseURL}/${release}-public-release.sig`,
    publicKeyURL: `${normalizedBaseURL}/${release}-public-release.pub.pem`,
  },
  releaseApprover,
  artifacts,
};
fs.writeFileSync(path.join(publishDir, `${release}-public-release.json`), canonicalJSON(record), {mode: 0o644});
