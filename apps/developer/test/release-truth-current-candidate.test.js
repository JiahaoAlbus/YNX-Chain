import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("current public candidate and Wallet v2 evidence do not promote missing lifecycle proof", async () => {
  const [release, metadata, evidence, macArtifact, macSums, linuxArtifact, linuxSums, windowsArtifact, windowsSums, sdkCandidate, handoff, vectors, acceptance, matrix, compatibility] = await Promise.all([
    read("product-release.json"),
    read("public-product-metadata.json"),
    read("evidence/public/current-public-candidate-bc8a37bc6f2b.json"),
    read("evidence/desktop/macos-current-e01b9e4a.json"),
    read("release/ynx-developer-0.2.0-testnet-preview-e01b9e4a-macos-arm64-SHA256SUMS.txt"),
    read("evidence/platform/linux-server-current-bc8a37bc.json"),
    read("release/ynx-developer-0.2.0-testnet-preview-bc8a37bc-linux-x64-server-SHA256SUMS.txt"),
    read("evidence/desktop/windows-current-6ac39fd1.json"),
    read("release/ynx-developer-0.2.0-testnet-preview-6ac39fd1-windows-x64-SHA256SUMS.txt"),
    read("evidence/integration/dapp-connect-sdk-pr130-8cfb3265.json"),
    read("docs/integration/INTEGRATION_HANDOFF.md"),
    read("docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"),
    read("docs/integration/DEPENDENCY_ACCEPTANCE.md"),
    read("docs/FEATURE_COMPLETION_EVIDENCE.md"),
    read("docs/MIGRATION_COMPATIBILITY.md"),
  ]);
  const truth = JSON.parse(release), current = JSON.parse(evidence), localMac = JSON.parse(macArtifact), linux = JSON.parse(linuxArtifact), windows = JSON.parse(windowsArtifact), sdk = JSON.parse(sdkCandidate), publicMetadata = JSON.parse(metadata), crossProduct = JSON.parse(vectors);
  assert.equal(truth.currentPublicCandidate.sourceCommit, "bc8a37bc6f2bcfcbe9415cb0e9da17a5294046a3");
  assert.equal(current.deploymentTransaction.result, "passed");
  assert.equal(current.truthBoundaries.externalBrowserVisible, false);
  assert.equal(localMac.artifact.sourceCommit, "e01b9e4a8cc00be2e590e86e8f043fd746696adf");
  assert.equal(localMac.verification.keychainStorageRoundTripAndCleanup, true);
  assert.equal(localMac.verification.nativeWalletAvailability.ynxWalletInstalled, false);
  assert.equal(localMac.walletProductSessionV2.migratedV2, false);
  assert.equal(localMac.publication.downloadHosted, true);
  assert.equal(localMac.publication.officialRouteHashReadback, true);
  assert.equal(localMac.publication.externalHttpsDownload.httpStatus, 200);
  assert.equal(localMac.publication.externalHttpsDownload.contentLength, localMac.artifact.bytes);
  assert.equal(localMac.publication.externalHttpsDownload.downloadedBytes, localMac.artifact.bytes);
  assert.equal(localMac.publication.externalHttpsDownload.sha256, localMac.artifact.sha256);
  assert.equal(localMac.publication.externalHttpsDownload.sha256MatchesArtifact, true);
  assert.equal(localMac.publication.externalHttpsDownload.sha256MatchesHostedFile, true);
  assert.equal(localMac.publication.externalHttpsDownload.externalBrowserVisible, false);
  assert.match(localMac.publication.sha256SumsUrl, /macos-arm64-SHA256SUMS\.txt$/);
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
  assert.equal(windows.artifact.sourceCommit, "6ac39fd140a54675526583c4c3ca6b07fc03af19");
  assert.equal(windows.verification.coldLaunch, true);
  assert.equal(windows.verification.secondLaunch, true);
  assert.equal(windows.verification.realCppCompile, true);
  assert.equal(windows.publication.officialRouteHashReadback, true);
  assert.equal(windows.publication.publicRangeProbe.contentRange, "bytes 0-0/72538901");
  assert.match(windowsSums, new RegExp(windows.artifact.sha256));
  assert.equal(truth.currentLocalWindowsArtifact.sha256, windows.artifact.sha256);
  assert.equal(truth.currentLocalWindowsArtifact.downloadHosted, true);
  assert.equal(publicMetadata.localEvidence.currentLocalWindowsArtifact.hosted, true);
  assert.equal(truth.featureStatus.ynxCodePlatform.webSourceCommit, truth.currentPublicCandidate.sourceCommit);
  assert.equal(truth.featureStatus.ynxCodePlatform.macosArm64SourceCommit, localMac.artifact.sourceCommit);
  assert.equal(truth.featureStatus.ynxCodePlatform.windowsCurrent, true);
  assert.equal(truth.featureStatus.ynxCodePlatform.windowsX64SourceCommit, windows.artifact.sourceCommit);
  assert.equal(publicMetadata.fullPlatformPublicEvidence.nineRuntimes, true);
  assert.equal(publicMetadata.fullPlatformPublicEvidence.independentBrowserVisible, false);
  assert.equal(truth.walletProductSessionV2.publicV2RouteVerified, true);
  assert.equal(truth.walletProductSessionV2.nativeAbsentWalletVerified, true);
  assert.equal(truth.walletProductSessionV2.nativeAbsentWalletProof.ynxWalletInstalled, false);
  assert.equal(truth.walletProductSessionV2.visibleLifecycleVerified, false);
  assert.equal(truth.walletProductSessionV2.migratedV2, false);
  assert.equal(sdk.classification, "source-only-draft-not-consumed");
  assert.equal(sdk.verification.sdkTests.passed, 12);
  assert.equal(sdk.verification.migrationScanner, "clean");
  assert.equal(sdk.verification.releaseGate, "BUNDLED_SHA256_ACCEPTED");
  assert.equal(sdk.boundaries.developerProductConsumesCandidate, false);
  assert.equal(sdk.boundaries.publicSdkArtifact, false);
  assert.equal(sdk.boundaries.installedProductVerified, false);
  assert.equal(sdk.boundaries.computerControlVerified, false);
  assert.equal(sdk.boundaries.productMigratedV2, false);
  assert.equal(crossProduct.walletProductSessionV2.vectors.filter((item) => item.status === "requires-reviewed-device-evidence").length, 6);
  for (const value of ["createProductWalletConnection", "migratedV2", "requires-reviewed-device-evidence", "current unsigned Testnet Preview", "fail-closed compatibility path"]) {
    assert.match(`${handoff}\n${JSON.stringify(crossProduct)}\n${acceptance}\n${matrix}\n${compatibility}`, new RegExp(value));
  }
});
