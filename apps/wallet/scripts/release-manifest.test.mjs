import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const walletRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("artifact-manifest.json", walletRoot), "utf8"));
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
  assert.equal(candidate.previousPublishedRelease.tag, previous.tag);
  assert.deepEqual(candidate.previousPublishedRelease.apk, previous.apk);
  assert.deepEqual(candidate.previousPublishedRelease.aab, previous.aab);
  assert.match(candidate.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const generatedAt = Date.parse(candidate.generatedAt);
  assert.equal(Number.isFinite(generatedAt), true);
  assert.ok(generatedAt <= Date.now(), "generatedAt must not claim a future observation");
}

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
  assert.equal(evidence.generatedAt, manifest.generatedAt);
  assert.ok(Date.parse(evidence.generatedAt) <= Date.now());
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
