import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const walletRoot = new URL("../", import.meta.url);
const publishedManifest = JSON.parse(await readFile(new URL("artifact-manifest.json", walletRoot), "utf8"));
const manifest = JSON.parse(await readFile(new URL("artifact-candidate-1.0.20.json", walletRoot), "utf8"));
const publication = JSON.parse(await readFile(new URL("artifact-publication-1.0.17.json", walletRoot), "utf8"));
const publication118 = JSON.parse(await readFile(new URL("artifact-publication-1.0.18.json", walletRoot), "utf8"));
const publication119 = JSON.parse(await readFile(new URL("artifact-publication-1.0.19.json", walletRoot), "utf8"));
const app = JSON.parse(await readFile(new URL("app.json", walletRoot), "utf8")).expo;
const android = await readFile(new URL("android/app/build.gradle", walletRoot), "utf8");
const plist = await readFile(new URL("ios/YNXWallet/Info.plist", walletRoot), "utf8");
const xcode = await readFile(new URL("ios/YNXWallet.xcodeproj/project.pbxproj", walletRoot), "utf8");
const evidence = JSON.parse(await readFile(new URL(manifest.candidateEvidence, walletRoot), "utf8"));
const installedEvidence = JSON.parse(await readFile(new URL(manifest.reconciliationBinding.publishedBaselineEvidence, walletRoot), "utf8"));
const nativeOutboxSource = await readFile(new URL("src/chain/nativeTransferOutbox.ts", walletRoot), "utf8");
const appSource = await readFile(new URL("App.tsx", walletRoot), "utf8");
const releaseNotes = await readFile(new URL("RELEASE_NOTES.md", walletRoot), "utf8");
const publicationEvidence = JSON.parse(await readFile(new URL(publication.publicationEvidence, walletRoot), "utf8"));
const publicationEvidence118 = JSON.parse(await readFile(new URL(publication118.publicationEvidence, walletRoot), "utf8"));
const publicationEvidence119 = JSON.parse(await readFile(new URL(publication119.publicationEvidence, walletRoot), "utf8"));
const installedEvidence119 = JSON.parse(await readFile(new URL(publication119.installedEvidence, walletRoot), "utf8"));

const previous = Object.freeze({
  tag: "wallet-android-testnet-preview-1.0.16-e9816a827",
  apk: Object.freeze({
    url: "https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-android-testnet-preview-1.0.16-e9816a827/ynx-wallet-1.0.16-testnet-preview-e9816a827-universal-local-test-signed.apk",
    bytes: 116631255,
    sha256: "89a842dc8641206a9154a6e41fd1c9e3cbb4b6cca2cea455ed5b7fc674b558c0",
  }),
  aab: Object.freeze({
    url: "https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-android-testnet-preview-1.0.16-e9816a827/ynx-wallet-1.0.16-testnet-preview-e9816a827-local-test-signed.aab",
    bytes: 71870019,
    sha256: "117aee9610ef3878e5c2dc226acee57ae2820f1613cc8cabc536a12abd1ddd9a",
  }),
});
const published117 = Object.freeze({
  sourceCommit: "875f6c5b744b4b641eb5c2c9b2cb41e928676c90",
  tag: "wallet-android-testnet-preview-1.0.17-875f6c5b7",
  releaseUrl: "https://github.com/JiahaoAlbus/YNX-Chain/releases/tag/wallet-android-testnet-preview-1.0.17-875f6c5b7",
  releaseId: 392422025,
  releaseCreatedAt: "2026-09-20T12:13:28Z",
  releasePublishedAt: "2026-09-20T12:19:31Z",
  observedAt: "2026-09-20T12:21:28Z",
  apk: Object.freeze({
    assetId: 576764497,
    filename: "ynx-wallet-1.0.17-testnet-preview-875f6c5b7-universal-local-test-signed.apk",
    url: "https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-android-testnet-preview-1.0.17-875f6c5b7/ynx-wallet-1.0.17-testnet-preview-875f6c5b7-universal-local-test-signed.apk",
    bytes: 116636787,
    sha256: "04a37e7bd9f76bb3bb76fe330921f0f80e6d2cfa3b115d38ac93c53cb80370a2",
  }),
  aab: Object.freeze({
    assetId: 576764498,
    filename: "ynx-wallet-1.0.17-testnet-preview-875f6c5b7-local-test-signed.aab",
    url: "https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-android-testnet-preview-1.0.17-875f6c5b7/ynx-wallet-1.0.17-testnet-preview-875f6c5b7-local-test-signed.aab",
    bytes: 71872002,
    sha256: "079c8e0597ab0c30b884e10c0d15bd1a8f606c6412509162fa85429966dbef1b",
  }),
  androidHermes: Object.freeze({
    path: "dist-android/_expo/static/js/android/index-914b007e1bb25a1cb8c657e58ed7afa0.hbc",
    bytes: 9399238,
    sha256: "1228b51c6d93cf42c5407f7cccd2d6578ab766583e65f2529914b0743e36d36a",
  }),
  iosHermes: Object.freeze({
    path: "dist-ios/_expo/static/js/ios/index-a52648763664cc19c4f07397f16a9a9e.hbc",
    bytes: 9394059,
    sha256: "b06dc784a39e7b569cdd1e46aafe4c8e3965645903f06f64055062678db85fa3",
  }),
});

function strictUtcSeconds(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const parsed = Date.parse(value);
  assert.equal(Number.isFinite(parsed), true);
  assert.equal(new Date(parsed).toISOString().replace(".000Z", "Z"), value);
  assert.ok(parsed <= Date.now(), "evidence timestamp must not claim a future observation");
  return parsed;
}

