import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { verifyWalletAuthorizeConsumers } from "../scripts/verify-no-bare-wallet-authorize.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const audit = JSON.parse(await readFile(new URL("../../../release/integration/wallet-authorize-ecosystem-source-runtime-audit-20260821.json", import.meta.url), "utf8"));
const auditV2 = JSON.parse(await readFile(new URL("../../../release/integration/wallet-authorize-ecosystem-source-runtime-audit-v2-20260821.json", import.meta.url), "utf8"));
const auditV3 = JSON.parse(await readFile(new URL("../../../release/integration/wallet-authorize-ecosystem-owner-runtime-matrix-v3-20260821.json", import.meta.url), "utf8"));
const providerRecovery = JSON.parse(await readFile(new URL("../../../release/integration/wallet-provider-discovery-connect-state-p0-handoff-20260821.json", import.meta.url), "utf8"));
const pendingOwnerHandoffs = JSON.parse(await readFile(new URL("../../../release/integration/wallet-provider-connect-pending-owner-handoffs-20260821.json", import.meta.url), "utf8"));
const ownerActivityCheckpoint = JSON.parse(await readFile(new URL("../../../release/integration/wallet-provider-connect-owner-activity-checkpoint-20260821.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../product-session-registry.json", import.meta.url), "utf8"));

test("ecosystem authorize audit covers every registered client exactly once", () => {
  assert.equal(audit.registeredClientCount, 13);
  assert.equal(audit.requiredProductCount, 12);
  assert.equal(audit.nonProductRegistryClientCount, 1);
  assert.deepEqual(audit.products.map(({ productId }) => productId).sort(), registry.products.map(({ productId }) => productId).sort());
  assert.equal(new Set(audit.products.map(({ productId }) => productId)).size, audit.products.length);
});

test("v1 consumer audit remains an immutable historical checkpoint", () => {
  const frozenFindings = [...audit.scanner.registeredProductFindings, ...audit.scanner.otherEcosystemFindings];
  assert.equal(frozenFindings.length, audit.scanner.findingCount);
  assert.equal(new Set(frozenFindings.map(({ file, line, code }) => `${file}:${line}:${code}`)).size, frozenFindings.length);
});

test("no registered product is promoted without the three owner evidence segments", () => {
  assert.equal(audit.productsConnected, 0);
  assert.equal(audit.productsMigratedV2, 0);
  assert.equal(audit.truth.registryV3Public, false);
  assert.equal(audit.truth.deployedPublic, false);
  assert.deepEqual(audit.requiredOwnerEvidenceSegments.map(({ segment }) => segment), ["runtime-source", "public-gateway-v2", "visible-platform-lifecycle"]);
  for (const product of audit.products) {
    assert.equal(product.runtime.connected, false, product.productId);
    assert.equal(product.runtime.productSessionV2, false, product.productId);
    assert.ok(product.blocker.length > 20, product.productId);
    assert.ok(product.migrationHandoff.length >= 3, product.productId);
  }
});

test("every EVM product handoff addresses the exact 0x1917 MetaMask flow", () => {
  for (const product of audit.products.filter(({ evmCompatible }) => evmCompatible)) {
    assert.notEqual(product.audit.metaMask0x1917, "not-applicable", product.productId);
    assert.ok(product.migrationHandoff.join(" ").includes("0x1917"), product.productId);
  }
});

test("v2 ecosystem audit consumes every exact owner source without promoting runtime", () => {
  assert.equal(auditV2.ownerInputs.length, registry.products.length);
  assert.deepEqual(auditV2.products.map(({ productId }) => productId).sort(), registry.products.map(({ productId }) => productId).sort());
  assert.equal(auditV2.productsConnected, 0);
  assert.equal(auditV2.productsMigratedV2, 0);
  assert.equal(auditV2.truth.macComputerControl, false);
  for (const product of auditV2.products) {
    assert.equal(product.runtime.productSessionV2, false, product.productId);
    assert.equal(product.runtime.computerControl, false, product.productId);
    assert.ok(product.blocker.length > 40, product.productId);
    assert.equal(product.handoff.length, 3, product.productId);
  }
});

test("v2 baseline scanner evidence matches the current repository exactly", async () => {
  const findings = await verifyWalletAuthorizeConsumers(root);
  assert.equal(findings.length, auditV2.scanner.findingCount);
  assert.deepEqual(Object.fromEntries([...new Set(findings.map(({ code }) => code))].sort().map((code) => [code, findings.filter((finding) => finding.code === code).length])), auditV2.scanner.findingCountsByCode);
  for (const finding of auditV2.scanner.registeredBaselineFindings) {
    assert.ok(findings.some(({ file, line, code }) => file === finding.file && line === finding.line && code === finding.code), `${finding.productId}:${finding.file}:${finding.code}`);
  }
});

