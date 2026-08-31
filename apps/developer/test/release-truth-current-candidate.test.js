import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("current public candidate and Wallet v2 evidence do not promote missing lifecycle proof", async () => {
  const [release, metadata, evidence, publicRuntime, macArtifact, linuxArtifact, linuxSums, windowsArtifact, sdkCandidate, handoff, vectors, acceptance, matrix, compatibility] = await Promise.all([
    read("product-release.json"),
    read("public-product-metadata.json"),
    read("evidence/public/current-public-candidate-bc8a37bc6f2b.json"),
    read("evidence/public/current-public-source-bound-d4052228-20260831.json"),
    read("evidence/desktop/macos-current-ccab67b2.json"),
    read("evidence/platform/linux-server-current-bc8a37bc.json"),
    read("release/ynx-developer-0.2.0-testnet-preview-bc8a37bc-linux-x64-server-SHA256SUMS.txt"),
    read("evidence/desktop/windows-current-591437c6.json"),
    read("evidence/integration/dapp-connect-sdk-pr130-8cfb3265.json"),
    read("docs/integration/INTEGRATION_HANDOFF.md"),
    read("docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"),
    read("docs/integration/DEPENDENCY_ACCEPTANCE.md"),
    read("docs/FEATURE_COMPLETION_EVIDENCE.md"),
    read("docs/MIGRATION_COMPATIBILITY.md"),
  ]);
  const truth = JSON.parse(release), current = JSON.parse(evidence), runtime = JSON.parse(publicRuntime), localMac = JSON.parse(macArtifact), linux = JSON.parse(linuxArtifact), windows = JSON.parse(windowsArtifact), sdk = JSON.parse(sdkCandidate), publicMetadata = JSON.parse(metadata), crossProduct = JSON.parse(vectors);
  assert.equal(truth.currentPublicCandidate.sourceCommit, "d4052228a2261c5ced6a8e8cfcbf763edabf2103");
  assert.equal(truth.currentPublicCandidate.independentCurrentRuntimeReadback, true);
  assert.equal(runtime.publicRuntime.health.version, "0.2.0-testnet-preview-d4052228a226-candidate");
  assert.equal(runtime.publicRuntime.runtimeHealth.release, "0.2.0-testnet-preview-d4052228a226-candidate");
  assert.equal(runtime.binding.htmlAssetReadback, true);
  assert.equal(runtime.binding.browserVisible, false);
  assert.equal(runtime.binding.walletProviderLifecycle, false);
  assert.equal(current.truthBoundaries.externalBrowserVisible, false);
  assert.equal(current.runtimeHealthProbe.httpStatus, 200);
  assert.equal(current.runtimeHealthProbe.compilers.cpp, true);
  assert.equal(current.runtimeHealthProbe.compilers.java, false);
  assert.equal(current.runtimeHealthProbe.languageServers.java, true);
  assert.equal(current.runtimeHealthProbe.authenticatedProfilesWithoutSession.httpStatus, 401);
  assert.equal(current.runtimeHealthProbe.authenticatedProfilesWithoutSession.code, "workspace_session_required");
  assert.equal(current.runtimeHealthProbe.javaRuntimeReady, false);
  assert.equal(localMac.artifact.sourceCommit, "ccab67b2ceaeeaeb962dd6e67696bb3f73835120");
  assert.equal(localMac.verification.dmgMounted, true);
  assert.equal(localMac.verification.nativeWalletAvailability.ynxWalletInstalled, false);
  assert.equal(localMac.publication.downloadHosted, false);
  assert.equal(localMac.publication.externalHttpsReadback, false);
  assert.notEqual(linux.artifact.sourceCommit, truth.currentPublicCandidate.sourceCommit, "Linux server evidence is historical to the current public-Web receipt");
  assert.equal(linux.verification.coldStart, true);
  assert.equal(linux.publication.downloadHosted, true);
  assert.match(linux.publication.sha256SumsUrl, /linux-x64-server-SHA256SUMS\.txt$/);
  assert.match(linuxSums, new RegExp(linux.artifact.sha256));
  assert.equal(truth.currentLinuxServerArtifact.sha256, linux.artifact.sha256);
  assert.equal(publicMetadata.localEvidence.currentLinuxX64ServerArtifact.hosted, true);
  assert.equal(truth.currentLocalMacArtifact.sha256, localMac.artifact.sha256);
  assert.equal(truth.currentLocalMacArtifact.downloadHosted, false);
  assert.equal(publicMetadata.localEvidence.currentLocalMacArtifact.hosted, false);
  assert.equal(windows.artifact.sourceCommit, "591437c64eb53adf987ebea779104d4c5962c6e9");
  assert.equal(windows.verification.msixColdLaunch, true);
  assert.equal(windows.verification.msixSecondLaunch, true);
  assert.equal(windows.verification.realCppCompile, true);
  assert.equal(windows.publication.downloadHosted, false);
  assert.equal(truth.currentLocalWindowsArtifact.sha256, windows.artifact.sha256);
  assert.equal(truth.currentLocalWindowsArtifact.downloadHosted, false);
  assert.equal(publicMetadata.localEvidence.currentLocalWindowsArtifact.hosted, false);
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