function validate(candidate) {
  assert.equal(candidate.schemaVersion, 2);
  assert.equal(candidate.productId, "wallet");
  assert.equal(candidate.version, "1.0.20-testnet-preview");
  assert.equal(candidate.versionCode, 26);
  assert.equal(candidate.releaseStatus, "SOURCE_CANDIDATE_AWAITING_EXACT_MERGE_BUILD");
  assert.equal(candidate.releaseSourceCommit, null);
  assert.equal(candidate.releaseTag, null);
  assert.equal(candidate.releaseUrl, null);
  assert.deepEqual(candidate.artifacts, []);
  assert.deepEqual(candidate.publicArtifactUrls, []);
  assert.equal(candidate.releaseImmutable, false);
  assert.equal(candidate.publisherCanReplaceAssets, true);
  assert.equal(candidate.downloadTimeSha256Required, true);
  assert.equal(candidate.productionSigned, false);
  assert.equal(candidate.storeReleased, false);
  assert.equal(candidate.walletConnectRelayE2E, "NOT_VERIFIED");
  assert.equal(candidate.physicalDevice, "NOT_VERIFIED");
  assert.deepEqual(candidate.reconciliationBinding.implementationCommits, [
    "58a925a82d55c7ec723839ad54f04bc35101dcf8",
    "79af604db3d404e0155c0ee055038c00012b5deb",
  ]);
  assert.equal(candidate.reconciliationBinding.mergedSource, "d970a92f71a4ade1c46122571e77fe449f9910ba");
  assert.equal(candidate.reconciliationBinding.publishedBaselineEvidence, "proof/wallet-android-1.0.19-installed-readonly-20260921.json");
  assert.deepEqual(candidate.reconciliationBinding.coverage, [
    "strict-status-0x1-durable-native-receipt",
    "per-transaction-hash-terminal-resolution",
    "restart-recovers-active-outbox-to-done",
    "terminal-resolution-releases-next-send-without-manual-ack",
    "current-lease-dashboard-balance-nonce-activity-refresh",
    "unknown-and-nonterminal-statuses-remain-blocking",
    "original-payload-only-no-duplicate-broadcast",
  ]);
  assert.equal(candidate.previousPublishedRelease.version, publication119.version);
  assert.equal(candidate.previousPublishedRelease.versionCode, publication119.versionCode);
  assert.equal(candidate.previousPublishedRelease.tag, publication119.releaseTag);
  assert.equal(candidate.previousPublishedRelease.releaseImmutable, false);
  assert.equal(candidate.previousPublishedRelease.publisherCanReplaceAssets, true);
  assert.equal(candidate.previousPublishedRelease.assetsMustNotBeReplaced, true);
  const published119Apk = publication119.artifacts.find(({ name }) => name === "android-release-apk");
  const published119Aab = publication119.artifacts.find(({ name }) => name === "android-release-aab");
  assert.deepEqual(candidate.previousPublishedRelease.apk, {
    url: published119Apk.url,
    assetId: published119Apk.assetId,
    bytes: published119Apk.bytes,
    sha256: published119Apk.sha256,
  });
  assert.deepEqual(candidate.previousPublishedRelease.aab, {
    url: published119Aab.url,
    assetId: published119Aab.assetId,
    bytes: published119Aab.bytes,
    sha256: published119Aab.sha256,
  });
  assert.match(candidate.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const generatedAt = Date.parse(candidate.generatedAt);
  assert.equal(Number.isFinite(generatedAt), true);
  assert.ok(generatedAt <= Date.now(), "generatedAt must not claim a future observation");
}

function validateEvidence(value) {
  assert.equal(value.version, "1.0.20-testnet-preview");
  assert.equal(value.versionCode, 26);
  assert.equal(value.baseCommit, "d970a92f71a4ade1c46122571e77fe449f9910ba");
  assert.deepEqual(value.reconciliationImplementationCommits, manifest.reconciliationBinding.implementationCommits);
  assert.equal(value.publishedBaselineEvidence, manifest.reconciliationBinding.publishedBaselineEvidence);
  assert.deepEqual(value.sourceContracts, ["src/chain/nativeTransferOutbox.ts", "src/chain/nativeDurability.ts", "App.tsx"]);
  assert.deepEqual(value.regressionTests, ["src/chain/nativeTransferOutbox.test.ts", "src/chain/nativeDurability.test.ts", "src/chain/nativeTransferUiContract.test.ts", "src/chain/nativeTransferCrossPlatformContract.test.ts"]);
  assert.equal(value.releaseSourceCommit, null);
  assert.equal(value.releaseTag, null);
  assert.equal(value.artifactsBuiltFromExactMerge, false);
  assert.equal(value.artifactsPublished, false);
  assert.equal(value.productionSigned, false);
  assert.equal(value.storeReleased, false);
  assert.equal(value.walletConnectRelayE2E, "NOT_VERIFIED");
  assert.equal(value.physicalAndroidDevice, "NOT_VERIFIED");
  assert.equal(value.iosPhysicalDevice, "NOT_VERIFIED");
  assert.equal(value.officialWebsiteUpdated, false);
  assert.deepEqual(value.candidateBehavior, {
    strictDurableSuccessReceiptRequired: true,
    terminalResolutionPersistedByTransactionHash: true,
    restartAutoArchivesAndUnlocks: true,
    dashboardRefreshAfterActiveToDoneRecovery: true,
    initialDoneDoesNotRepeatDashboardRefresh: true,
    unknownOrNonterminalAllowsReplacement: false,
    automaticRebroadcast: false,
    manualDoneRequiredAfterVerifiedSuccess: false,
  });
  assert.equal(value.previousReleasePreserved.tag, publication119.releaseTag);
  assert.equal(value.previousReleasePreserved.apkAssetId, manifest.previousPublishedRelease.apk.assetId);
  assert.equal(value.previousReleasePreserved.aabAssetId, manifest.previousPublishedRelease.aab.assetId);
  assert.equal(value.previousReleasePreserved.assetsMustNotBeReplaced, true);
  assert.equal(value.generatedAt, manifest.generatedAt);
  assert.ok(Date.parse(value.generatedAt) <= Date.now());
}

function validatePublication(value) {
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.productId, "wallet");
  assert.equal(value.version, "1.0.17-testnet-preview");
  assert.equal(value.versionCode, 23);
  assert.equal(value.releaseStatus, "PUBLISHED_TESTNET_PRERELEASE");
  assert.equal(value.sourceCommit, published117.sourceCommit);
  assert.equal(value.releaseTag, published117.tag);
  assert.equal(value.releaseUrl, published117.releaseUrl);
  assert.equal(value.releaseImmutable, false);
  assert.equal(value.publisherCanReplaceAssets, true);
  assert.equal(value.downloadTimeSha256Verified, true);
  assert.equal(value.productionSigned, false);
  assert.equal(value.storeReleased, false);
  assert.equal(value.walletConnectRelayE2E, "NOT_VERIFIED");
  assert.equal(value.publicationEvidence, "proof/wallet-android-1.0.17-publication-20260920.json");
  assert.deepEqual(value.artifacts.map(({ name }) => name).sort(), ["android-hermes", "android-release-aab", "android-release-apk", "ios-hermes"]);
  assert.equal(new Set(value.artifacts.map(({ name }) => name)).size, 4);
  const apk = value.artifacts.find(({ name }) => name === "android-release-apk");
  const aab = value.artifacts.find(({ name }) => name === "android-release-aab");
  const androidHermes = value.artifacts.find(({ name }) => name === "android-hermes");
  const iosHermes = value.artifacts.find(({ name }) => name === "ios-hermes");
  assert.deepEqual(
    { bytes: apk.bytes, sha256: apk.sha256, signingClass: apk.signingClass, productionSigned: apk.productionSigned, versionCode: apk.versionCode },
    { bytes: published117.apk.bytes, sha256: published117.apk.sha256, signingClass: "local-test-signed", productionSigned: false, versionCode: 23 },
  );
  assert.deepEqual(
    { bytes: aab.bytes, sha256: aab.sha256, signingClass: aab.signingClass, productionSigned: aab.productionSigned, versionCode: aab.versionCode },
    { bytes: published117.aab.bytes, sha256: published117.aab.sha256, signingClass: "local-test-signed", productionSigned: false, versionCode: 23 },
  );
  assert.equal(apk.filename, published117.apk.filename);
  assert.equal(apk.url, published117.apk.url);
  assert.equal(aab.filename, published117.aab.filename);
  assert.equal(aab.url, published117.aab.url);
  assert.deepEqual(
    { path: androidHermes.path, bytes: androidHermes.bytes, sha256: androidHermes.sha256, signingClass: androidHermes.signingClass },
    { ...published117.androidHermes, signingClass: "unsigned-build-output" },
  );
  assert.deepEqual(
    { path: iosHermes.path, bytes: iosHermes.bytes, sha256: iosHermes.sha256, signingClass: iosHermes.signingClass },
    { ...published117.iosHermes, signingClass: "unsigned-build-output" },
  );
  assert.equal(value.generatedAt, published117.observedAt);
  strictUtcSeconds(value.generatedAt);
}