test("safe-launcher and MetaMask counts are derived from product rows", () => {
  const products = auditV2.products.filter(({ nonProductRegistryClient }) => !nonProductRegistryClient);
  assert.equal(products.filter(({ safeLauncherV2Consumed }) => safeLauncherV2Consumed).length, auditV2.safeLauncherV2SourceConsumedProductCount);
  assert.equal(products.filter(({ sourceAudit }) => sourceAudit.metaMaskAddSwitch0x1917 === true).length, auditV2.productsWithCompleteMetaMaskSourcePath);
  for (const product of products.filter(({ sourceAudit }) => sourceAudit.standardWalletIndependentFromProductSession !== true)) {
    assert.match(product.blocker, /standard|provider|Product Session/i, product.productId);
  }
});

test("v3 owner/runtime matrix tracks all twelve products and preserves false authority gates", () => {
  assert.deepEqual(auditV3.registeredProducts.map(({ productId }) => productId).sort(), auditV2.products.filter(({ nonProductRegistryClient }) => !nonProductRegistryClient).map(({ productId }) => productId).sort());
  assert.equal(auditV3.counts.registeredProducts, 12);
  assert.equal(auditV3.counts.productsConnected, 0);
  assert.equal(auditV3.counts.productsMigratedV2, 0);
  assert.equal(auditV3.truth.macComputerControl, false);
  for (const product of auditV3.registeredProducts) {
    assert.equal(product.runtime.productSessionV2, false, product.productId);
    assert.ok(product.ownerHandoff.length > 80, product.productId);
  }
  assert.deepEqual(auditV3.registeredProducts.filter(({ runtime }) => runtime.realInstalledApproval === true).map(({ productId }) => productId), ["calendar"]);
});

test("v3 counts and precise owner blockers are derived without aggregate promotion", () => {
  const products = auditV3.registeredProducts;
  assert.equal(products.filter(({ runtime }) => runtime.sourceBoundPublic === true).length, auditV3.counts.sourceBoundPublicProducts);
  assert.equal(products.filter(({ web }) => web.metaMaskAddSwitch0x1917 === true).length, auditV3.counts.completeMetaMaskSourcePaths);
  assert.equal(products.filter(({ web }) => web.topLevelOrHandwrittenYnxwallet === true).length, auditV3.counts.topLevelOrHandwrittenWebBlockers);
  assert.equal(products.filter(({ web }) => web.standardProvider === false).length, auditV3.counts.missingStandardProviderProducts);
  assert.equal(products.filter(({ web }) => String(web.guest).startsWith("unproven")).length, auditV3.counts.guestUnprovenProducts);
  for (const product of products.filter(({ web }) => web.metaMaskAddSwitch0x1917 === false)) assert.match(product.ownerHandoff, /MetaMask|switch|0x1917/i, product.productId);
});

test("Trust Center public guest evidence remains outside registered migration counts", () => {
  const trust = auditV3.otherEcosystem.find(({ surfaceId }) => surfaceId === "trust-center");
  assert.ok(trust);
  assert.equal(trust.runtime.deployedPublic, true);
  assert.equal(trust.runtime.guestReadOnlyVerified, true);
  assert.equal(trust.runtime.guestWriteHttp, 401);
  assert.equal(trust.runtime.installedWallet, false);
  assert.equal(trust.runtime.accountApproval, false);
  assert.equal(trust.runtime.productSessionV2, false);
  assert.equal(trust.runtime.computerControl, false);
  assert.equal(auditV3.truth.deployedPublicAggregate, false);
});

