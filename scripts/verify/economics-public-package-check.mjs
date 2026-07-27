import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJSON = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const metadata = readJSON("public-product-metadata.json");
const release = readJSON("product-release.json");

assert.equal(metadata.schemaVersion, 1);
assert.equal(release.schemaVersion, 1);
assert.equal(metadata.sourceCommit, release.publicMetadataSourceCommit);
assert.notEqual(metadata.sourceCommit, release.sourceCommit, "public metadata and the latest local evidence release must preserve independent source identity");
assert.deepEqual(metadata.product.canonicalRoutes, ["/ynxt", "/economics"]);
assert.deepEqual(metadata.locales, ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"]);
assert.equal(release.states.implementedLocal, true);
assert.equal(release.states.testedLocal, true);
assert.equal(release.states.installedLocal, true, "installedLocal requires persisted direct evidence");
for (const key of ["integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"]) {
  assert.equal(release.states[key], false, `${key} must remain false without persisted direct evidence`);
}
assert.equal(release.artifactCandidate.sourceCommit, release.sourceCommit);
assert.equal(release.artifactCandidate.target, "darwin/arm64");
assert.equal(release.artifactCandidate.doubleBuildVerified, true);
assert.equal(release.artifactCandidate.transientInstallVerified, true);
assert.equal(release.artifactCandidate.coldStartVerified, true);
assert.equal(release.artifactCandidate.persistedEvidence, true);
assert.equal(release.artifactCandidate.productionSigned, false);
assert.equal(release.artifactCandidate.downloadHosted, false);
for (const requiredPath of [release.artifactCandidate.builder, release.artifactCandidate.verification, release.artifactCandidate.evidence]) {
  assert.equal(fs.existsSync(path.join(root, requiredPath)), true, `missing artifact candidate path: ${requiredPath}`);
}
const installation = readJSON(release.installationEvidence.path);
assert.equal(installation.sourceCommit, release.sourceCommit);
assert.equal(installation.artifact.id, release.installationEvidence.artifactId);
assert.equal(installation.artifact.packageHash, release.installationEvidence.packageHash);
assert.equal(installation.artifact.signingClass, release.installationEvidence.signingClass);
assert.equal(installation.releaseTruth.installedLocal, true);
assert.equal(installation.installation.removalVerified, true);
assert.equal(installation.releaseTruth.downloadHosted, false);
assert.equal(installation.releaseTruth.productionSigned, false);
assert.equal(release.sharedTestnetAcceptance.sourceCommit, release.sharedTestnetAcceptanceSourceCommit);
assert.equal(release.sharedTestnetAcceptance.schemaVersion, 1);
assert.equal(release.sharedTestnetAcceptance.evidenceClass, "shared-testnet-owner-attestation-validation");
assert.equal(release.sharedTestnetAcceptance.ownerSourceCommitModel, "independent-consumer-commit-per-owner");
assert.deepEqual(release.sharedTestnetAcceptance.requiredOwners, ["01 Chain Core", "12 Explorer", "13 Monitor", "26 Data Fabric", "29 Integration"]);
for (const requiredPath of [release.sharedTestnetAcceptance.source, release.sharedTestnetAcceptance.schema]) {
  assert.equal(fs.existsSync(path.join(root, requiredPath)), true, `missing shared Testnet acceptance path: ${requiredPath}`);
}
for (const key of ["acceptedEvidenceAttached", "integratedCentral", "deployedStaging", "sharedTestnetEvidence", "publicDeployment", "production"]) {
  assert.equal(release.sharedTestnetAcceptance[key], false, `${key} requires direct shared-Testnet owner evidence`);
}
assert.ok(release.verification.includes("make economics-shared-testnet-acceptance-check"));

const releaseCommit = spawnSync("git", ["cat-file", "-e", `${release.sourceCommit}^{commit}`], { cwd: root });
assert.equal(releaseCommit.status, 0, "release sourceCommit must identify an existing commit");
const sharedAcceptanceCommit = spawnSync("git", ["cat-file", "-e", `${release.sharedTestnetAcceptanceSourceCommit}^{commit}`], { cwd: root });
assert.equal(sharedAcceptanceCommit.status, 0, "shared Testnet acceptance sourceCommit must identify an existing commit");
const metadataCommit = spawnSync("git", ["cat-file", "-e", `${metadata.sourceCommit}^{commit}`], { cwd: root });
assert.equal(metadataCommit.status, 0, "public metadata sourceCommit must identify an existing commit");

for (const artifact of release.artifacts) {
  const bytes = fs.readFileSync(path.join(root, artifact.path));
  assert.equal(bytes.byteLength, artifact.bytes, `${artifact.path} byte count`);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), artifact.sha256, `${artifact.path} digest`);
  assert.equal(artifact.downloadURL, null, `${artifact.path} must not claim hosting`);
}
const artifact = release.artifacts[0];
assert.equal(metadata.assets.socialPreview.sha256, artifact.sha256);
assert.equal(metadata.assets.socialPreview.bytes, artifact.bytes);

const publicText = JSON.stringify({ metadata, release });
for (const disallowed of ["Co" + "dex", "Work" + "tree", "example" + ".com", "local" + "host", "Coming" + " soon", "guaranteed" + " APY"]) {
  assert.equal(publicText.includes(disallowed), false, `public package contains disallowed text: ${disallowed}`);
}

console.log(`economics public package verified: source=${release.sourceCommit} artifact=${artifact.sha256} bytes=${artifact.bytes}`);
