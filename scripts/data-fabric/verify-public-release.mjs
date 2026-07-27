#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

const [publishDir, hostingReceiptPath, expectedCommit, expectedRelease, expectedBaseURL, mode] = process.argv.slice(2);
const fail = (message) => { throw new Error(message); };
if (
  !publishDir
  || !hostingReceiptPath
  || !/^[0-9a-f]{12}$/.test(expectedCommit ?? "")
  || expectedRelease !== `ynx-data-fabric-${expectedCommit}`
) fail("usage: verify-public-release.mjs <publish-dir> <hosting-receipt> <commit> <release> <base-url> [--downloads]");

const sha256 = (body) => crypto.createHash("sha256").update(body).digest("hex");
const normalizedBaseURL = new URL(expectedBaseURL).toString().replace(/\/$/, "");
const releaseRecordName = `${expectedRelease}-public-release.json`;
const signatureName = `${expectedRelease}-public-release.sig`;
const publicKeyName = `${expectedRelease}-public-release.pub.pem`;
const record = JSON.parse(fs.readFileSync(path.join(publishDir, releaseRecordName), "utf8"));
if (
  record.schema !== "ynx-data-fabric-public-release/v1"
  || record.product !== "ynx-data-fabric"
  || record.commit !== expectedCommit
  || record.release !== expectedRelease
  || record.channel !== "public-testnet"
  || record.target?.os !== "linux"
  || record.target?.architecture !== "amd64"
  || record.states?.downloadHosted !== true
  || record.states?.productionSigned !== true
  || record.signing?.algorithm !== "ed25519-over-sha256"
  || !/^[0-9a-f]{64}$/.test(record.signing?.publicKeySha256 ?? "")
  || record.signing?.signaturePath !== signatureName
  || record.hosting?.immutable !== true
  || record.hosting?.baseURL !== normalizedBaseURL
  || record.hosting?.releaseRecordURL !== `${normalizedBaseURL}/${releaseRecordName}`
  || record.hosting?.signatureURL !== `${normalizedBaseURL}/${signatureName}`
  || record.hosting?.publicKeyURL !== `${normalizedBaseURL}/${publicKeyName}`
  || !record.signing?.class
  || !record.signing?.approvalId
  || !record.signing?.provenanceIdentity
  || !record.releaseApprover
) fail("public release identity, signing, hosting, or state truth is invalid");

const requiredRoles = new Set([
  "linux-amd64-archive",
  "testnet-candidate-index",
  "internal-release-manifest",
  "build-provenance",
  "sbom",
  "installer",
  "cold-start-evidence",
]);
if (!Array.isArray(record.artifacts) || record.artifacts.length !== requiredRoles.size) fail("public release artifact inventory is incomplete");
const roles = new Set(record.artifacts.map((artifact) => artifact?.role));
if (roles.size !== requiredRoles.size || [...requiredRoles].some((role) => !roles.has(role))) fail("public release artifact roles are invalid");
for (const artifact of record.artifacts) {
  if (
    typeof artifact.path !== "string"
    || path.basename(artifact.path) !== artifact.path
    || artifact.url !== `${normalizedBaseURL}/${artifact.path}`
    || !Number.isSafeInteger(artifact.bytes)
    || artifact.bytes <= 0
    || !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? "")
  ) fail(`public release artifact metadata is invalid: ${artifact.path}`);
  const body = fs.readFileSync(path.join(publishDir, artifact.path));
  if (body.length !== artifact.bytes || sha256(body) !== artifact.sha256) fail(`public release artifact integrity mismatch: ${artifact.path}`);
}

const publicKey = fs.readFileSync(path.join(publishDir, publicKeyName));
const publicKeyDER = execFileSync("openssl", ["pkey", "-pubin", "-in", path.join(publishDir, publicKeyName), "-outform", "DER"]);
if (sha256(publicKeyDER) !== record.signing.publicKeySha256 || publicKey.length === 0) fail("public release public key fingerprint is invalid");
const candidate = JSON.parse(fs.readFileSync(path.join(publishDir, `${expectedRelease}-release-index.json`), "utf8"));
const archive = record.artifacts.find((artifact) => artifact.role === "linux-amd64-archive");
if (
  candidate.schema !== "ynx-data-fabric-public-testnet-release/v1"
  || candidate.commit !== expectedCommit
  || candidate.release !== expectedRelease
  || candidate.artifact?.sha256 !== archive.sha256
  || candidate.artifact?.bytes !== archive.bytes
  || candidate.signing?.productionSigned !== false
  || candidate.hosting?.hosted !== false
) fail("signed public release does not preserve the verified Testnet candidate identity");

const coldStart = JSON.parse(fs.readFileSync(path.join(publishDir, `${expectedRelease}-cold-start-evidence.json`), "utf8"));
if (
  coldStart.schema !== "ynx-data-fabric-cold-start-evidence/v1"
  || coldStart.commit !== expectedCommit
  || coldStart.release !== expectedRelease
  || coldStart.status !== "verified"
  || coldStart.archiveSha256 !== archive.sha256
) fail("public release cold-start evidence is invalid");

const receipt = JSON.parse(fs.readFileSync(hostingReceiptPath, "utf8"));
if (
  receipt.schema !== "ynx-data-fabric-immutable-hosting-receipt/v1"
  || typeof receipt.provider !== "string"
  || !receipt.provider
  || receipt.immutable !== true
  || receipt.baseURL !== normalizedBaseURL
  || !Array.isArray(receipt.objects)
) fail("immutable hosting receipt is invalid");
const localFiles = fs.readdirSync(publishDir).filter((name) => fs.statSync(path.join(publishDir, name)).isFile()).sort();
const expectedFiles = [...record.artifacts.map((artifact) => artifact.path), releaseRecordName, signatureName, publicKeyName].sort();
if (localFiles.length !== expectedFiles.length || localFiles.some((name, index) => name !== expectedFiles[index])) {
  fail("public release directory contains an unauthorized or missing object");
}
const receiptByPath = new Map(receipt.objects.map((object) => [object?.path, object]));
if (receiptByPath.size !== localFiles.length || receipt.objects.length !== localFiles.length) fail("immutable hosting receipt inventory is incomplete");
for (const name of localFiles) {
  const body = fs.readFileSync(path.join(publishDir, name));
  const object = receiptByPath.get(name);
  if (
    !object
    || object.url !== `${normalizedBaseURL}/${name}`
    || object.bytes !== body.length
    || object.sha256 !== sha256(body)
    || typeof object.etag !== "string"
    || !object.etag
  ) fail(`immutable hosting receipt mismatch: ${name}`);
}

if (mode === "--downloads") {
  for (const name of localFiles) {
    const object = receiptByPath.get(name);
    process.stdout.write(`${name}\t${object.url}\t${object.bytes}\t${object.sha256}\n`);
  }
} else {
  process.stdout.write(`${JSON.stringify({status: "verified", commit: expectedCommit, release: expectedRelease, hostedObjects: localFiles.length})}\n`);
}