function validatePublicationEvidence(value, published) {
  assert.equal(value.schema, "ynx-wallet-mobile-preview-publication/v1");
  assert.equal(value.releaseTag, published117.tag);
  assert.equal(value.releaseUrl, published117.releaseUrl);
  assert.equal(value.targetCommit, published117.sourceCommit);
  assert.equal(value.prerelease, true);
  assert.equal(value.releaseImmutable, false);
  assert.equal(value.publisherCanReplaceAssets, true);
  assert.equal(value.downloadTimeSha256Verified, true);
  assert.equal(value.githubReleaseId, published117.releaseId);
  assert.equal(value.releaseCreatedAt, published117.releaseCreatedAt);
  assert.equal(value.releasePublishedAt, published117.releasePublishedAt);
  assert.equal(value.apkAssetId, published117.apk.assetId);
  assert.equal(value.aabAssetId, published117.aab.assetId);
  for (const [kind, expected] of [["apk", published117.apk], ["aab", published117.aab]]) {
    assert.equal(value[kind].url, expected.url);
    assert.equal(value[kind].bytes, expected.bytes);
    assert.equal(value[kind].sha256, expected.sha256);
    assert.equal(value[kind].freshDownloadDigestMatched, true);
  }
  assert.equal(value.apk.apkSignatureV2Verified, true);
  assert.equal(value.aab.jarSignatureVerified, true);
  assert.equal(value.signerCertificateDn, "C=US, O=Android, CN=Android Debug");
  assert.equal(value.signerCertificateSha256, "d4e562610ecb4e304fa00ee07e7adae7da862ce108bda7bdfe933c28831f154e");
  assert.equal(value.productionSigned, false);
  assert.equal(value.storeReleased, false);
  assert.equal(value.walletConnectRelayE2E, false);
  assert.equal(value.recoveryContractTests.liveChainTransferExecuted, false);
  assert.deepEqual(value.recoveryContractTests, { passed: 56, failed: 0, liveChainTransferExecuted: false });
  assert.deepEqual(value.emulator, {
    avd: "YNX_WC_RC_20260920",
    api: 36,
    upgradedFromVersionCode: 22,
    upgradeInstall: "PASS",
    firstInstallTimePreserved: true,
    coldLaunch: "PASS",
    coldLaunchTotalTimeMs: 220,
    malformedDeepLink: "FAIL_CLOSED_NO_CRASH",
    walletConnectDeepLinkWithoutProjectId: "DISABLED_NO_CRASH",
    crashBufferEmpty: true,
  });
  assert.equal(value.officialWebsiteUpdated, false);
  assert.equal(value.generatedAt, published117.observedAt);
  assert.equal(value.generatedAt, published.generatedAt);
  const created = strictUtcSeconds(value.releaseCreatedAt);
  const publishedAt = strictUtcSeconds(value.releasePublishedAt);
  const observed = strictUtcSeconds(value.generatedAt);
  assert.ok(created >= Date.parse("2026-09-20T12:13:28Z"));
  assert.ok(publishedAt >= created);
  assert.ok(observed >= publishedAt);
  assert.equal(value.apk.url, published.artifacts.find(({ name }) => name === "android-release-apk").url);
  assert.equal(value.aab.url, published.artifacts.find(({ name }) => name === "android-release-aab").url);
}

test("the active download manifest remains the compatible published 1.0.16 contract", () => {
  assert.equal(publishedManifest.schemaVersion, 1);
  assert.equal(publishedManifest.version, "1.0.16-testnet-preview");
  assert.equal(publishedManifest.versionCode, 22);
  assert.equal(publishedManifest.releaseStatus, "PUBLISHED_TESTNET_PRERELEASE");
  assert.equal(publishedManifest.publishedRelease.tag, previous.tag);
  assert.equal(publishedManifest.releaseImmutable, false);
  assert.equal(publishedManifest.publisherCanReplaceAssets, true);
  const apk = publishedManifest.artifacts.find(({ name }) => name === "android-release-apk");
  const aab = publishedManifest.artifacts.find(({ name }) => name === "android-release-aab");
  assert.equal(apk.url, previous.apk.url);
  assert.equal(apk.bytes, previous.apk.bytes);
  assert.equal(apk.sha256, previous.apk.sha256);
  assert.equal(aab.url, previous.aab.url);
  assert.equal(aab.bytes, previous.aab.bytes);
  assert.equal(aab.sha256, previous.aab.sha256);
});

test("1.0.20 source candidate binds native versions and reconciliation source without inventing a release", () => {
  validate(manifest);
  assert.equal(app.version, "1.0.20");
  assert.equal(app.android.versionCode, 26);
  assert.equal(app.ios.buildNumber, "26");
  assert.match(android, /versionCode 26\n\s*versionName "1\.0\.20-testnet-preview"/);
  assert.match(plist, /CFBundleShortVersionString<\/key>\s*<string>1\.0\.20<\/string>/);
  assert.match(plist, /CFBundleVersion<\/key>\s*<string>26<\/string>/);
  assert.equal((xcode.match(/CURRENT_PROJECT_VERSION = 26;/g) ?? []).length, 2);
  assert.equal((xcode.match(/MARKETING_VERSION = 1\.0\.20;/g) ?? []).length, 2);
  assert.equal(evidence.artifactsBuiltFromExactMerge, false);
  assert.equal(evidence.artifactsPublished, false);
  validateEvidence(evidence);
});

