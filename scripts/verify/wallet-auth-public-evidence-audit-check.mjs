#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const audit = JSON.parse(readFileSync("release/integration/wallet-auth-public-evidence-audit.json", "utf8"));
const metadata = JSON.parse(readFileSync("release/integration/wallet-auth-public-download-metadata.json", "utf8"));
const record = JSON.parse(readFileSync("release/integration/wallet-auth-release-record.json", "utf8"));
const matrixBytes = readFileSync(record.evidenceMatrix.path);
const matrixSha256 = createHash("sha256").update(matrixBytes).digest("hex");
const failures = [];
const fail = (message) => failures.push(message);
const sha256 = (value) => /^[0-9a-f]{64}$/.test(value ?? "");

if (audit.schemaVersion !== 1) fail("audit schemaVersion must be 1");
if (audit.matrixSha256 !== matrixSha256 || record.evidenceMatrix.sha256 !== matrixSha256) fail("audit/record matrix digest mismatch");
if (audit.publicTestnet?.rpc?.observedResult !== "0x1917" || audit.publicTestnet?.rpc?.verified !== true) fail("public RPC chain identity is not directly verified");
if (!sha256(audit.publicTestnet?.rpc?.responseSha256)) fail("public RPC response digest is missing");
if (audit.publicTestnet?.gatewayHealth?.httpStatus !== 200 || audit.publicTestnet?.gatewayHealth?.remoteDeployed !== true) fail("public Gateway health is not directly verified");
if (!sha256(audit.publicTestnet?.gatewayHealth?.responseSha256)) fail("Gateway health response digest is missing");
if (audit.publicTestnet?.latestFrozenSourceDeployed !== false || audit.publicTestnet?.latestLocalRoutesPublicVerified !== false) fail("latest local Core slices cannot be promoted to public");
if (audit.officialWebsite?.routePublic !== true || audit.officialWebsite?.effectiveStatus !== 200) fail("official Wallet website route is not public");
if (!sha256(audit.officialWebsite?.pageSha256)) fail("official website response digest is missing");
if (!Array.isArray(audit.officialWebsite?.directArtifactLinks) || audit.officialWebsite.directArtifactLinks.length !== 0) fail("official website unexpectedly exposes current direct artifact links");
if (audit.officialWebsite?.currentDownloadsPublished !== false) fail("current website downloads must remain unpublished");
if (audit.githubReleases?.currentCandidateExactArtifactsHosted !== false) fail("historical prereleases cannot host the current candidate set");
if (audit.signingAudit?.candidateCount !== metadata.candidates.length) fail("signing audit candidate count differs from public metadata");
for (const candidate of metadata.candidates) {
  if (candidate.downloadHosted !== false || candidate.productionSigned !== false || candidate.storeReleased !== false || candidate.websitePublishable !== false) fail(`${candidate.id} is not fail-closed`);
}
if (!/^[0-9a-f]{40}$/.test(audit.computerControl?.exactEvidenceCommit ?? "") || !audit.computerControl?.exactEvidencePath) fail("ComputerControl direct evidence commit/path is missing");
if (audit.computerControl?.popupControlSucceeded !== true || audit.computerControl?.popupVisible !== true) fail("ComputerControl popup evidence was not preserved");
if (audit.computerControl?.testnetRpcObserved !== true || audit.computerControl?.testnetChainId !== "0x1917") fail("ComputerControl popup RPC boundary is not exact");
for (const field of ["installedLocal", "addChainObserved", "switchChainObserved", "reconnectObserved", "signObserved", "transactionObserved"]) {
  if (audit.computerControl?.[field] !== false) fail(`computerControl.${field} must remain false without exact evidence`);
}
for (const field of ["latestFrozenGatewaySourcePublic", "downloadHosted", "productionSigned", "storeReleased", "computerControlAccepted"]) {
  if (audit.releaseDecision?.[field] !== false) fail(`releaseDecision.${field} must remain false`);
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`PASS wallet-auth public evidence audit: RPC 0x1917, website route public, ${metadata.candidates.length} candidates fail-closed, ComputerControl pending\n`);
