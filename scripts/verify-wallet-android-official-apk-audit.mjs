import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";

const evidenceUrl = new URL("../docs/integration/wallet-android-official-apk-deeplink-audit-20260815.json", import.meta.url);
const evidence = JSON.parse(await readFile(evidenceUrl, "utf8"));
const current = evidence.currentOfficialDownload;
const candidate = evidence.androidOwnerCandidate;
const binary = current.finalBinaryManifest;
const gates = evidence.releaseGates;

assert.equal(current.fullBodyDownloaded, true);
assert.equal(current.bytes, 78313394);
assert.equal(current.sha256, "68d7cec948a7bf8ab1e0b7f34ddbd45e6f0cc91d7ca59d780134679470f8b746");
assert.equal(current.package, "com.ynxweb4.wallet");
assert.equal(current.versionName, "1.0.0");
assert.equal(current.versionCode, 1);
assert.equal(binary.mainActivity, "com.ynxweb4.wallet.MainActivity");
assert.equal(binary.exported, true);
assert.equal(binary.view, true);
assert.equal(binary.defaultCategory, true);
assert.equal(binary.browsableCategory, true);
assert.equal(binary.scheme, "ynxwallet");
assert.equal(binary.authorizeHost, true);

assert.equal(candidate.sourceCommit, "4a34fd3ec7fd7cda7b5e5f541e0b8944077da8d8");
assert.equal(candidate.expectedBytes, 78392878);
assert.equal(candidate.expectedSha256, "fd924ef853cf17d42ca2d36504528ef879c73fcb4b01ea72b1bfe7ae85085fef");
assert.deepEqual(candidate.sourceManifest.hosts, ["authorize", "action", "open"]);
assert.equal(candidate.exactApkDownloadedThisAudit, false);
assert.equal(candidate.exactApkBinaryManifestCompared, false);

assert.equal(evidence.comparison.currentOfficialIsOwnerCandidate, false);
assert.equal(evidence.comparison.sameSigningCertificate, false);
assert.equal(evidence.comparison.inPlaceUpgradeCompatible, false);
assert.equal(evidence.comparison.missingManifestFilterExplainsReportedFailure, false);
assert.equal(evidence.comparison.authorizeRuntimeRootCauseEstablished, false);
assert.equal(evidence.runtimeEvidence.socialToWalletAuthorizeOnPhysicalDeviceTested, false);
assert.ok(Object.values(gates).every((value) => value === false));

const apkFlag = process.argv.indexOf("--apk");
if (apkFlag !== -1) {
  const apkPath = process.argv[apkFlag + 1];
  assert.ok(apkPath, "--apk requires a path");
  const apkStat = await stat(apkPath);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(apkPath)) digest.update(chunk);
  assert.equal(apkStat.size, current.bytes, "official APK byte count drifted");
  assert.equal(digest.digest("hex"), current.sha256, "official APK SHA-256 drifted");

  const apkanalyzer = process.env.APKANALYZER ?? "apkanalyzer";
  const aapt = process.env.AAPT ?? "aapt";
  const apksigner = process.env.APKSIGNER ?? "apksigner";
  const manifest = execFileSync(apkanalyzer, ["manifest", "print", apkPath], { encoding: "utf8" });
  const badging = execFileSync(aapt, ["dump", "badging", apkPath], { encoding: "utf8" });
  const signing = execFileSync(apksigner, ["verify", "--verbose", "--print-certs", apkPath], { encoding: "utf8" });

  assert.match(badging, /package: name='com\.ynxweb4\.wallet' versionCode='1' versionName='1\.0\.0'/);
  assert.match(badging, /sdkVersion:'24'/);
  assert.match(manifest, /android:name="com\.ynxweb4\.wallet\.MainActivity"/);
  assert.match(manifest, /android:exported="true"/);
  assert.match(manifest, /android:name="android\.intent\.action\.VIEW"/);
  assert.match(manifest, /android:name="android\.intent\.category\.DEFAULT"/);
  assert.match(manifest, /android:name="android\.intent\.category\.BROWSABLE"/);
  assert.match(manifest, /android:scheme="ynxwallet"/);
  assert.match(manifest, /android:host="authorize"/);
  assert.match(signing, /Verified using v2 scheme \(APK Signature Scheme v2\): true/);
  assert.match(signing, /Signer #1 certificate SHA-256 digest: a89481de707c02567a7fce786ac4db03bbd92c9fe168b571cc48b0a4b7b439f3/);
}

console.log("wallet Android official APK audit: PASS (release gates remain fail-closed)");