test("Wallet Web/PWA and macOS DMG publication remain outside product authority", () => {
  const companion = auditV3.nonProductRegistryClient;
  assert.equal(companion.productId, "wallet-web-companion");
  assert.equal(companion.webShellSourceCommit, "3651ba0c4322e0564e29b4573f3def90828dba67");
  assert.equal(companion.publicEvidenceCommit, "93c3d06bab567e40c419ff2b3c5702d55083c7fa");
  assert.equal(companion.deploymentId, "dpl_6GRARbJYU5JyPeJP7Un3E6KqmBN2");
  assert.equal(companion.runtime.sourceBoundPublic, true);
  assert.equal(companion.runtime.metaMaskEip6963Detected, true);
  assert.equal(companion.runtime.mirrorDriftObservedAndRepaired, true);
  assert.equal(companion.runtime.noProviderOfficialYnxAndroidAction, true);
  assert.equal(companion.runtime.noProviderOfficialMetaMaskAction, true);
  assert.equal(companion.runtime.mobile390NoHorizontalOverflow, true);
  assert.equal(companion.runtime.accountApproval, false);
  assert.equal(companion.runtime.providerChainId1917, false);
  assert.equal(companion.runtime.callback, false);
  assert.equal(companion.runtime.productSessionV2, false);
  assert.equal(companion.macosDmgPublication.websitePublished, true);
  assert.equal(companion.macosDmgPublication.artifactSha256, "ad6e4077bc001743cf1a4163ceaca5a009a3c8a4d8a809cc4896798976cf56c0");
  assert.equal(companion.macosDmgPublication.isolatedTempApplicationsCopyVerified, true);
  assert.equal(companion.macosDmgPublication.directBinaryColdLaunch.chainId, "0x1917");
  assert.equal(companion.macosDmgPublication.launchServicesSecond.ppid, 1);
  assert.equal(companion.macosDmgPublication.identityGapEvidenceCommit, "b7f20a717b22ed279146ac7ab2b41c272a79acb0");
  assert.equal(companion.macosDmgPublication.ynxwalletSchemeRegistered, false);
  assert.equal(companion.macosDmgPublication.associatedDomainsPresent, false);
  assert.equal(companion.macosDmgPublication.publicArtifactMatchesOwnerNativeIdentity, false);
  assert.equal(companion.macosDmgPublication.publicNativeWalletPublished, false);
  assert.equal(companion.macosDmgPublication.publicArtifactCallbackDelivered, false);
  assert.equal(companion.nativeMacosProductionPipeline.sourceReady, true);
  assert.equal(companion.nativeMacosProductionPipeline.ciRun, 32486864907);
  assert.equal(companion.nativeMacosProductionPipeline.defaultMainRegistrationCount, 0);
  assert.equal(companion.nativeMacosProductionPipeline.productionRelease, false);
  assert.equal(companion.nativeMacosKeychainCleanup.originalSearchListAlwaysRestored, true);
  assert.equal(companion.nativeMacosKeychainCleanup.isolatedKeychainP12NotaryKeyDeleted, true);
  assert.equal(companion.nativeMacosKeychainCleanup.ciRun, 32487661461);
  assert.equal(companion.nativeMacosKeychainCleanup.artifactDownloadBytes, 0);
  assert.equal(companion.nativeMacosKeychainCleanup.productionCleanupRuntimeProof, false);
  assert.equal(companion.nativeMacosKeychainCleanupRuntime.failedRun, 32488308883);
  assert.equal(companion.nativeMacosKeychainCleanupRuntime.successRun, 32489069803);
  assert.equal(companion.nativeMacosKeychainCleanupRuntime.cleanupReceiptExpectedSha256, companion.nativeMacosKeychainCleanupRuntime.cleanupReceiptRestoredSha256);
  assert.equal(companion.nativeMacosKeychainCleanupRuntime.sharedCleanupRuntimeWithoutProductionSecrets, true);
  assert.equal(companion.nativeMacosKeychainCleanupRuntime.productionSigningCleanupRuntime, false);
  assert.equal(companion.nativeMacosKeychainCleanupRuntime.iosGatePromoted, false);
  assert.equal(companion.nativeCiTriggerIsolation.macosOnlyChangesExcludedFromWalletIosPushPr, true);
  assert.equal(companion.nativeCiTriggerIsolation.macOnlyWalletIosRunCount, 0);
  assert.equal(companion.nativeCiTriggerIsolation.workflowSelfChangeTriggered, true);
  assert.equal(companion.nativeCiTriggerIsolation.iosSimulatorPromoted, false);
  assert.equal(companion.nativeIosProductionDistribution.sourceReady, true);
  assert.equal(companion.nativeIosProductionDistribution.hostedSourceContractVerified, true);
  assert.equal(companion.nativeIosProductionDistribution.distributionJobSkipped, true);
  assert.equal(companion.nativeIosProductionDistribution.defaultMainWorkflowCount, 0);
  assert.equal(companion.nativeIosProductionDistribution.ipa, false);
  assert.equal(companion.nativeIosProductionDistribution.appStoreReleased, false);
  assert.equal(companion.nativeIosDistributionCleanupRuntime.cleanupRuntimePassed, true);
  assert.equal(companion.nativeIosDistributionCleanupRuntime.expectedSearchListSha256, companion.nativeIosDistributionCleanupRuntime.restoredSearchListSha256);
  assert.equal(companion.nativeIosDistributionCleanupRuntime.sharedDistributionCleanupRuntimeVerifiedWithoutProductionSecrets, true);
  assert.equal(companion.nativeIosDistributionCleanupRuntime.productionCleanupRuntime, false);
  assert.equal(companion.appleProductionOperatorInputs.implementationCommit, "2b11c771a7d34f852e3028057b52f560d7498bdc");
  assert.equal(companion.appleProductionOperatorInputs.evidenceCommit, "07ca1a4a437a8f24dcae345d2f92344b40600f00");
  assert.equal(companion.appleProductionOperatorInputs.requestSha256, "579846e6d6120fc861dd93dfa16bb86e4cbc9cafede34cb1e41b063db35ef0a9");
  assert.equal(companion.appleProductionOperatorInputs.operatorInputRequestHostedSourceVerified, true);
  assert.equal(companion.appleProductionOperatorInputs.secretValuesRequested, false);
  assert.equal(companion.appleProductionOperatorInputs.universalLinkExcludedUntilCoreFrozen, true);
  assert.equal(companion.appleProductionOperatorInputs.operatorInputsProvided, false);
  assert.equal(companion.appleProductionOperatorInputs.ipa, false);
  assert.equal(companion.appleProductionOperatorInputs.developerId, false);
  assert.equal(companion.nativeMacosArtifactBackread.evidenceCommit, "d970aa3f229371ee300e2ec5f647699928f1dd44");
  assert.equal(companion.nativeMacosArtifactBackread.innerArchiveSha256, "08cbb2f177e0a82e597d5aa1063722e15dafc5a5e130b0d9b00fc0e00dd0bd41");
  assert.equal(companion.nativeMacosArtifactBackread.actionsArtifactDownloaded, true);
  assert.equal(companion.nativeMacosArtifactBackread.strictDeepCodesignVerified, true);
  assert.equal(companion.nativeMacosArtifactBackread.signature, "adhoc");
  assert.equal(companion.nativeMacosArtifactBackread.deviceRecoveryScreenshotUnobscured, true);
  assert.equal(companion.nativeMacosArtifactBackread.canonicalBridgeScreenshotUnobscured, false);
  assert.equal(companion.nativeMacosArtifactBackread.gatekeeperAccepted, false);
  assert.equal(companion.nativeMacosArtifactBackread.authorizationSuccess, false);
  assert.equal(companion.nativeMacosPublicGatewayFailClosed.implementationCommit, "07634c308bd553702cf5ea3837cfcff88ba6e2b2");
  assert.equal(companion.nativeMacosPublicGatewayFailClosed.evidenceCommit, "eb916f843c6433d0011dac3dc7b5bad6fb3d1708");
  assert.equal(companion.nativeMacosPublicGatewayFailClosed.chainId, "0x1917");
  assert.equal(companion.nativeMacosPublicGatewayFailClosed.walletStateDigestUnchanged, true);
  assert.equal(companion.nativeMacosPublicGatewayFailClosed.coldGatewayFailClosedLogVerified, true);
  assert.equal(companion.nativeMacosPublicGatewayFailClosed.secondGatewayFailClosedLogVerified, true);
  assert.equal(companion.nativeMacosPublicGatewayFailClosed.sensitiveInputProvided, false);
  assert.equal(companion.nativeMacosPublicGatewayFailClosed.authorizationSuccess, false);
  assert.equal(companion.nativeMacosPublicGatewayFailClosed.productSessionVerified, false);
  assert.equal(companion.nativeIosPublicGatewayFailClosed.implementationCommit, "f7669a663370f7c2e5a34743e39024dfd05ed333");
  assert.equal(companion.nativeIosPublicGatewayFailClosed.evidenceCommit, "b87ff7d0d913045f4b8c77801aba288a54c2516c");
  assert.equal(companion.nativeIosPublicGatewayFailClosed.hostedOverallPassed, false);
  assert.equal(companion.nativeIosPublicGatewayFailClosed.buildInstallGatewayAndNegativeStepsPassed, true);
  assert.equal(companion.nativeIosPublicGatewayFailClosed.nativeKeychainAddReadDelete, true);
  assert.equal(companion.nativeIosPublicGatewayFailClosed.observedStateUnchanged, true);
  assert.equal(companion.nativeIosPublicGatewayFailClosed.biometricSuccess, false);
  assert.equal(companion.nativeIosPublicGatewayFailClosed.recoverySuccess, false);
  assert.equal(companion.nativeIosPublicGatewayFailClosed.productSession, false);
  assert.equal(companion.macosDmgPublication.systemApplicationsInstallVerified, false);
  assert.equal(companion.macosDmgPublication.browserQuarantineAcceptanceVerified, false);
  assert.equal(companion.macosDmgPublication.wholeAppUnsigned, true);
  assert.equal(companion.macosDmgPublication.notarized, false);
  assert.equal(companion.macosDmgPublication.rollbackVerified, false);
  assert.equal(companion.macosDmgPublication.productionSigned, false);
  assert.equal(auditV3.counts.productsConnected, 0);
  assert.equal(auditV3.counts.productsMigratedV2, 0);
});

