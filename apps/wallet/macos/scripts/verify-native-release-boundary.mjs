import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const workflow = readFileSync(resolve(root, ".github/workflows/wallet-macos.yml"), "utf8");
const nativeSource = readFileSync(resolve(root, "apps/wallet/macos/Sources/YNXWalletMac/main.swift"), "utf8");
const consumption = JSON.parse(readFileSync(resolve(root, "release/integration/wallet-native-provider-contract-consumption-20260821.json"), "utf8"));
const remediation = JSON.parse(readFileSync(resolve(root, "release/integration/wallet-macos-public-dmg-identity-remediation-20260821.json"), "utf8"));

assert.match(workflow, /YNX-Wallet-macOS-ad-hoc\.dmg/);
assert.match(workflow, /hdiutil create -volname "YNX Wallet" -srcfolder "\$DMG_STAGE" -ov -format UDZO "\$DMG"/);
assert.match(workflow, /hdiutil verify "\$DMG"/);
assert.match(workflow, /hdiutil attach "\$DMG" -nobrowse -readonly -mountpoint "\$MOUNT"/);
assert.match(workflow, /ditto "\$MOUNT\/YNX Wallet\.app" "\$APP"/);
assert.match(workflow, /hdiutil detach "\$MOUNT"/);
assert.match(workflow, /codesign --verify --deep --strict "\$APP"/);
assert.match(workflow, /InstalledApplications\/YNX Wallet\.app/);
assert.match(workflow, /test "\$BUNDLE_IDENTIFIER" = 'com\.ynxweb4\.wallet\.macos'/);
assert.match(workflow, /test "\$AUTHORIZATION_SCHEME" = 'ynxwallet'/);
assert.match(nativeSource, /No account, balance, transaction, session, or provider state is inferred\./);
assert.match(nativeSource, /authorizationCompletion=\\\(capabilities\.authorizationCompletionAvailable/);
assert.equal(consumption.centralAcceptance.commit, "d3831c300560507f64a50e73117bab7b85926d9a");
assert.equal(consumption.sharedProviderContract.commit, "98c6d5d784d212df8981a53b17118a511e246ad2");
assert.equal(consumption.nativeConnection.authoritativeSuccess, false);
assert.equal(consumption.sharedProviderContract.productSessionBlocksStandardWallet, false);
assert.equal(consumption.artifactTruth.dmgRequiresHostedInstallEvidence, true);
assert.equal(remediation.publicArtifactAudit.bundleIdentifier, "com.ynxweb4.wallet.desktop");
assert.equal(remediation.publicArtifactAudit.hasCFBundleURLTypes, false);
assert.equal(remediation.publicArtifactAudit.canonicalAuthorizationRouteReceiver, false);
assert.equal(remediation.nativeReplacementCandidate.bundleIdentifier, "com.ynxweb4.wallet.macos");
assert.equal(remediation.nativeReplacementCandidate.authorizationScheme, "ynxwallet");
assert.equal(remediation.nativeReplacementCandidate.publicDownloadHosted, false);
assert.equal(remediation.truth.websiteRemediationDeployed, false);

console.log("wallet macOS DMG and native provider boundary: PASS");
