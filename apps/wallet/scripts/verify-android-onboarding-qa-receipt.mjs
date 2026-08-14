#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const pending = process.argv[2] === "--pending";
const receiptPath = pending ? process.argv[3] : process.argv[2];
if (!receiptPath || !path.isAbsolute(receiptPath)) fail("usage: verify-android-onboarding-qa-receipt.mjs [--pending] /absolute/receipt.json");
const receipt = await json(receiptPath);
exact(receipt, ["schemaVersion", "evidenceType", "sourceCommit", "package", "artifact", "environment", "checks", "observations", "rawEvidence", "releaseStates", "invariants"], "receipt");
assert(receipt.schemaVersion === 1 && receipt.evidenceType === "wallet-android-onboarding-security-qa", "receipt identity mismatch");
assert(receipt.package === "com.ynxweb4.wallet", "package mismatch");
const checkNames = ["create", "import", "recover", "duplicateImportRejected", "multiAccountSwitch", "backgroundLock", "onboardingSecretDismissed", "strongBiometricUnlock", "biometricFailureDenied", "rtl", "dark", "largeText", "validDeepLinkReview", "tamperedDeepLinkRejected", "wrongCallbackRejected", "callbackRoundTrip", "authoritativeDataFailClosed"];
exact(receipt.checks, checkNames, "checks");
exact(receipt.artifact, ["path", "manifestPath", "sha256", "bytes", "signingClass"], "artifact");
exact(receipt.environment, ["serial", "apiLevel", "androidRelease", "abi"], "environment");
exact(receipt.observations, ["accountCount", "fontScale", "locale", "uiMode", "callbackRequestDigest"], "observations");
exact(receipt.releaseStates, ["testedOnDevice", "installedLocal", "productionSigned", "storeReleased", "deployedPublic", "downloadHosted"], "releaseStates");
exact(receipt.invariants, ["secretMaterialRecorded", "realUserMaterialUsed", "productSessionsRestoredByRecovery", "fakeBalanceObserved", "fakeTransactionObserved", "fakeSignatureObserved", "fakeProviderObserved", "fakeSuccessObserved"], "invariants");
for (const [key, value] of Object.entries(receipt.invariants)) assert(value === false, `${key} must remain false`);
assert(receipt.releaseStates.productionSigned === false && receipt.releaseStates.storeReleased === false && receipt.releaseStates.deployedPublic === false && receipt.releaseStates.downloadHosted === false, "release boundary widened");

if (pending) {
  assert(receipt.sourceCommit === "0".repeat(40), "pending source commit must be unknown");
  assert(Object.values(receipt.checks).every((value) => value === false), "pending checks must all be false");
  assert(receipt.releaseStates.testedOnDevice === false && receipt.releaseStates.installedLocal === false, "pending device states must be false");
  assert(receipt.rawEvidence.length === 0, "pending receipt cannot claim raw evidence");
  console.log(JSON.stringify({ verifiedPending: true, deviceClaims: false, secretMaterialRecorded: false }, null, 2));
  process.exit(0);
}