test("shared Provider/connect recovery hands off to all products without promoting runtime", () => {
  assert.equal(auditV3.sharedProviderConnectRecovery.sourceCommit, providerRecovery.source.commit);
  assert.equal(auditV3.sharedProviderConnectRecovery.registeredProductConsumers, 6);
  assert.equal(auditV3.sharedProviderConnectRecovery.publicRuntimeConsumers, 2);
  assert.equal(auditV3.sharedProviderConnectRecovery.realAccountApprovalProducts, 1);
  assert.deepEqual(providerRecovery.registeredProductHandoffs.map(({ productId }) => productId).sort(), auditV3.registeredProducts.map(({ productId }) => productId).sort());
  assert.deepEqual(providerRecovery.registeredProductHandoffs.filter(({ consumed }) => consumed).map(({ productId }) => productId), ["calendar", "developer", "dex", "exchange", "pay", "shop"]);
  const calendarRecovery = providerRecovery.registeredProductHandoffs.find(({ productId }) => productId === "calendar");
  assert.equal(calendarRecovery.publicSourceBound, true);
  assert.equal(calendarRecovery.realProviderApproval, true);
  assert.equal(calendarRecovery.refreshRestore, true);
  assert.equal(calendarRecovery.disconnect, false);
  assert.equal(calendarRecovery.callback, false);
  const shopRecovery = providerRecovery.registeredProductHandoffs.find(({ productId }) => productId === "shop");
  assert.equal(shopRecovery.sourceCommit, "e35c950d57a6f9a4477877d3806cf1e4566ce74e");
  assert.equal(shopRecovery.evidenceCommit, "35dc239546c2bf963534d5031d4c35c4e22c2d1c");
  assert.equal(shopRecovery.evidenceSha256, "3b11fd760b52dfa4c33960f2f892abb926fea6576e1b1c082b6012f7c64ae9f6");
  assert.equal(shopRecovery.publicationType, "static-only");
  assert.equal(shopRecovery.fullRuntimeIdentityMatched, false);
  assert.equal(shopRecovery.refresh.chainId, "0x1917");
  assert.equal(shopRecovery.refresh.accountPresent, true);
  assert.equal(shopRecovery.refresh.connectDialogOpen, false);
  assert.equal(shopRecovery.newAccountApprovalObserved, false);
  assert.equal(providerRecovery.directChromeEvidence.shop.accountApprovalObserved, false);
  assert.equal(providerRecovery.directChromeEvidence.card.accountApprovalObserved, false);
  assert.equal(providerRecovery.standardConnectStateContract.rpcProbe.endpointBindingObserved, "Public Wallet Companion declares rpc.cors=false.");
  assert.match(providerRecovery.standardConnectStateContract.rpcProbe.connectionAuthority, /provider\.request eth_chainId=0x1917/);
  assert.equal(auditV3.sharedProviderConnectRecovery.directBrowserRpcIsConnectionPrerequisite, false);
  assert.equal(auditV3.sharedProviderConnectRecovery.acceptedCorsSafeRpcProbeRequired, true);
  assert.equal(providerRecovery.truth.productsConnected, 0);
  assert.equal(providerRecovery.truth.threeProductChromeAcceptance, false);
  assert.equal(providerRecovery.truth.officialInstallersReplaced, false);
  assert.equal(providerRecovery.truth.websiteDirectLinksRestored, false);
});