test("1.0.20 binds terminal reconciliation, automatic unlock and lease-current Dashboard refresh", () => {
  assert.match(nativeOutboxSource, /saveTerminalResolution\(record\)/);
  assert.match(nativeOutboxSource, /historyKey\(resolution\.account,resolution\.hash\)/);
  assert.match(nativeOutboxSource, /record\.phase==="done"\?record:this\.finalizeTerminal\(record\)/);
  assert.match(appSource, /if\(value&&value\.phase!=="done"\)/);
  assert.match(appSource, /current&&activeLease\.isCurrent\(\)/);
  assert.match(appSource, /recovered\?\.phase==="done"\)\{setError\(null\);onSentRef\.current\(\)\}/);
  assert.match(releaseNotes, /strictly verified successful native receipt \(`status=0x1`\)/);
  assert.match(releaseNotes, /releases the next transfer without a manual Done acknowledgement/);
  assert.match(releaseNotes, /Dashboard balance, nonce and activity immediately only when recovery actually moves an active outbox to `done` and its screen lease remains current/);
  assert.match(releaseNotes, /Pending, unknown, unsupported, memory-only, not-found or malformed results remain blocking/);
  assert.match(releaseNotes, /published 1\.0\.19 APK\/AAB[\s\S]*remain unchanged historical assets/);
  assert.equal(installedEvidence.schema, "ynx-wallet-android-installed-readonly/v1");
  assert.equal(installedEvidence.officialArtifact.versionCode, 25);
  assert.equal(installedEvidence.readOnlyChainValidation.networkPhaseTimeoutSeconds, 10);
  assert.equal(installedEvidence.readOnlyChainValidation.absoluteCallDeadlineSeconds, 15);
  assert.equal(installedEvidence.mutationBoundary.faucetRequests, 0);
  assert.equal(installedEvidence.mutationBoundary.transferBroadcasts, 0);
});

test("candidate evidence false states and source bindings cannot be widened", () => {
  for (const mutate of [
    (value) => { value.version = "1.0.19-testnet-preview"; },
    (value) => { value.versionCode = 25; },
    (value) => { value.baseCommit = "a".repeat(40); },
    (value) => { value.reconciliationImplementationCommits[0] = "b".repeat(40); },
    (value) => { value.releaseSourceCommit = "c".repeat(40); },
    (value) => { value.releaseTag = "invented"; },
    (value) => { value.artifactsBuiltFromExactMerge = true; },
    (value) => { value.artifactsPublished = true; },
    (value) => { value.productionSigned = true; },
    (value) => { value.storeReleased = true; },
    (value) => { value.walletConnectRelayE2E = "VERIFIED"; },
    (value) => { value.physicalAndroidDevice = "VERIFIED"; },
    (value) => { value.officialWebsiteUpdated = true; },
    (value) => { value.candidateBehavior.unknownOrNonterminalAllowsReplacement = true; },
    (value) => { value.candidateBehavior.automaticRebroadcast = true; },
  ]) {
    const copy = structuredClone(evidence);
    mutate(copy);
    assert.throws(() => validateEvidence(copy));
  }
});

test("1.0.17 publication binds exact merge, fresh-download digests and test-signing truth", () => {
  validatePublication(publication);
  validatePublicationEvidence(publicationEvidence, publication);
});

test("publication fails closed on asset, source, signature or external-verification tamper", () => {
  for (const mutate of [
    (value) => { value.sourceCommit = "a".repeat(40); },
    (value) => { value.schemaVersion = 2; },
    (value) => { value.productId = "other"; },
    (value) => { value.releaseTag += "-replacement"; },
    (value) => { value.releaseUrl += "-replacement"; },
    (value) => { value.publicationEvidence = "proof/other.json"; },
    (value) => { value.releaseImmutable = true; },
    (value) => { value.publisherCanReplaceAssets = false; },
    (value) => { value.productionSigned = true; },
    (value) => { value.storeReleased = true; },
    (value) => { value.walletConnectRelayE2E = "VERIFIED"; },
    (value) => { value.artifacts[0].sha256 = "0".repeat(64); },
    (value) => { value.artifacts[0].signingClass = "production-signed"; },
    (value) => { value.artifacts.push(structuredClone(value.artifacts[0])); },
    (value) => { value.artifacts[0].name = value.artifacts[1].name; },
    (value) => { value.artifacts[1].bytes += 1; },
    (value) => { value.artifacts[0].url = value.artifacts[0].url.replace("875f6c5b7", "replacement"); },
    (value) => { value.artifacts.find(({ name }) => name === "android-hermes").path = "attacker.hbc"; },
    (value) => { value.artifacts.find(({ name }) => name === "android-hermes").bytes += 1; },
    (value) => { value.artifacts.find(({ name }) => name === "android-hermes").sha256 = "0".repeat(64); },
    (value) => { value.artifacts.find(({ name }) => name === "ios-hermes").path = "attacker.hbc"; },
    (value) => { value.artifacts.find(({ name }) => name === "ios-hermes").signingClass = "signed"; },
  ]) {
    const copy = structuredClone(publication);
    mutate(copy);
    assert.throws(() => validatePublication(copy));
  }
});

test("publication evidence rejects release identity, asset pairing and timestamp tamper", () => {
  for (const mutate of [
    (value) => { value.schema = "ynx-wallet-mobile-preview-publication/v2"; },
    (value) => { value.releaseUrl += "-replacement"; },
    (value) => { value.githubReleaseId += 1; },
    (value) => { value.apkAssetId += 1; },
    (value) => { value.aabAssetId += 1; },
    (value) => { value.apk.url += ".replacement"; },
    (value) => { value.apk.bytes += 1; },
    (value) => { value.apk.sha256 = "0".repeat(64); },
    (value) => { value.aab.url += ".replacement"; },
    (value) => { value.aab.bytes += 1; },
    (value) => { value.aab.sha256 = "0".repeat(64); },
    (value) => { value.prerelease = false; },
    (value) => { value.releaseImmutable = true; },
    (value) => { value.publisherCanReplaceAssets = false; },
    (value) => { value.downloadTimeSha256Verified = false; },
    (value) => { value.apk.freshDownloadDigestMatched = false; },
    (value) => { value.apk.apkSignatureV2Verified = false; },
    (value) => { value.aab.freshDownloadDigestMatched = false; },
    (value) => { value.aab.jarSignatureVerified = false; },
    (value) => { value.signerCertificateDn = "CN=Production"; },
    (value) => { value.signerCertificateSha256 = "0".repeat(64); },
    (value) => { value.productionSigned = true; },
    (value) => { value.storeReleased = true; },
    (value) => { value.walletConnectRelayE2E = true; },
    (value) => { value.officialWebsiteUpdated = true; },
    (value) => { value.releaseCreatedAt = "2026-09-20T12:13:28.000Z"; },
    (value) => { value.releasePublishedAt = "2026-09-20T12:12:00Z"; },
    (value) => { value.generatedAt = "2999-01-01T00:00:00Z"; },
    (value) => { value.generatedAt = "2026-09-20T12:40:00Z"; },
    (value) => { value.emulator.upgradeInstall = "FAIL"; },
    (value) => { value.emulator.firstInstallTimePreserved = false; },
    (value) => { value.emulator.coldLaunch = "FAIL"; },
    (value) => { value.emulator.malformedDeepLink = "CRASH"; },
    (value) => { value.emulator.walletConnectDeepLinkWithoutProjectId = "CONNECTED"; },
    (value) => { value.emulator.crashBufferEmpty = false; },
    (value) => { value.recoveryContractTests.passed = 0; },
    (value) => { value.recoveryContractTests.failed = 56; },
    (value) => { value.recoveryContractTests.liveChainTransferExecuted = true; },
  ]) {
    const copy = structuredClone(publicationEvidence);
    mutate(copy);
    assert.throws(() => validatePublicationEvidence(copy, publication));
  }
});

