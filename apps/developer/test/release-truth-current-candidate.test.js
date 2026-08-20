import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("current public candidate and Wallet v2 evidence do not promote missing lifecycle proof", async () => {
  const [release, metadata, evidence, macArtifact, macSums, linuxArtifact, linuxSums, handoff, vectors, acceptance, matrix, compatibility] = await Promise.all([
    read("product-release.json"),
    read("public-product-metadata.json"),
    read("evidence/public/current-public-candidate-bc8a37bc6f2b.json"),
    read("evidence/desktop/macos-current-cb57e10f.json"),
    read("release/ynx-developer-0.2.0-testnet-preview-cb57e10f-macos-arm64-SHA256SUMS.txt"),
    read("evidence/platform/linux-server-current-bc8a37bc.json"),
    read("release/ynx-developer-0.2.0-testnet-preview-bc8a37bc-linux-x64-server-SHA256SUMS.txt"),
    read("docs/integration/INTEGRATION_HANDOFF.md"),
    read("docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"),
    read("docs/integration/DEPENDENCY_ACCEPTANCE.md"),
    read("docs/FEATURE_COMPLETION_EVIDENCE.md"),
    read("docs/MIGRATION_COMPATIBILITY.md"),
  ]);
  const truth = JSON.parse(release), current = JSON.parse(evidence), localMac = JSON.parse(macArtifact), linux = JSON.parse(linuxArtifact), publicMetadata = JSON.parse(metadata), crossProduct = JSON.parse(vectors);
  assert.equal(truth.currentPublicCandidate.sourceCommit, "bc8a37bc6f2bcfcbe9415cb0e9da17a5294046a3");
  assert.equal(current.deploymentTransaction.result, "passed");
  assert.equal(current.truthBoundaries.externalBrowserVisible, false);
  assert.equal(localMac.artifact.sourceCommit, "cb57e10f7f92b01b73942879dedc98f059a1e20b");
  assert.equal(localMac.verification.keychainStorageRoundTripAndCleanup, true);
  assert.equal(localMac.publication.downloadHosted, true);
  assert.equal(localMac.publication.officialRouteHashReadback, true);
  assert.match(macSums, new RegExp(localMac.artifact.sha256));
  assert.equal(linux.artifact.sourceCommit, truth.currentPublicCandidate.sourceCommit);
  assert.equal(linux.verification.coldStart, true);
  assert.equal(linux.publication.downloadHosted, true);
  assert.match(linux.publication.sha256SumsUrl, /linux-x64-server-SHA256SUMS\.txt$/);
  assert.match(linuxSums, new RegExp(linux.artifact.sha256));
  assert.equal(truth.currentLinuxServerArtifact.sha256, linux.artifact.sha256);
  assert.equal(publicMetadata.localEvidence.currentLinuxX64ServerArtifact.hosted, true);
  assert.equal(truth.currentLocalMacArtifact.sha256, localMac.artifact.sha256);
  assert.equal(truth.currentLocalMacArtifact.downloadHosted, true);
  assert.equal(publicMetadata.localEvidence.currentLocalMacArtifact.hosted, true);
  assert.equal(truth.featureStatus.ynxCodePlatform.webSourceCommit, truth.currentPublicCandidate.sourceCommit);
  assert.equal(truth.featureStatus.ynxCodePlatform.macosArm64SourceCommit, localMac.artifact.sourceCommit);
  assert.equal(truth.featureStatus.ynxCodePlatform.windowsCurrent, false);
  assert.equal(publicMetadata.fullPlatformPublicEvidence.nineRuntimes, true);
  assert.equal(publicMetadata.fullPlatformPublicEvidence.independentBrowserVisible, false);
  assert.equal(truth.walletProductSessionV2.publicV2RouteVerified, true);
  assert.equal(truth.walletProductSessionV2.visibleLifecycleVerified, false);
  assert.equal(truth.walletProductSessionV2.migratedV2, false);
  assert.equal(crossProduct.walletProductSessionV2.vectors.filter((item) => item.status === "requires-reviewed-device-evidence").length, 6);
  for (const value of ["createProductWalletConnection", "migratedV2", "requires-reviewed-device-evidence", "historical", "fail-closed compatibility path"]) {
    assert.match(`${handoff}\n${JSON.stringify(crossProduct)}\n${acceptance}\n${matrix}\n${compatibility}`, new RegExp(value));
  }
});