test("pending Provider/connect handoffs cover the remaining six owners and preserve connection authority", () => {
  const consumed = providerRecovery.registeredProductHandoffs.filter(({ consumed }) => consumed).map(({ productId }) => productId);
  const pending = providerRecovery.registeredProductHandoffs.filter(({ consumed }) => !consumed).map(({ productId }) => productId).sort();
  assert.deepEqual(consumed, ["calendar", "developer", "dex", "exchange", "pay", "shop"]);
  assert.equal(pendingOwnerHandoffs.consumed.count, 6);
  assert.deepEqual(pendingOwnerHandoffs.consumed.products, consumed);
  assert.equal(pendingOwnerHandoffs.pending.length, 6);
  assert.deepEqual(pendingOwnerHandoffs.pending.map(({ productId }) => productId).sort(), pending);
  assert.ok(pendingOwnerHandoffs.pending.every(({ currentSourceCommit, handoff }) => /^[0-9a-f]{40}$/.test(currentSourceCommit) && handoff.length > 80));
  assert.deepEqual(pendingOwnerHandoffs.connectionAuthority.successRequires, ["selected-provider", "approved-account", "provider-request-chain-0x1917"]);
  assert.equal(pendingOwnerHandoffs.connectionAuthority.directBrowserRpcFetchRequired, false);
  assert.equal(pendingOwnerHandoffs.connectionAuthority.rpcProbeDegradedEffects.connectionPreserved, true);
  assert.equal(pendingOwnerHandoffs.connectionAuthority.rpcProbeDegradedEffects.chooserReopened, false);
  assert.equal(pendingOwnerHandoffs.connectionAuthority.rpcProbeDegradedEffects.classifiedAsNoProvider, false);
  assert.equal(pendingOwnerHandoffs.completionBoundary.sourceCheckpointIsProductCompletion, false);
  assert.equal(pendingOwnerHandoffs.acceptanceEvaluator.export, "evaluateProductWalletMigrationEvidence");
  assert.equal(pendingOwnerHandoffs.acceptanceEvaluator.authority, "evidence-evaluation-only");
  assert.equal(pendingOwnerHandoffs.acceptanceEvaluator.failClosed, true);
  const finance = pendingOwnerHandoffs.pending.find(({ productId }) => productId === "finance");
  assert.match(finance.stalledReason, /69ba84ea.*51a60a36/);
  assert.equal(auditV3.registeredProducts.find(({ productId }) => productId === "finance").candidateEvidenceSourceTreeMismatch, true);
  assert.equal(pendingOwnerHandoffs.truth.newProductConsumptionRecorded, true);
  assert.equal(pendingOwnerHandoffs.truth.aggregateConnected, false);
  const pendingCard = pendingOwnerHandoffs.pending.find(({ productId }) => productId === "card");
  assert.equal(pendingCard.currentSourceCommit, "345e0bdb41e9ad7cd5b208ffb1d144bc1b3b328b");
  assert.equal(pendingCard.sharedProviderConnectConsumed, false);
  assert.equal(pendingCard.noProviderTopLevelTabDelta, 0);
});