assert(/^[0-9a-f]{40}$/.test(receipt.sourceCommit) && receipt.sourceCommit !== "0".repeat(40), "source commit missing");
assert(Object.values(receipt.checks).every((value) => value === true), "every device check must pass");
assert(receipt.releaseStates.testedOnDevice === true && receipt.releaseStates.installedLocal === true, "device state not established");
assert(path.isAbsolute(receipt.artifact.path) && /^[0-9a-f]{64}$/.test(receipt.artifact.sha256) && Number.isSafeInteger(receipt.artifact.bytes) && receipt.artifact.bytes > 0, "artifact identity invalid");
assert(path.isAbsolute(receipt.artifact.manifestPath), "artifact manifest path must be absolute");
assert(receipt.artifact.signingClass === "disposable-qa-release-key", "only disposable QA signing is accepted by this receipt");
const apk = await readFile(receipt.artifact.path), apkInfo = await stat(receipt.artifact.path);
assert(apkInfo.size === receipt.artifact.bytes && sha(apk) === receipt.artifact.sha256, "artifact digest or bytes mismatch");
const buildManifest = await json(receipt.artifact.manifestPath);
assert(buildManifest.sourceCommit === receipt.sourceCommit && buildManifest.package === receipt.package, "artifact manifest source/package mismatch");
assert(buildManifest.apk?.sha256 === receipt.artifact.sha256 && buildManifest.apk?.bytes === receipt.artifact.bytes && buildManifest.signingClass === receipt.artifact.signingClass, "artifact manifest APK/signing mismatch");
assert(receipt.environment.apiLevel === 36 && receipt.environment.androidRelease === 16 && receipt.environment.abi === "arm64-v8a" && /^emulator-\d+$/.test(receipt.environment.serial), "API 36 environment mismatch");
assert(Number.isSafeInteger(receipt.observations.accountCount) && receipt.observations.accountCount >= 3, "three account paths were not observed");
assert(typeof receipt.observations.fontScale === "number" && receipt.observations.fontScale >= 1.3, "large text font scale was not observed");
assert(receipt.observations.locale === "ar" && receipt.observations.uiMode === "dark", "RTL/dark observation mismatch");
assert(/^[0-9a-f]{64}$/.test(receipt.observations.callbackRequestDigest), "callback request digest missing");
const requiredLabels = new Set(["create-locked-tree", "import-biometric-tree", "duplicate-rejected-tree", "recover-boundary-tree", "multi-account-tree", "background-resume-tree", "biometric-denied-tree", "biometric-unlocked-tree", "rtl-dark-tree", "large-text-tree", "valid-deeplink-review-tree", "tampered-deeplink-rejection-tree", "wrong-callback-rejection-tree", "callback-harness-tree", "authoritative-data-tree", "pid-scoped-log", "window-state"]);
assert(Array.isArray(receipt.rawEvidence), "rawEvidence must be an array");
for (const item of receipt.rawEvidence) {
  exact(item, ["label", "path", "sha256", "bytes"], "raw evidence item");
  assert(requiredLabels.delete(item.label), `unexpected or duplicate raw evidence label: ${item.label}`);
  assert(path.isAbsolute(item.path) && /^[0-9a-f]{64}$/.test(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes > 0, "raw evidence identity invalid");
  const body = await readFile(item.path), info = await stat(item.path);
  assert(info.isFile() && info.size === item.bytes && sha(body) === item.sha256, `raw evidence mismatch: ${item.label}`);
  if (/\.(?:xml|txt|log|json)$/i.test(item.path)) assertSecretFree(body.toString("utf8"), item.label, item.path);
}
assert(requiredLabels.size === 0, `missing raw evidence: ${[...requiredLabels].join(", ")}`);
console.log(JSON.stringify({ verified: true, sourceCommit: receipt.sourceCommit, testedOnDevice: true, installedLocal: true, onboarding: true, multiAccount: true, backgroundLock: true, biometric: true, rtl: true, dark: true, largeText: true, callback: true, productionSigned: false, storeReleased: false, deployedPublic: false, secretMaterialRecorded: false }, null, 2));

function assertSecretFree(value, label, file) {
  assert(!/(?:text|content-desc)="\s*[0-9a-fA-F]{64}\s*"/.test(value), `${label} contains recovery material in a UI attribute`);
  assert(!/\b(?:secretHex|accountSecret|mnemonic)\b/i.test(value), `${label} contains a forbidden secret field name`);
  if (/\.(?:txt|log)$/i.test(file)) assert(!/(?:^|[^0-9a-fA-F])[0-9a-fA-F]{64}(?:$|[^0-9a-fA-F])/m.test(value), `${label} contains unclassified 32-byte hex material`);
}
async function json(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch { fail(`invalid JSON: ${file}`); } }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); assert(Object.keys(value).sort().join("\n") === [...keys].sort().join("\n"), `${label} fields mismatch`); }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function assert(condition, message) { if (!condition) fail(message); }
function fail(message) { console.error(`Wallet Android onboarding QA receipt rejected: ${message}`); process.exit(1); }