test("candidate manifest fails closed when release truth or signing truth is tampered", () => {
  for (const mutate of [
    (value) => { value.versionCode = 22; },
    (value) => { value.releaseSourceCommit = "a".repeat(40); },
    (value) => { value.releaseTag = "invented"; },
    (value) => { value.publicArtifactUrls = ["https://invalid.local/fake.apk"]; },
    (value) => { value.productionSigned = true; },
    (value) => { value.storeReleased = true; },
    (value) => { value.walletConnectRelayE2E = "VERIFIED"; },
    (value) => { value.physicalDevice = "VERIFIED"; },
    (value) => { value.reconciliationBinding.mergedSource = "a".repeat(40); },
    (value) => { value.reconciliationBinding.coverage.pop(); },
    (value) => { value.generatedAt = new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"); },
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => validate(copy));
  }
});

test("the existing 1.0.19 download identity cannot be silently replaced", () => {
  for (const mutate of [
    (value) => { value.previousPublishedRelease.apk.sha256 = "0".repeat(64); },
    (value) => { value.previousPublishedRelease.apk.url += ".replacement"; },
    (value) => { value.previousPublishedRelease.aab.bytes += 1; },
    (value) => { value.previousPublishedRelease.tag = "wallet-android-testnet-preview-1.0.20"; },
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => validate(copy));
  }
});

function validate118Publication(value) {
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.productId, "wallet");
  assert.equal(value.version, "1.0.18-testnet-preview");
  assert.equal(value.versionCode, 24);
  assert.equal(value.releaseStatus, "PUBLISHED_TESTNET_PRERELEASE");
  assert.equal(value.sourceCommit, "2fdd679f9044a51e4facfa5b71b6e57864bb6508");
  assert.equal(value.releaseTag, "wallet-android-testnet-preview-1.0.18-2fdd679f9");
  assert.equal(value.releaseUrl, "https://github.com/JiahaoAlbus/YNX-Chain/releases/tag/wallet-android-testnet-preview-1.0.18-2fdd679f9");
  assert.equal(value.releaseImmutable, false);
  assert.equal(value.publisherCanReplaceAssets, true);
  assert.equal(value.downloadTimeSha256Verified, true);
  assert.equal(value.productionSigned, false);
  assert.equal(value.storeReleased, false);
  assert.equal(value.walletConnectRelayE2E, "NOT_VERIFIED");
  assert.equal(value.publicationEvidence, "proof/wallet-android-1.0.18-publication-20260921.json");
  const apk = value.artifacts.find(({ name }) => name === "android-release-apk");
  const aab = value.artifacts.find(({ name }) => name === "android-release-aab");
  const androidHermes = value.artifacts.find(({ name }) => name === "android-hermes");
  const iosHermes = value.artifacts.find(({ name }) => name === "ios-hermes");
  assert.equal(value.artifacts.length, 4);
  assert.equal(new Set(value.artifacts.map(({ name }) => name)).size, 4);
  assert.deepEqual(
    [apk.filename, apk.bytes, apk.sha256, apk.signingClass, apk.productionSigned, apk.versionCode],
    ["ynx-wallet-1.0.18-testnet-preview-2fdd679f9-universal-local-test-signed.apk", 116737714, "45fd5004c9156d4fb5880d9caa2056f5b2238e85ca63a13ddf73f25dea96266a", "local-test-signed", false, 24],
  );
  assert.deepEqual(
    [aab.filename, aab.bytes, aab.sha256, aab.signingClass, aab.productionSigned, aab.versionCode],
    ["ynx-wallet-1.0.18-testnet-preview-2fdd679f9-local-test-signed.aab", 71875238, "c6f920a00b8768c9ea8837bd35cfcee4b1b2c9106959c101c44026fa388c7850", "local-test-signed", false, 24],
  );
  assert.equal(apk.url, `${value.releaseUrl.replace("/tag/", "/download/")}/${apk.filename}`);
  assert.equal(aab.url, `${value.releaseUrl.replace("/tag/", "/download/")}/${aab.filename}`);
  assert.deepEqual(
    [androidHermes.path, androidHermes.bytes, androidHermes.sha256, androidHermes.signingClass],
    ["dist-android/_expo/static/js/android/index-e85451b1f7cfc20d5147c01a1fd120f6.hbc", 9406440, "ab69270e6bfe1f509a140dae775e6f7411e66920b2260bdb01fdb7be43a87b77", "unsigned-build-output"],
  );
  assert.deepEqual(
    [iosHermes.path, iosHermes.bytes, iosHermes.sha256, iosHermes.signingClass],
    ["dist-ios/_expo/static/js/ios/index-5ab8b8d9e3e6c4bdef2fea84874abf6a.hbc", 9401405, "fe62f30e3d8876717d778dbf6f8b86215aee92c517725aab5fbfe4978c95ada0", "unsigned-build-output"],
  );
  strictUtcSeconds(value.generatedAt);
}

