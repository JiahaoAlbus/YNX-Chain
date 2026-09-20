import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const walletRoot = new URL("../", import.meta.url);
const publishedManifest = JSON.parse(await readFile(new URL("artifact-manifest.json", walletRoot), "utf8"));
const manifest = JSON.parse(await readFile(new URL("artifact-candidate-1.0.17.json", walletRoot), "utf8"));
const publication = JSON.parse(await readFile(new URL("artifact-publication-1.0.17.json", walletRoot), "utf8"));
const app = JSON.parse(await readFile(new URL("app.json", walletRoot), "utf8")).expo;
const android = await readFile(new URL("android/app/build.gradle", walletRoot), "utf8");
const plist = await readFile(new URL("ios/YNXWallet/Info.plist", walletRoot), "utf8");
const xcode = await readFile(new URL("ios/YNXWallet.xcodeproj/project.pbxproj", walletRoot), "utf8");
const evidence = JSON.parse(await readFile(new URL(manifest.candidateEvidence, walletRoot), "utf8"));
const publicationEvidence = JSON.parse(await readFile(new URL(publication.publicationEvidence, walletRoot), "utf8"));

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
  assert.equal(candidate.version, "1.0.17-testnet-preview");
  assert.equal(candidate.versionCode, 23);
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
  assert.equal(candidate.recoveryBinding.implementationCommit, "2b4f57c49c9ab7f9fb8536a33b5f90ccabecfd23");
  assert.equal(candidate.recoveryBinding.mergedFeatureSource, "3a41494419b5c328638fb0b2a7e607cb38ba50e9");
  assert.equal(candidate.previousPublishedRelease.version, "1.0.16-testnet-preview");
  assert.equal(candidate.previousPublishedRelease.versionCode, 22);
  assert.equal(candidate.previousPublishedRelease.tag, previous.tag);
  assert.equal(candidate.previousPublishedRelease.releaseImmutable, false);
  assert.equal(candidate.previousPublishedRelease.publisherCanReplaceAssets, true);
  assert.deepEqual(candidate.previousPublishedRelease.apk, previous.apk);
  assert.deepEqual(candidate.previousPublishedRelease.aab, previous.aab);
  assert.match(candidate.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const generatedAt = Date.parse(candidate.generatedAt);
  assert.equal(Number.isFinite(generatedAt), true);
  assert.ok(generatedAt <= Date.now(), "generatedAt must not claim a future observation");
}