test("owner activity checkpoint derives counts and consumes Faucet recovery without product promotion", () => {
  const products = ownerActivityCheckpoint.products;
  const card = products.find(({ productId }) => productId === "card");
  assert.equal(card.sourceCommit, "345e0bdb41e9ad7cd5b208ffb1d144bc1b3b328b");
  assert.equal(card.sourceConsumed, false);
  assert.equal(card.topLevelTabDelta, 0);
  assert.deepEqual(products.map(({ productId }) => productId).sort(), registry.products.filter(({ productId }) => productId !== "wallet-web-companion").map(({ productId }) => productId).sort());
  assert.equal(products.filter(({ sourceConsumed }) => sourceConsumed).length, ownerActivityCheckpoint.summary.sourceConsumers);
  assert.equal(products.filter(({ sourceConsumed, publicRuntime }) => sourceConsumed && publicRuntime).length, ownerActivityCheckpoint.summary.sourceBoundPublicConsumers);
  assert.equal(products.filter(({ realProviderApproval }) => realProviderApproval).length, ownerActivityCheckpoint.summary.realProviderApprovalProducts);
  assert.equal(products.filter(({ complete }) => complete).length, ownerActivityCheckpoint.summary.threeSegmentCompleteProducts);
  assert.deepEqual(products.filter(({ sourceConsumed }) => !sourceConsumed).map(({ owner }) => owner).sort(), [...ownerActivityCheckpoint.stalledOwners].sort());
  assert.equal(ownerActivityCheckpoint.summary.productsConnected, 0);
  assert.equal(ownerActivityCheckpoint.summary.productsMigratedV2, 0);
  assert.match(products.find(({ productId }) => productId === "finance").blocker, /69ba84ea.*51a60a36/);
  assert.equal(ownerActivityCheckpoint.faucetTracking.runtimeSource, "d644c0821b615938e88e55ff6b073873e18f8e73");
  assert.equal(ownerActivityCheckpoint.faucetTracking.ownerEvidenceCommit, "5ff50cabee53806588ebe406237c166f40e71e9d");
  assert.equal(ownerActivityCheckpoint.faucetTracking.websiteSource, "6168e0aa553edc29a57da26a7ac7ed291339ebbd");
  assert.equal(ownerActivityCheckpoint.faucetTracking.vercelReady, true);
  assert.equal(ownerActivityCheckpoint.faucetTracking.identityPromoted, true);
  assert.equal(ownerActivityCheckpoint.faucetTracking.transfers.length, 2);
  assert.equal(ownerActivityCheckpoint.faucetTracking.rateLimit429Verified, true);
  assert.deepEqual(ownerActivityCheckpoint.faucetTracking.boundaries, { concurrentUpstream502Observed: true, explorerTransactionRoute: false, ynx1Support: false, walletPlatformFaucet: false, computerControl: false });
  assert.equal(ownerActivityCheckpoint.faucetTracking.modifiedByProtocolOwner, false);
  assert.deepEqual(auditV3.remoteRecheck.faucetSourceIdentityTracking.transfers, ownerActivityCheckpoint.faucetTracking.transfers);
  assert.deepEqual(auditV3.remoteRecheck.faucetSourceIdentityTracking.boundaries, ownerActivityCheckpoint.faucetTracking.boundaries);
  assert.equal(auditV3.remoteRecheck.faucetSourceIdentityTracking.runtimeIdentityPromoted, true);
  assert.equal(auditV3.remoteRecheck.faucetSourceIdentityTracking.matrixAuthority, false);
  assert.equal(ownerActivityCheckpoint.truth.aggregateConnected, false);
});