function validate118PublicationEvidence(value, published) {
  assert.equal(value.schema, "ynx-wallet-mobile-preview-publication/v1");
  assert.equal(value.releaseTag, published.releaseTag);
  assert.equal(value.releaseUrl, published.releaseUrl);
  assert.equal(value.targetCommit, published.sourceCommit);
  assert.equal(value.prerelease, true);
  assert.equal(value.releaseImmutable, false);
  assert.equal(value.publisherCanReplaceAssets, true);
  assert.equal(value.downloadTimeSha256Verified, true);
  assert.equal(value.githubReleaseId, 392546625);
  assert.equal(value.apkAssetId, 577412914);
  assert.equal(value.aabAssetId, 577412911);
  const apk = published.artifacts.find(({ name }) => name === "android-release-apk");
  const aab = published.artifacts.find(({ name }) => name === "android-release-aab");
  assert.deepEqual([value.apk.url, value.apk.bytes, value.apk.sha256], [apk.url, apk.bytes, apk.sha256]);
  assert.deepEqual([value.aab.url, value.aab.bytes, value.aab.sha256], [aab.url, aab.bytes, aab.sha256]);
  assert.equal(value.apk.freshDownloadDigestMatched, true);
  assert.equal(value.apk.apkSignatureV2Verified, true);
  assert.equal(value.aab.freshDownloadDigestMatched, true);
  assert.equal(value.aab.jarSignatureVerified, true);
  assert.equal(value.signerCertificateDn, "C=US, O=Android, CN=Android Debug");
  assert.equal(value.signerCertificateSha256, "d4e562610ecb4e304fa00ee07e7adae7da862ce108bda7bdfe933c28831f154e");
  assert.deepEqual(value.reproducibility, {
    fixedAbsolutePathBuilds: 2,
    apkBitForBitMatched: true,
    aabBitForBitMatched: true,
    crossPathComparisonExcluded: true,
    crossPathReason: "Native build outputs embed the absolute worktree path.",
  });
  assert.deepEqual(value.emulator, {
    androidInstall: "NOT_VERIFIED",
    androidColdLaunch: "NOT_VERIFIED",
    iosSimulatorCiBuild: "PASS",
    physicalDevice: "NOT_VERIFIED",
  });
  assert.deepEqual(value.recoveryContractTests, { passed: 558, failed: 0, liveChainTransferExecuted: false });
  assert.equal(value.productionSigned, false);
  assert.equal(value.storeReleased, false);
  assert.equal(value.walletConnectRelayE2E, false);
  assert.equal(value.officialWebsiteUpdated, false);
  const created = strictUtcSeconds(value.releaseCreatedAt);
  const publishedAt = strictUtcSeconds(value.releasePublishedAt);
  const observed = strictUtcSeconds(value.generatedAt);
  assert.ok(publishedAt >= created);
  assert.ok(observed >= publishedAt);
  assert.equal(value.generatedAt, published.generatedAt);
}

test("1.0.18 publication binds exact source, fresh downloads and reproducible local-test-signed assets", () => {
  validate118Publication(publication118);
  validate118PublicationEvidence(publicationEvidence118, publication118);
});

test("1.0.18 publication rejects widened trust or changed release assets", () => {
  for (const mutate of [
    (value) => { value.sourceCommit = "a".repeat(40); },
    (value) => { value.releaseTag += "-replacement"; },
    (value) => { value.productionSigned = true; },
    (value) => { value.storeReleased = true; },
    (value) => { value.walletConnectRelayE2E = "VERIFIED"; },
    (value) => { value.artifacts[0].sha256 = "0".repeat(64); },
    (value) => { value.artifacts[1].bytes += 1; },
  ]) {
    const copy = structuredClone(publication118);
    mutate(copy);
    assert.throws(() => validate118Publication(copy));
  }
  for (const mutate of [
    (value) => { value.apkAssetId += 1; },
    (value) => { value.apk.freshDownloadDigestMatched = false; },
    (value) => { value.aab.jarSignatureVerified = false; },
    (value) => { value.reproducibility.apkBitForBitMatched = false; },
    (value) => { value.emulator.androidInstall = "PASS"; },
    (value) => { value.recoveryContractTests.liveChainTransferExecuted = true; },
    (value) => { value.officialWebsiteUpdated = true; },
  ]) {
    const copy = structuredClone(publicationEvidence118);
    mutate(copy);
    assert.throws(() => validate118PublicationEvidence(copy, publication118));
  }
});

function validate119Publication(value) {
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.productId, "wallet");
  assert.equal(value.version, "1.0.19-testnet-preview");
  assert.equal(value.versionCode, 25);
  assert.equal(value.releaseStatus, "PUBLISHED_TESTNET_PRERELEASE");
  assert.equal(value.sourceCommit, "d58ce00dc4e83f4c24747dfef7e0b59395d6b789");
  assert.equal(value.releaseTag, "wallet-android-testnet-preview-1.0.19-d58ce00dc");
  assert.equal(value.releaseUrl, "https://github.com/JiahaoAlbus/YNX-Chain/releases/tag/wallet-android-testnet-preview-1.0.19-d58ce00dc");
  assert.equal(value.releaseImmutable, false);
  assert.equal(value.publisherCanReplaceAssets, true);
  assert.equal(value.downloadTimeSha256Verified, true);
  assert.equal(value.productionSigned, false);
  assert.equal(value.storeReleased, false);
  assert.equal(value.walletConnectRelayE2E, "NOT_VERIFIED");
  assert.deepEqual(value.apkReproducibility, {
    rawGradleApkBitForBitMatched: false,
    rawGradleApkV2SignaturesMatched: true,
    rawGradleApkV2SignatureAlgorithmId: "0x0103",
    rawGradleApkV2SignatureAlgorithm: "RSA_PKCS1_V1_5_WITH_SHA256",
    differingBlockId: "0x504b4453",
    differingBlock: "APK Dependency Info",
    differingBlockContainedDifferentBuildHashes: true,
    resigningRemovedOrReplacedDependencyMetadata: true,
    rsaPssSaltNormalizationClaim: false,
    publishedApkBitForBitMatched: true,
  });
  assert.equal(value.publicationEvidence, "proof/wallet-android-1.0.19-publication-20260921.json");
  assert.equal(value.installedEvidence, "proof/wallet-android-1.0.19-installed-readonly-20260921.json");
  assert.deepEqual(value.artifacts.map(({ name }) => name).sort(), ["android-hermes", "android-release-aab", "android-release-apk", "ios-hermes"]);
  assert.equal(new Set(value.artifacts.map(({ name }) => name)).size, 4);
  const apk = value.artifacts.find(({ name }) => name === "android-release-apk");
  const aab = value.artifacts.find(({ name }) => name === "android-release-aab");
  assert.deepEqual(
    [apk.filename, apk.assetId, apk.bytes, apk.sha256, apk.signingClass, apk.productionSigned, apk.versionCode, apk.url],
    ["ynx-wallet-1.0.19-testnet-preview-d58ce00dc-universal-local-test-signed.apk", 577641202, 116639211, "437973258f40e4f7b3a2d3d603bbf67e932d1fca8082ed8eb9e8ff7b84514730", "local-test-signed", false, 25, `${value.releaseUrl.replace("/tag/", "/download/")}/ynx-wallet-1.0.19-testnet-preview-d58ce00dc-universal-local-test-signed.apk`],
  );
  assert.deepEqual(
    [aab.filename, aab.assetId, aab.bytes, aab.sha256, aab.signingClass, aab.productionSigned, aab.versionCode, aab.url],
    ["ynx-wallet-1.0.19-testnet-preview-d58ce00dc-local-test-signed.aab", 577641200, 71874951, "e60c165362ba5d85cf96e562800b5a1ef2f33812fff9eacd10745370bf114b7f", "local-test-signed", false, 25, `${value.releaseUrl.replace("/tag/", "/download/")}/ynx-wallet-1.0.19-testnet-preview-d58ce00dc-local-test-signed.aab`],
  );
  const androidHermes = value.artifacts.find(({ name }) => name === "android-hermes");
  const iosHermes = value.artifacts.find(({ name }) => name === "ios-hermes");
  assert.deepEqual([androidHermes.path, androidHermes.bytes, androidHermes.sha256, androidHermes.signingClass], ["dist-android/_expo/static/js/android/index-e85451b1f7cfc20d5147c01a1fd120f6.hbc", 9406440, "02f4a2ef13b2409c1bbe3a36d07bcc8b862675be83b012e66f1c38a65776186c", "unsigned-build-output"]);
  assert.deepEqual([iosHermes.path, iosHermes.bytes, iosHermes.sha256, iosHermes.signingClass], ["dist-ios/_expo/static/js/ios/index-5ab8b8d9e3e6c4bdef2fea84874abf6a.hbc", 9401406, "d44257418a16004fc7c02d8180915cc0cfcf9fabe205eb7d02c08c59dd50bf72", "unsigned-build-output"]);
  strictUtcSeconds(value.generatedAt);
}

