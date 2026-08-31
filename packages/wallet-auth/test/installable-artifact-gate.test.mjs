import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { INSTALLABLE_ARTIFACT_GATE_VERSION, verifyInstallableArtifactReleaseManifest, WalletAuthError } from "../src/index.js";

const SHA = "a".repeat(64);
function entry(platform, format, overrides = {}) {
  return {
    productId: `wallet-${platform}`,
    platform,
    format,
    distribution: platform === "android" && format === "aab" ? "store-upload" : "direct-download",
    downloadUrl: `https://www.ynxweb4.com/download/wallet.${format}`,
    sha256: SHA,
    version: "1.0.0-testnet",
    signingStatus: "test-signed",
    signing: { status: "test-signed", identity: "explicit test signing identity" },
    evidence: { install: true, coldLaunch: true, secondLaunch: true, network: true, versionReadback: "1.0.0-testnet", sha256Readback: SHA, rollback: true, ...(platform === "macos" ? { mountedDmg: true, appBundleLaunches: 2 } : {}) },
    ...overrides,
  };
}

test("DMG, EXE/MSIX, APK/AAB and Web/PWA boundaries are executable", () => {
  const manifest = verifyInstallableArtifactReleaseManifest({ version: INSTALLABLE_ARTIFACT_GATE_VERSION, entries: [
    entry("macos", "dmg"), entry("windows", "exe"), entry("android", "apk"), entry("android", "aab", { productId: "wallet-android-store" }),
    { productId: "wallet-web", platform: "web-pwa", format: "web-pwa", distribution: "web", downloadUrl: null, sha256: null, version: "1.0.0-testnet", signingStatus: "not-applicable", signing: null, evidence: null, installVerified: false },
  ] });
  assert.equal(manifest.publishable, true);
  assert.equal(manifest.entries.length, 5);
});

test("ZIP and incomplete launch/network/signing evidence can never restore an official link", () => {
  assert.throws(() => verifyInstallableArtifactReleaseManifest({ version: INSTALLABLE_ARTIFACT_GATE_VERSION, entries: [entry("macos", "zip")] }), code("NON_INSTALLABLE_ARCHIVE"));
  assert.throws(() => verifyInstallableArtifactReleaseManifest({ version: INSTALLABLE_ARTIFACT_GATE_VERSION, entries: [entry("windows", "exe", { evidence: { install: true, coldLaunch: true, secondLaunch: false, network: true, versionReadback: "1.0.0-testnet", sha256Readback: SHA, rollback: true } })] }), code("INSTALLER_EVIDENCE_INCOMPLETE"));
  assert.throws(() => verifyInstallableArtifactReleaseManifest({ version: INSTALLABLE_ARTIFACT_GATE_VERSION, entries: [entry("android", "aab", { distribution: "direct-download" })] }), code("ANDROID_AAB_NOT_DIRECT_INSTALL"));
});

test("Web/PWA-only products cannot be disguised as desktop packages", () => {
  assert.throws(() => verifyInstallableArtifactReleaseManifest({ version: INSTALLABLE_ARTIFACT_GATE_VERSION, entries: [{ productId:"web-only", platform:"web-pwa", format:"zip", downloadUrl:"https://www.ynxweb4.com/web.zip", sha256:SHA, signingStatus:"unsigned", installVerified:false }] }), code("WEB_PWA_MISREPRESENTED"));
});

test("frozen installation contract keeps every unsupported release state false", () => {
  const contract = JSON.parse(readFileSync(new URL("../integration/installable-wallet-artifact-gate-v1.json", import.meta.url), "utf8"));
  assert.equal(contract.contract, INSTALLABLE_ARTIFACT_GATE_VERSION);
  assert.deepEqual(contract.formats.macos.allowed, ["dmg"]);
  assert.deepEqual(contract.formats.windows.allowed, ["exe", "msix"]);
  assert.deepEqual(contract.formats.android.allowed, ["apk", "aab"]);
  assert.equal(contract.formats["web-pwa"].downloadArtifact, false);
  assert.equal(contract.currentTruth.officialInstallerEntriesAcceptedByProtocolOwner, 0);
  assert.equal(contract.currentTruth.websiteDirectLinksRestoredByProtocolOwner, false);
  assert.equal(contract.currentTruth.productionSigned, false);
  assert.equal(contract.currentTruth.storeReleased, false);
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
