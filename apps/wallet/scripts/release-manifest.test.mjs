import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const walletRoot = new URL("../", import.meta.url);
const publishedManifest = JSON.parse(await readFile(new URL("artifact-manifest.json", walletRoot), "utf8"));
const manifest = JSON.parse(await readFile(new URL("artifact-candidate-1.0.17.json", walletRoot), "utf8"));
const app = JSON.parse(await readFile(new URL("app.json", walletRoot), "utf8")).expo;
const android = await readFile(new URL("android/app/build.gradle", walletRoot), "utf8");
const plist = await readFile(new URL("ios/YNXWallet/Info.plist", walletRoot), "utf8");
const xcode = await readFile(new URL("ios/YNXWallet.xcodeproj/project.pbxproj", walletRoot), "utf8");
const evidence = JSON.parse(await readFile(new URL(manifest.candidateEvidence, walletRoot), "utf8"));

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