test("owner checkpoint separates Wallet public artifacts from approval and Product Session authority", () => {
  const platform = ownerActivityCheckpoint.walletPlatformTracking;
  assert.equal(platform.webPwa.sourceCommit, "3651ba0c4322e0564e29b4573f3def90828dba67");
  assert.equal(platform.webPwa.evidenceCommit, "93c3d06bab567e40c419ff2b3c5702d55083c7fa");
  assert.equal(platform.webPwa.deploymentId, "dpl_6GRARbJYU5JyPeJP7Un3E6KqmBN2");
  assert.equal(platform.webPwa.sourceBoundPublic, true);
  assert.equal(platform.webPwa.mirrorDriftObservedAndRepaired, true);
  assert.equal(platform.webPwa.sensitiveRequestTriggered, false);
  assert.equal(platform.webPwa.accountApproved, false);
  assert.equal(platform.webPwa.callback, false);
  assert.equal(platform.webPwa.productSessionV2, false);
  assert.equal(platform.macosDmg.websitePublished, true);
  assert.equal(platform.macosDmg.artifactSha256, "ad6e4077bc001743cf1a4163ceaca5a009a3c8a4d8a809cc4896798976cf56c0");
  assert.equal(platform.macosDmg.isolatedTempApplicationsCopyVerified, true);
  assert.equal(platform.macosDmg.directBinarySecond.chainId, "0x1917");
  assert.equal(platform.macosDmg.launchServicesCold.ppid, 1);
  assert.equal(platform.macosDmg.identityGapEvidenceCommit, "b7f20a717b22ed279146ac7ab2b41c272a79acb0");
  assert.equal(platform.macosDmg.ownerNativeSource.ynxwalletSchemeRegistered, true);
  assert.equal(platform.macosDmg.publicArtifactMatchesOwnerNativeIdentity, false);
  assert.equal(platform.macosDmg.publicNativeWalletPublished, false);
  assert.equal(platform.macosDmg.publicArtifactCanonicalCallbackFailClosedVisible, false);
  assert.equal(platform.macosDmg.nativeProductionPipeline.sourceCommit, "07cab0839e55a2a4f65b4813345d35fb5460c5f8");
  assert.equal(platform.macosDmg.nativeProductionPipeline.sourceReady, true);
  assert.equal(platform.macosDmg.nativeProductionPipeline.productionDmg, false);
  assert.equal(platform.macosDmg.keychainCleanup.evidenceCommit, "e277f5c6c023cdef39de9a73691565e1c653fa22");
  assert.equal(platform.macosDmg.keychainCleanup.originalSearchListAlwaysRestored, true);
  assert.equal(platform.macosDmg.keychainCleanup.innerHashesInspected, false);
  assert.equal(platform.macosDmg.keychainCleanup.productionCleanupRuntimeProof, false);
  assert.equal(platform.macosDmg.keychainCleanupRuntime.fixCommit, "99fa2c7db61ac23717743103cced76001ea4160b");
  assert.equal(platform.macosDmg.keychainCleanupRuntime.productionCredentialsUsed, false);
  assert.equal(platform.macosDmg.keychainCleanupRuntime.sharedCleanupRuntimeWithoutProductionSecrets, true);
  assert.equal(platform.macosDmg.keychainCleanupRuntime.productionSigningCleanupRuntime, false);
  assert.equal(platform.macosDmg.ciTriggerIsolation.evidenceCommit, "69009ba5abbbd57739bdd6a08936dbddbe5e842b");
  assert.equal(platform.macosDmg.ciTriggerIsolation.macOnlyWalletIosRunCount, 0);
  assert.equal(platform.macosDmg.ciTriggerIsolation.iosSimulatorPromoted, false);
  assert.equal(platform.iosProductionDistribution.evidenceCommit, "77225b3ca830b3edaf7ae4cd5f7fbb3b619f380e");
  assert.equal(platform.iosProductionDistribution.sourceReady, true);
  assert.equal(platform.iosProductionDistribution.iosSimulatorPromoted, false);
  assert.equal(platform.iosProductionDistribution.appStoreConnectUploadSubmitted, false);
  assert.equal(platform.iosProductionDistribution.websitePublished, false);
  assert.equal(platform.iosDistributionCleanupRuntime.evidenceCommit, "cf8f56782d6831e11b57be600efa0382b7ef4045");
  assert.equal(platform.iosDistributionCleanupRuntime.productionCredentialsUsed, false);
  assert.equal(platform.iosDistributionCleanupRuntime.sharedDistributionCleanupRuntimeVerifiedWithoutProductionSecrets, true);
  assert.equal(platform.iosDistributionCleanupRuntime.productionCleanupRuntime, false);
  assert.equal(platform.appleProductionOperatorInputs.evidenceCommit, "07ca1a4a437a8f24dcae345d2f92344b40600f00");
  assert.equal(platform.appleProductionOperatorInputs.operatorInputRequestImplemented, true);
  assert.equal(platform.appleProductionOperatorInputs.operatorInputRequestHostedSourceVerified, true);
  assert.equal(platform.appleProductionOperatorInputs.secretValuesRequested, false);
  assert.equal(platform.appleProductionOperatorInputs.operatorInputsProvided, false);
  assert.equal(platform.appleProductionOperatorInputs.universalLinkExcludedUntilCoreFrozen, true);
  assert.equal(platform.macosNativeArtifactBackread.evidenceCommit, "d970aa3f229371ee300e2ec5f647699928f1dd44");
  assert.equal(platform.macosNativeArtifactBackread.actionsArtifactDownloaded, true);
  assert.equal(platform.macosNativeArtifactBackread.minimumMacOS, "13.0");
  assert.deepEqual(platform.macosNativeArtifactBackread.architectures, ["x86_64", "arm64"]);
  assert.equal(platform.macosNativeArtifactBackread.signature, "adhoc");
  assert.equal(platform.macosNativeArtifactBackread.teamIdentifierPresent, false);
  assert.equal(platform.macosNativeArtifactBackread.gatekeeperAccepted, false);
  assert.equal(platform.macosNativePublicGatewayFailClosed.evidenceCommit, "eb916f843c6433d0011dac3dc7b5bad6fb3d1708");
  assert.equal(platform.macosNativePublicGatewayFailClosed.nativePublicRpcChainIdVerified, true);
  assert.equal(platform.macosNativePublicGatewayFailClosed.nativePublicAppGatewayReachable, true);
  assert.equal(platform.macosNativePublicGatewayFailClosed.walletStateDigestUnchanged, true);
  assert.equal(platform.macosNativePublicGatewayFailClosed.walletApprovalCompleted, false);
  assert.equal(platform.macosNativePublicGatewayFailClosed.callbackEmitted, false);
  assert.equal(platform.iosNativePublicGatewayFailClosed.evidenceCommit, "b87ff7d0d913045f4b8c77801aba288a54c2516c");
  assert.equal(platform.iosNativePublicGatewayFailClosed.hostedOverallConclusion, "failure");
  assert.equal(platform.iosNativePublicGatewayFailClosed.simulatorInstallColdSecondLaunch, true);
  assert.equal(platform.iosNativePublicGatewayFailClosed.nativeKeychainAddReadDelete, true);
  assert.equal(platform.iosNativePublicGatewayFailClosed.biometricPositiveStepPassed, false);
  assert.equal(platform.iosNativePublicGatewayFailClosed.authorizationSuccess, false);
  assert.equal(platform.macosDmg.systemApplicationsInstallVerified, false);
  assert.equal(platform.macosDmg.browserQuarantineAcceptanceVerified, false);
  assert.equal(platform.macosDmg.developerId, false);
  assert.equal(platform.macosDmg.rollbackVerified, false);
  assert.equal(platform.macosDmg.productionSigned, false);
  assert.equal(platform.modifiedByProtocolOwner, false);
  assert.equal(ownerActivityCheckpoint.summary.threeSegmentCompleteProducts, 0);
});
