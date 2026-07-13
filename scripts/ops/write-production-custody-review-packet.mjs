#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.resolve(process.env.YNX_PRODUCTION_SERVICE_SIGNER_PUBLIC_MANIFEST || "");
const statusPath = path.resolve(process.env.YNX_PRODUCTION_SERVICE_SIGNER_CEREMONY_STATUS || "");
if (!process.env.YNX_PRODUCTION_SERVICE_SIGNER_PUBLIC_MANIFEST || !process.env.YNX_PRODUCTION_SERVICE_SIGNER_CEREMONY_STATUS) {
  throw new Error("YNX_PRODUCTION_SERVICE_SIGNER_PUBLIC_MANIFEST and YNX_PRODUCTION_SERVICE_SIGNER_CEREMONY_STATUS are required");
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readRestricted = (file, label) => {
  const stat = fs.statSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error(`${label} must be a mode-restricted regular file`);
  return fs.readFileSync(file);
};

const manifestRaw = readRestricted(manifestPath, "public signer manifest");
const statusRaw = readRestricted(statusPath, "ceremony status");
const manifest = JSON.parse(manifestRaw);
const status = JSON.parse(statusRaw);
const roles = ["faucet", "ai", "pay", "trust", "resource"];
if (manifest.schemaVersion !== 1 || manifest.purpose !== "ynx-production-service-signer-public-manifest" || !Array.isArray(manifest.records) || manifest.records.length !== roles.length) {
  throw new Error("public signer manifest identity is invalid");
}
const records = roles.map((role, index) => {
  const record = manifest.records[index];
  if (record?.role !== role || record.purpose !== `ynx-production-${role}-signer` || !/^0x[0-9a-f]{40}$/.test(record.address || "")) {
    throw new Error(`public signer manifest ${role} record is invalid`);
  }
  return { role, purpose: record.purpose, address: record.address };
});
if (new Set(records.map((record) => record.address)).size !== records.length) throw new Error("public signer addresses must be distinct");
const publicManifestSha256 = sha256(manifestRaw);
if (status.schemaVersion !== 1 || status.purpose !== "ynx-production-service-signer-ceremony-status" || status.publicManifestSha256 !== publicManifestSha256 || status.signerCount !== 5) {
  throw new Error("ceremony status does not bind the public signer manifest");
}
if (status.remoteSignerInstallCompleted !== false || status.offlineRecoveryVerified !== false || status.ownerHandoverVerified !== false || status.rotationProcedureVerified !== false || status.independentCustodyReviewVerified !== false) {
  throw new Error("source ceremony status must preserve unresolved external custody assertions");
}

const commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const packetId = process.env.YNX_PRODUCTION_CUSTODY_REVIEW_ID || `custody-review-${commit}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(packetId)) throw new Error("YNX_PRODUCTION_CUSTODY_REVIEW_ID is invalid");
const outputRoot = path.resolve(repoRoot, process.env.YNX_PRODUCTION_CUSTODY_REVIEW_DIR || "tmp/production-custody-review", packetId);
if (fs.existsSync(outputRoot)) throw new Error(`custody review packet already exists: ${outputRoot}`);
fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(outputRoot, 0o700);

const reviewPath = path.join(outputRoot, "review.template.json");
const requestPath = path.join(outputRoot, "REVIEW_REQUEST.md");
const review = {
  schemaVersion: 1,
  action: "ynx-production-custody-review",
  reviewId: `pending-${packetId}`,
  reviewer: "",
  reviewed: false,
  commit,
  publicManifestSha256,
  sourceCeremonyStatusSha256: sha256(statusRaw),
  signerCount: 5,
  records,
  validatorKeyRecoveryVerified: false,
  serviceSignerRecoveryVerified: false,
  ownerHandoverVerified: false,
  rotationProcedureVerified: false,
  validatorRecoveryEvidence: "",
  serviceSignerRecoveryEvidence: "",
  ownerHandoverEvidence: "",
  rotationProcedureEvidence: "",
  reviewedAt: "",
  expiresAt: "",
};
fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(reviewPath, 0o600);

const request = `# Production Custody Review Request

This packet contains public signer identities and hashes only. It does not authorize remote signer installation or any BFT transaction.

- Commit: \`${commit}\`
- Public signer manifest SHA-256: \`${publicManifestSha256}\`
- Signers: Faucet, AI, Pay, Trust, Resource
- Independent reviewer: required
- Offline validator-key recovery: must be observed and referenced
- Offline five-service-signer recovery: must be observed and referenced
- Owner handover: must be acknowledged and referenced
- Rotation procedure: must be exercised or reviewed and referenced
- Maximum review validity: 7 days

Keep every evidence field as a compact non-secret reference. Do not place keys, mnemonics, passwords, tokens, recovery material, or private evidence content in this packet. The template defaults every external assertion to false.

After independent review, validate the mode-0600 JSON with:

\`node scripts/verify/validate-production-custody-review.mjs '${reviewPath.replaceAll("'", `'"'"'`)}' ${commit} ${publicManifestSha256}\`

The validator emits an exact \`sha256:<digest>\` custody evidence reference for a later transaction approval. Validation does not install signers or authorize a transaction.
`;
fs.writeFileSync(requestPath, request, { mode: 0o600 });
fs.chmodSync(requestPath, 0o600);

console.log(`production custody review template: ${reviewPath}`);
console.log(`production custody review request: ${requestPath}`);
console.log("packet is unreviewed and non-mutating; all external custody assertions remain false");