function validate119PublicationEvidence(value, published) {
  assert.equal(value.schema, "ynx-wallet-mobile-preview-publication/v1");
  assert.equal(value.releaseTag, published.releaseTag);
  assert.equal(value.releaseUrl, published.releaseUrl);
  assert.equal(value.targetCommit, published.sourceCommit);
  assert.equal(value.prerelease, true);
  assert.equal(value.releaseImmutable, false);
  assert.equal(value.publisherCanReplaceAssets, true);
  assert.equal(value.downloadTimeSha256Verified, true);
  assert.equal(value.githubReleaseId, 392588529);
  assert.equal(value.apkAssetId, 577641202);
  assert.equal(value.aabAssetId, 577641200);
  const apk = published.artifacts.find(({ name }) => name === "android-release-apk");
  const aab = published.artifacts.find(({ name }) => name === "android-release-aab");
  assert.deepEqual([value.apk.url, value.apk.bytes, value.apk.sha256, value.apk.versionCode, value.apk.versionName], [apk.url, apk.bytes, apk.sha256, 25, "1.0.19-testnet-preview"]);
  assert.deepEqual([value.aab.url, value.aab.bytes, value.aab.sha256, value.aab.versionCode], [aab.url, aab.bytes, aab.sha256, 25]);
  assert.equal(value.apk.freshDownloadDigestMatched, true);
  assert.equal(value.apk.apkSignatureV2Verified, true);
  assert.equal(value.aab.freshDownloadDigestMatched, true);
  assert.equal(value.aab.jarSignatureVerified, true);
  assert.equal(value.signerCertificateDn, "C=US, O=Android, CN=Android Debug");
  assert.equal(value.signerCertificateSha256, "d4e562610ecb4e304fa00ee07e7adae7da862ce108bda7bdfe933c28831f154e");
  assert.deepEqual(value.reproducibility, {
    fixedAbsolutePath: "/private/tmp/ynx-wallet-1019-fixed-release",
    cleanWorktrees: 2,
    rawGradleApkBitForBitMatched: false,
    rawGradleApkV2SignaturesMatched: true,
    rawGradleApkV2SignatureAlgorithmId: "0x0103",
    rawGradleApkV2SignatureAlgorithm: "RSA_PKCS1_V1_5_WITH_SHA256",
    differingBlockId: "0x504b4453",
    differingBlock: "APK Dependency Info",
    differingBlockContainedDifferentBuildHashes: true,
    resigningRemovedOrReplacedDependencyMetadata: true,
    rsaPssSaltNormalizationClaim: false,
    publishedApkBitForBitMatched: true,
    aabBitForBitMatched: true,
    crossPathComparisonExcluded: true,
    crossPathReason: "Native build outputs embed the absolute worktree path.",
  });
  assert.deepEqual(value.installedValidation, {
    evidence: "proof/wallet-android-1.0.18-installed-faucet-transfer-20260921.json",
    networkPhaseTimeoutSeconds: 10,
    absoluteCallDeadlineSeconds: 15,
    automaticRetry: false,
    requestBodyReplay: false,
    faucetSubmitCount: 1,
    transferBroadcastCount: 1,
    transferRetryCount: 0,
    subsequentSendAvailable: true,
    mutationRepeatedFor1019: false,
  });
  assert.deepEqual(value.emulator, {
    androidInstall: "NOT_REPEATED_FOR_VERSION_ONLY_RELEASE",
    androidColdLaunch: "NOT_REPEATED_FOR_VERSION_ONLY_RELEASE",
    iosSimulatorCiBuild: "PASS",
    physicalDevice: "NOT_VERIFIED",
  });
  assert.deepEqual(value.recoveryContractTests, { passed: 558, failed: 0, nativeTransportPassed: 18, nativeTransportFailed: 0, liveChainTransferExecuted: false });
  assert.equal(value.productionSigned, false);
  assert.equal(value.storeReleased, false);
  assert.equal(value.walletConnectRelayE2E, false);
  assert.equal(value.officialWebsiteUpdated, false);
  const created = strictUtcSeconds(value.releaseCreatedAt);
  const publishedAt = strictUtcSeconds(value.releasePublishedAt);
  const observed = strictUtcSeconds(value.generatedAt);
  assert.ok(publishedAt >= created);
  assert.ok(observed >= publishedAt);
  assert.equal(value.generatedAt, published.generatedAt);
}

test("1.0.19 publication binds exact source, fresh downloads, installed recovery and reproducible local-test-signed assets", () => {
  validate119Publication(publication119);
  validate119PublicationEvidence(publicationEvidence119, publication119);
});