function validateEvidence(value) {
  assert.equal(value.version, "1.0.17-testnet-preview");
  assert.equal(value.versionCode, 23);
  assert.equal(value.baseCommit, "3a41494419b5c328638fb0b2a7e607cb38ba50e9");
  assert.equal(value.recoveryImplementationCommit, "2b4f57c49c9ab7f9fb8536a33b5f90ccabecfd23");
  assert.equal(value.releaseSourceCommit, null);
  assert.equal(value.releaseTag, null);
  assert.equal(value.artifactsBuiltFromExactMerge, false);
  assert.equal(value.artifactsPublished, false);
  assert.equal(value.productionSigned, false);
  assert.equal(value.storeReleased, false);
  assert.equal(value.walletConnectRelayE2E, "NOT_VERIFIED");
  assert.equal(value.previousReleasePreserved.tag, previous.tag);
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
  const apk = value.artifacts.find(({ name }) => name === "android-release-apk");
  const aab = value.artifacts.find(({ name }) => name === "android-release-aab");
  assert.deepEqual(
    { bytes: apk.bytes, sha256: apk.sha256, productionSigned: apk.productionSigned, versionCode: apk.versionCode },
    { bytes: published117.apk.bytes, sha256: published117.apk.sha256, productionSigned: false, versionCode: 23 },
  );
  assert.deepEqual(
    { bytes: aab.bytes, sha256: aab.sha256, productionSigned: aab.productionSigned, versionCode: aab.versionCode },
    { bytes: published117.aab.bytes, sha256: published117.aab.sha256, productionSigned: false, versionCode: 23 },
  );
  assert.equal(apk.filename, published117.apk.filename);
  assert.equal(apk.url, published117.apk.url);
  assert.equal(aab.filename, published117.aab.filename);
  assert.equal(aab.url, published117.aab.url);
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
  assert.equal(value.officialWebsiteUpdated, false);
  assert.equal(value.generatedAt, published.generatedAt);
  const created = strictUtcSeconds(value.releaseCreatedAt);
  const publishedAt = strictUtcSeconds(value.releasePublishedAt);
  const observed = strictUtcSeconds(value.generatedAt);
  assert.ok(created >= Date.parse("2026-09-20T12:13:28Z"));
  assert.ok(publishedAt >= created);
  assert.ok(observed >= publishedAt);
  assert.ok(observed - publishedAt <= 10 * 60_000, "capture must remain close to publication");
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

test("1.0.17 source candidate binds native versions and recovery source without inventing a release", () => {
  validate(manifest);
  assert.equal(app.version, "1.0.17");
  assert.equal(app.android.versionCode, 23);
  assert.equal(app.ios.buildNumber, "23");
  assert.match(android, /versionCode 23\n\s*versionName "1\.0\.17-testnet-preview"/);
  assert.match(plist, /CFBundleShortVersionString<\/key>\s*<string>1\.0\.17<\/string>/);
  assert.match(plist, /CFBundleVersion<\/key>\s*<string>23<\/string>/);
  assert.equal((xcode.match(/CURRENT_PROJECT_VERSION = 23;/g) ?? []).length, 2);
  assert.equal((xcode.match(/MARKETING_VERSION = 1\.0\.17;/g) ?? []).length, 2);
  assert.equal(evidence.artifactsBuiltFromExactMerge, false);
  assert.equal(evidence.artifactsPublished, false);
  validateEvidence(evidence);
});

test("candidate evidence false states and source bindings cannot be widened", () => {
  for (const mutate of [
    (value) => { value.version = "1.0.16-testnet-preview"; },
    (value) => { value.versionCode = 22; },
    (value) => { value.baseCommit = "a".repeat(40); },
    (value) => { value.recoveryImplementationCommit = "b".repeat(40); },
    (value) => { value.releaseSourceCommit = "c".repeat(40); },
    (value) => { value.releaseTag = "invented"; },
    (value) => { value.artifactsBuiltFromExactMerge = true; },
    (value) => { value.artifactsPublished = true; },
    (value) => { value.productionSigned = true; },
    (value) => { value.storeReleased = true; },
    (value) => { value.walletConnectRelayE2E = "VERIFIED"; },
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
    (value) => { value.releaseImmutable = true; },
    (value) => { value.publisherCanReplaceAssets = false; },
    (value) => { value.productionSigned = true; },
    (value) => { value.storeReleased = true; },
    (value) => { value.walletConnectRelayE2E = "VERIFIED"; },
    (value) => { value.artifacts[0].sha256 = "0".repeat(64); },
    (value) => { value.artifacts[1].bytes += 1; },
    (value) => { value.artifacts[0].url = value.artifacts[0].url.replace("875f6c5b7", "replacement"); },
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
    (value) => { value.releaseCreatedAt = "2026-09-20T12:13:28.000Z"; },
    (value) => { value.releasePublishedAt = "2026-09-20T12:12:00Z"; },
    (value) => { value.generatedAt = "2999-01-01T00:00:00Z"; },
    (value) => { value.generatedAt = "2026-09-20T12:40:00Z"; },
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
    (value) => { value.generatedAt = new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"); },
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => validate(copy));
  }
});

test("the existing 1.0.16 download identity cannot be silently replaced", () => {
  for (const mutate of [
    (value) => { value.previousPublishedRelease.apk.sha256 = "0".repeat(64); },
    (value) => { value.previousPublishedRelease.apk.url += ".replacement"; },
    (value) => { value.previousPublishedRelease.aab.bytes += 1; },
    (value) => { value.previousPublishedRelease.tag = "wallet-android-testnet-preview-1.0.17"; },
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => validate(copy));
  }
});