test("1.0.19 publication rejects changed assets, widened trust or repeated mutations", () => {
  for (const mutate of [
    (value) => { value.sourceCommit = "a".repeat(40); },
    (value) => { value.releaseTag += "-replacement"; },
    (value) => { value.productionSigned = true; },
    (value) => { value.storeReleased = true; },
    (value) => { value.walletConnectRelayE2E = "VERIFIED"; },
    (value) => { value.apkReproducibility.rawGradleApkV2SignaturesMatched = false; },
    (value) => { value.apkReproducibility.rsaPssSaltNormalizationClaim = true; },
    (value) => { value.artifacts[0].assetId += 1; },
    (value) => { value.artifacts[0].sha256 = "0".repeat(64); },
    (value) => { value.artifacts[1].bytes += 1; },
  ]) {
    const copy = structuredClone(publication119);
    mutate(copy);
    assert.throws(() => validate119Publication(copy));
  }
  for (const mutate of [
    (value) => { value.apkAssetId += 1; },
    (value) => { value.apk.freshDownloadDigestMatched = false; },
    (value) => { value.apk.versionCode = 24; },
    (value) => { value.aab.jarSignatureVerified = false; },
    (value) => { value.reproducibility.rawGradleApkV2SignaturesMatched = false; },
    (value) => { value.reproducibility.rawGradleApkV2SignatureAlgorithmId = "0x0101"; },
    (value) => { value.reproducibility.differingBlockId = "0x00000000"; },
    (value) => { value.reproducibility.rsaPssSaltNormalizationClaim = true; },
    (value) => { value.reproducibility.publishedApkBitForBitMatched = false; },
    (value) => { value.installedValidation.networkPhaseTimeoutSeconds = 5; },
    (value) => { value.installedValidation.mutationRepeatedFor1019 = true; },
    (value) => { value.emulator.physicalDevice = "PASS"; },
    (value) => { value.recoveryContractTests.liveChainTransferExecuted = true; },
    (value) => { value.officialWebsiteUpdated = true; },
  ]) {
    const copy = structuredClone(publicationEvidence119);
    mutate(copy);
    assert.throws(() => validate119PublicationEvidence(copy, publication119));
  }
});

function validate119InstalledEvidence(value, published) {
  assert.equal(value.schema, "ynx-wallet-android-installed-readonly/v1");
  assert.equal(value.evidenceBaseCommit, "cdb9bd25cdef9524c7c869d1110f4ce0b7d8cd91");
  const apk = published.artifacts.find(({ name }) => name === "android-release-apk");
  assert.deepEqual(value.officialArtifact, {
    releaseTag: published.releaseTag,
    releaseSourceCommit: published.sourceCommit,
    assetId: apk.assetId,
    filename: apk.filename,
    sha256: apk.sha256,
    bytes: apk.bytes,
    package: "com.ynxweb4.wallet",
    activity: "com.ynxweb4.wallet/.MainActivity",
    versionCode: 25,
    versionName: "1.0.19-testnet-preview",
    signingClass: "local-test-signed",
    productionSigned: false,
  });
  assert.deepEqual(value.emulator, {
    avd: "YNX_WALLET_1019_20260921_QA",
    serial: "emulator-5554",
    api: 36,
    abi: "arm64-v8a",
    freshAvd: true,
    freshApplicationData: true,
  });
  assert.deepEqual(value.installedFlow, {
    firstColdLaunchMillis: 621,
    disposableRandomRecoveryMaterial: true,
    recoveryMaterialPrinted: false,
    recoveryMaterialRetained: false,
    strongBiometricConfigured: true,
    accountImportedToSecureStorage: true,
    postImportState: "LOCKED",
    biometricUnlock: "PASS",
    explicitLock: "PASS",
    coldRestartRestoredAccountLocked: true,
    lockedAccountColdLaunchMillis: 437,
    finalLockedColdLaunchMillis: 529,
    applicationCrashEntriesAfterFinalColdLaunch: 0,
  });
  assert.deepEqual(value.readOnlyChainValidation, {
    chain: "ynx_6423-1",
    chainQuantity: "0x1917",
    networkPhaseTimeoutSeconds: 10,
    absoluteCallDeadlineSeconds: 15,
    biometricToSettledResultMillis: 9848,
    result: "NO_ON_CHAIN_ACCOUNT_RECORD",
    balance: "UNAVAILABLE_NOT_INVENTED",
    nonce: "UNAVAILABLE_NOT_INVENTED",
    sendEligibility: "BLOCKED_UNTIL_BALANCE_AND_NONCE_CONFIRMED",
    readOnlyRequestCompletedWithinPhaseAndAbsoluteDeadlines: true,
  });
  assert.deepEqual(value.mutationBoundary, {
    faucetRequests: 0,
    transferBroadcasts: 0,
    walletConnectRelayContacts: 0,
    publicServiceMutations: 0,
  });
  assert.deepEqual(value.sanitization, {
    rawUiTreesRetained: false,
    rawSystemLogsRetained: false,
    screenshotsRetained: false,
    recoveryMaterialRetained: false,
    lockCredentialRetained: false,
    accountAddressRecorded: false,
    onlyAllowlistedEvidenceCommitted: true,
    lockedAfterImportUiSha256: "70fe2a77f68b9774872ba5dce0c1abc07e43ab62136cd864b1e125c47353cc02",
    readOnlyResultUiSha256: "600f8825868395855a76e8e8e09565c4c7e71c59e4fd4641c4f7f874bf70cd7d",
    finalColdLockedUiSha256: "8bc8ae6f59e17112c086be3089bb69cd18322faeb2442a3e2434f109d87ec7a1",
  });
  assert.deepEqual(value.notVerified, [
    "funded-account balance and nonce",
    "Faucet request",
    "transfer broadcast or recovery",
    "WalletConnect Relay interoperability",
    "physical Android device",
    "production signing",
    "app-store publication",
    "Finance integration",
  ]);
  strictUtcSeconds(value.testedAt);
}

test("installed 1.0.19 binds fresh APK identity, locked recovery and bounded read-only Testnet behavior", () => {
  validate119InstalledEvidence(installedEvidence119, publication119);
});

test("installed 1.0.19 evidence rejects secrets, mutations and unsupported verification promotion", () => {
  for (const mutate of [
    (value) => { value.officialArtifact.sha256 = "0".repeat(64); },
    (value) => { value.officialArtifact.versionCode = 24; },
    (value) => { value.officialArtifact.productionSigned = true; },
    (value) => { value.emulator.freshAvd = false; },
    (value) => { value.installedFlow.recoveryMaterialPrinted = true; },
    (value) => { value.installedFlow.recoveryMaterialRetained = true; },
    (value) => { value.installedFlow.coldRestartRestoredAccountLocked = false; },
    (value) => { value.readOnlyChainValidation.networkPhaseTimeoutSeconds = 5; },
    (value) => { value.readOnlyChainValidation.biometricToSettledResultMillis = 15001; },
    (value) => { value.readOnlyChainValidation.balance = "0 YNXT"; },
    (value) => { value.mutationBoundary.faucetRequests = 1; },
    (value) => { value.mutationBoundary.transferBroadcasts = 1; },
    (value) => { value.mutationBoundary.walletConnectRelayContacts = 1; },
    (value) => { value.sanitization.rawSystemLogsRetained = true; },
    (value) => { value.notVerified = value.notVerified.filter(item => item !== "physical Android device"); },
  ]) {
    const copy = structuredClone(installedEvidence119);
    mutate(copy);
    assert.throws(() => validate119InstalledEvidence(copy, publication119));
  }
});
