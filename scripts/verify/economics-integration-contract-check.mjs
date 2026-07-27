import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJSON = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const contractPath = "release/integration/ynxt-economics-contract.json";
const vectorsPath = "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json";
const sharedTestnetSchemaPath = "release/integration/ynxt-economics-shared-testnet-evidence.schema.json";
const contract = readJSON(contractPath);
const vectors = readJSON(vectorsPath);
const sharedTestnetSchema = readJSON(sharedTestnetSchemaPath);

assert.equal(contract.schemaVersion, 1);
assert.equal(contract.contractId, "ynx.economics.integration.v1");
assert.equal(contract.owner, "17 Economics");
assert.equal(contract.status, "active");
assert.equal(contract.currentPhase, "INTEGRATE");
assert.equal(contract.nextPhase, "TESTNET");
assert.equal(vectors.schemaVersion, 1);
assert.equal(vectors.contractId, contract.contractId);
assert.equal(vectors.sourceCommit, contract.sourceCommit);
assert.equal(vectors.sharedTestnetEvidence, false);

const commit = spawnSync("git", ["cat-file", "-e", `${contract.sourceCommit}^{commit}`], { cwd: root });
assert.equal(commit.status, 0, "contract sourceCommit must identify an existing commit");

assert.deepEqual(contract.releaseStates, {
  implementedLocal: true,
  testedLocal: true,
  installedLocal: false,
  integratedCentral: false,
  deployedStaging: false,
  deployedPublic: false,
  downloadHosted: false,
  productionSigned: false,
  storeReleased: false,
});

assert.equal(contract.supply.hiddenMintAllowed, false);
assert.equal(contract.supply.administratorArbitraryMintAllowed, false);
assert.equal(contract.supply.hardCap, null);
assert.equal(contract.supply.annualIssuanceFloorBps, 100);
assert.equal(contract.supply.annualIssuanceCeilingBps, 800);
assert.equal(contract.supply.emergencyIssuanceCeilingBps, 300);
assert.equal(Object.values(contract.supply.allocationBps).reduce((sum, value) => sum + value, 0), 10000);
assert.equal(Object.values(contract.fees.priorityAndServiceRevenueSplitBps).reduce((sum, value) => sum + value, 0), 10000);
assert.equal(contract.fees.burnIsRevenue, false);
assert.equal(contract.fees.serviceBurnIsRevenue, false);
assert.equal(contract.fees.testSubsidyIsRevenue, false);
assert.equal(contract.fees.internalTransferIsRevenue, false);
assert.equal(contract.staking.guaranteedApy, false);
assert.equal(contract.liquidStaking.production, false);
assert.equal(contract.liquidStaking.guaranteedPeg, false);
assert.equal(contract.liquidStaking.guaranteedApy, false);
assert.equal(contract.securityPools.recursiveRestakingAllowed, false);
assert.equal(contract.securityPools.hiddenRehypothecationAllowed, false);
assert.equal(contract.securityPools.crossServiceContagionAllowed, false);
assert.equal(contract.stableSettlement.providerIntegrated, false);
assert.equal(contract.stableSettlement.yusdRealityValue, false);
assert.equal(contract.stableSettlement.externalReserveAttested, false);
assert.equal(contract.stableSettlement.guaranteedPeg, false);
assert.equal(contract.stableSettlement.algorithmicUncollateralizedStablecoinAllowed, false);
assert.equal(contract.treasury.aiExecutionAllowed, false);
assert.equal(contract.treasury.ordinaryServiceSigningAllowed, false);
assert.equal(contract.treasury.secretMarketSupportAllowed, false);
assert.equal(contract.treasury.executionActivated, false);
assert.equal(contract.quantPerformanceFee.unrealizedProfitChargeAllowed, false);
assert.equal(contract.quantPerformanceFee.lossChargeAllowed, false);
assert.equal(contract.quantPerformanceFee.highWaterMarkResetChargeAllowed, false);
assert.equal(contract.authAndIntent.browserLongLivedBearerAllowed, false);
assert.equal(contract.authAndIntent.wildcardScopeAllowed, false);
assert.equal(contract.authAndIntent.aiSigningAllowed, false);
assert.equal(contract.integrationAdapter.schemaVersion, 1);
assert.equal(contract.integrationAdapter.contractId, contract.contractId);
assert.equal(contract.integrationAdapter.evidenceClass, "local-deterministic-integration");
assert.equal(contract.integrationAdapter.burnRevenueSeparationEnforced, true);
assert.equal(contract.integrationAdapter.sourcePayloadCanonicalityEnforced, true);
assert.equal(contract.integrationAdapter.rehashedTamperRejection, true);
assert.equal(contract.integrationAdapter.releaseTruthEnforced, true);
assert.equal(contract.integrationAdapter.acceptedByDataFabric, false);
assert.equal(contract.integrationAdapter.acceptedByExplorer, false);
assert.equal(contract.integrationAdapter.acceptedByMonitor, false);
assert.equal(contract.integrationAdapter.sharedTestnetEvidence, false);
assert.equal(contract.integrationAdapter.publicDeployment, false);
assert.equal(contract.integrationAdapter.production, false);
assert.deepEqual(contract.integrationAdapter.counts, {
  canonicalEnvelopes: 5,
  billingLedgerEntries: 18,
  explorerProjections: 5,
  monitorChecks: 15,
});
assert.equal(contract.integrationStore.schemaVersion, 1);
assert.equal(contract.integrationStore.sourceCommit, contract.sourceCommit);
assert.equal(contract.integrationStore.bundleHash, contract.integrationAdapter.bundleHash);
assert.equal(contract.integrationStore.acceptedBundles, 1);
assert.equal(contract.integrationStore.revision, 2);
assert.deepEqual(contract.integrationStore.recordCounts, contract.integrationAdapter.counts);
assert.equal(contract.integrationStore.idempotentReplay, true);
assert.equal(contract.integrationStore.semanticDeduplication, true);
assert.equal(contract.integrationStore.commitRebindingRejected, true);
assert.equal(contract.integrationStore.unacceptedSourceRejected, true);
assert.equal(contract.integrationStore.atomicPersistence, true);
assert.equal(contract.integrationStore.fileMode, "0600");
assert.equal(contract.integrationStore.restartRecovery, true);
assert.equal(contract.integrationStore.tamperRejection, true);
assert.equal(contract.integrationStore.acceptedByDataFabric, false);
assert.equal(contract.integrationStore.sharedTestnetEvidence, false);
assert.equal(contract.integrationStore.publicDeployment, false);
assert.equal(contract.integrationStore.production, false);
assert.equal(contract.localTestnetEvidence.schemaVersion, 1);
assert.equal(contract.localTestnetEvidence.evidenceClass, "local-testnet-simulation");
assert.equal(contract.localTestnetEvidence.sourceCommit, "f14d002a39cedca18b094e856adc7da888d376da");
assert.equal(contract.localTestnetEvidence.fixture.transactionId, "econ-local-tx-abbeda604c4fae1d357982ad6bb1011e3d134fa437eb0c52e91464d41704aa70");
assert.equal(contract.localTestnetEvidence.fixture.blockHeight, 6423);
assert.equal(contract.localTestnetEvidence.fixture.blockHash, "sha256:cb1eebecdd4708636da415bd9a79d67ef6eec519d1b5cb8358d7363ab750ed4a");
assert.equal(contract.localTestnetEvidence.fixture.receiptStatus, "simulated-committed");
assert.equal(contract.localTestnetEvidence.fixture.finality, "local-deterministic-simulation");
assert.equal(contract.localTestnetEvidence.fixture.evidenceHash, "sha256:ed2ac4a7dc035a3dddaa021e09763526d74cd72cc3a3ea77faee45ce8fa91348");
assert.equal(contract.localTestnetEvidence.fixture.explorerProofs, 5);
assert.equal(contract.localTestnetEvidence.fixture.monitorProofs, 15);
assert.equal(contract.localTestnetEvidence.acceptedByDataFabric, false);
assert.equal(contract.localTestnetEvidence.acceptedByExplorer, false);
assert.equal(contract.localTestnetEvidence.acceptedByMonitor, false);
assert.equal(contract.localTestnetEvidence.sharedTestnetEvidence, false);
assert.equal(contract.localTestnetEvidence.publicDeployment, false);
assert.equal(contract.localTestnetEvidence.production, false);
const localEvidenceCommit = spawnSync("git", ["cat-file", "-e", `${contract.localTestnetEvidence.sourceCommit}^{commit}`], { cwd: root });
assert.equal(localEvidenceCommit.status, 0, "local Testnet evidence sourceCommit must identify an existing commit");

assert.equal(contract.sharedTestnetAcceptance.schemaVersion, 1);
assert.equal(contract.sharedTestnetAcceptance.evidenceClass, "shared-testnet-owner-attestation-validation");
assert.equal(contract.sharedTestnetAcceptance.sourceCommit, "e1271acfb6b0959b1cfd11ce7b9144d66e1edec8");
assert.equal(contract.sharedTestnetAcceptance.schema, sharedTestnetSchemaPath);
assert.equal(contract.sharedTestnetAcceptance.ownerSourceCommitModel, "independent-consumer-commit-per-owner");
assert.equal(contract.sharedTestnetAcceptance.signatureAlgorithm, "ed25519");
assert.equal(contract.sharedTestnetAcceptance.canonicalAttestationOrderRequired, true);
assert.deepEqual(contract.sharedTestnetAcceptance.policyBounds, {
  maximumClockSkewSeconds: 300,
  minimumAllowedMaxProofAgeSeconds: 60,
  maximumAllowedMaxProofAgeSeconds: 86400,
});
assert.deepEqual(contract.sharedTestnetAcceptance.requiredOwners, ["01 Chain Core", "12 Explorer", "13 Monitor", "26 Data Fabric", "29 Integration"]);
assert.deepEqual(contract.sharedTestnetAcceptance.requiredReleaseStates, {
  implementedLocal: true,
  testedLocal: true,
  installedLocal: true,
  integratedCentral: true,
  deployedStaging: true,
  deployedPublic: false,
  downloadHosted: false,
  productionSigned: false,
  storeReleased: false,
});
for (const key of ["acceptedEvidenceAttached", "integratedCentral", "deployedStaging", "sharedTestnetEvidence", "publicDeployment", "production"]) {
  assert.equal(contract.sharedTestnetAcceptance[key], false, `${key} must remain false without direct owner evidence`);
}
const sharedAcceptanceCommit = spawnSync("git", ["cat-file", "-e", `${contract.sharedTestnetAcceptance.sourceCommit}^{commit}`], { cwd: root });
assert.equal(sharedAcceptanceCommit.status, 0, "shared Testnet acceptance sourceCommit must identify an existing commit");
assert.equal(sharedTestnetSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(sharedTestnetSchema.properties.schemaVersion.const, 1);
assert.equal(sharedTestnetSchema.properties.contractId.const, contract.contractId);
assert.equal(sharedTestnetSchema.properties.sharedTestnet.const, true);
assert.equal(sharedTestnetSchema.properties.publicDeployment.const, false);
assert.equal(sharedTestnetSchema.properties.production.const, false);
assert.equal(sharedTestnetSchema.properties.attestations.minItems, 5);
assert.equal(sharedTestnetSchema.properties.attestations.maxItems, 5);
assert.deepEqual(sharedTestnetSchema.properties.attestations.prefixItems.map((entry) => entry.$ref), [
  "#/$defs/chainCoreAttestation",
  "#/$defs/explorerAttestation",
  "#/$defs/monitorAttestation",
  "#/$defs/dataFabricAttestation",
  "#/$defs/integrationAttestation",
]);

const eventTypes = contract.canonicalEvents.map((event) => event.type);
assert.equal(new Set(eventTypes).size, eventTypes.length, "canonical event types must be unique");
for (const event of contract.canonicalEvents) {
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.owner, "17 Economics");
  assert.ok(event.type.startsWith("ynx."));
  assert.ok(event.consumers.length > 0);
}
assert.equal(new Set(contract.errorCodes).size, contract.errorCodes.length, "error codes must be unique");
for (const code of contract.errorCodes) {
  assert.ok(code.startsWith("YNX_"), `non-canonical error code: ${code}`);
}

for (const requiredPath of [
  contractPath,
  vectorsPath,
  "docs/integration/INTEGRATION_HANDOFF.md",
  "docs/integration/DEPENDENCY_ACCEPTANCE.md",
  "economics/examples/runtime-replay.json",
  "economics/examples/staking-risk-runtime-replay.json",
  "internal/economics/integration_adapter.go",
  "cmd/ynx-economics-integration/main.go",
  "internal/economics/integration_store.go",
  "cmd/ynx-economics-integration-store/main.go",
  "scripts/verify/economics-integration-store-check.mjs",
  "internal/economics/local_testnet_evidence.go",
  "cmd/ynx-economics-local-testnet-evidence/main.go",
  "scripts/verify/economics-local-testnet-evidence-check.mjs",
  "internal/economics/shared_testnet_acceptance.go",
  "internal/economics/shared_testnet_acceptance_test.go",
  sharedTestnetSchemaPath,
  "evidence/economics/integration-bundle-72591ce.json",
  "evidence/economics/integration-store-72591ce.json",
]) {
  assert.ok(fs.existsSync(path.join(root, requiredPath)), `missing integration artifact: ${requiredPath}`);
}

const vectorById = new Map(vectors.vectors.map((vector) => [vector.id, vector]));
assert.equal(vectorById.size, vectors.vectors.length, "test vector ids must be unique");

function runJSON(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || `${command} failed`);
  return JSON.parse(result.stdout);
}

const economicsVector = vectorById.get("economics-runtime-replay-v1");
assert.ok(economicsVector);
const economicsState = runJSON("go", ["run", "./cmd/ynx-economics-runtime", "-input", economicsVector.input]);
assert.equal(economicsState.schemaVersion, economicsVector.expected.schemaVersion);
assert.equal(economicsState.stateVersion, economicsVector.expected.stateVersion);
assert.equal(economicsState.lastEpoch, economicsVector.expected.lastEpoch);
assert.equal(economicsState.genesisSupplyYnxt, economicsVector.expected.genesisSupplyYnxt);
assert.equal(economicsState.cumulativeIssuanceYnxt, economicsVector.expected.cumulativeIssuanceYnxt);
assert.equal(economicsState.cumulativeBurnYnxt, economicsVector.expected.cumulativeBurnYnxt);
assert.equal(economicsState.totalSupplyYnxt, economicsVector.expected.totalSupplyYnxt);
assert.equal(economicsState.stateHash, economicsVector.expected.stateHash);
assert.deepEqual(economicsState.economicEvents.map((event) => event.id), economicsVector.expected.eventIds);
assert.deepEqual(economicsState.economicEvents.map((event) => event.auditHash), economicsVector.expected.eventAuditHashes);

const stakingVector = vectorById.get("staking-risk-slash-recovery-v1");
assert.ok(stakingVector);
const stakingState = runJSON("go", ["run", "./cmd/ynx-staking-risk-runtime", "-input", stakingVector.input]);
assert.equal(stakingState.schemaVersion, stakingVector.expected.schemaVersion);
assert.equal(stakingState.stateVersion, stakingVector.expected.stateVersion);
assert.equal(stakingState.validators[0].status, stakingVector.expected.finalValidatorStatus);
assert.equal(stakingState.events[0].openingExposureYnxt, stakingVector.expected.openingExposureYnxt);
assert.equal(stakingState.events[0].totalSlashYnxt, stakingVector.expected.totalSlashYnxt);
assert.equal(stakingState.events[0].closingExposureYnxt, stakingVector.expected.closingExposureYnxt);
assert.equal(stakingState.events[0].verifiedSignatures, stakingVector.expected.verifiedSignatures);
assert.equal(stakingState.events[0].threshold, stakingVector.expected.threshold);
assert.equal(stakingState.events[0].id, stakingVector.expected.slashEventId);
assert.equal(stakingState.events[0].auditHash, stakingVector.expected.slashAuditHash);
assert.equal(stakingState.events[1].id, stakingVector.expected.recoveryEventId);
assert.equal(stakingState.events[1].auditHash, stakingVector.expected.recoveryAuditHash);
assert.equal(stakingState.stateHash, stakingVector.expected.stateHash);

const integrationVector = vectorById.get("economics-integration-bundle-v1");
assert.ok(integrationVector);
assert.equal(integrationVector.sourceCommit, contract.sourceCommit);
const integrationSummary = runJSON("go", [
  "run",
  "./cmd/ynx-economics-integration",
  "-economics-input",
  integrationVector.economicInput,
  "-staking-input",
  integrationVector.stakingInput,
  "-source-commit",
  integrationVector.sourceCommit,
  "-summary",
]);
assert.deepEqual(integrationSummary, integrationVector.expected);
assert.equal(integrationSummary.bundleHash, contract.integrationAdapter.bundleHash);
assert.equal(integrationSummary.economicStateHash, contract.integrationAdapter.economicStateHash);
assert.equal(integrationSummary.stakingStateHash, contract.integrationAdapter.stakingStateHash);
assert.equal(integrationSummary.envelopeCount, contract.integrationAdapter.counts.canonicalEnvelopes);
assert.equal(integrationSummary.billingCount, contract.integrationAdapter.counts.billingLedgerEntries);
assert.equal(integrationSummary.explorerCount, contract.integrationAdapter.counts.explorerProjections);
assert.equal(integrationSummary.monitorCount, contract.integrationAdapter.counts.monitorChecks);
assert.deepEqual(integrationSummary.releaseStates, contract.releaseStates);

const storeVector = vectorById.get("economics-integration-store-v1");
assert.ok(storeVector);
assert.equal(storeVector.sourceCommit, contract.sourceCommit);
assert.equal(storeVector.expected.schemaVersion, contract.integrationStore.schemaVersion);
assert.equal(storeVector.expected.contractId, contract.contractId);
assert.equal(storeVector.expected.revision, contract.integrationStore.revision);
assert.equal(storeVector.expected.acceptedBundles, contract.integrationStore.acceptedBundles);
assert.equal(storeVector.expected.bundleHash, contract.integrationStore.bundleHash);
assert.equal(storeVector.expected.storeStateHash, contract.integrationStore.storeStateHash);
assert.deepEqual(storeVector.expected.recordCounts, {
  envelopes: contract.integrationStore.recordCounts.canonicalEnvelopes,
  billingLedger: contract.integrationStore.recordCounts.billingLedgerEntries,
  explorer: contract.integrationStore.recordCounts.explorerProjections,
  monitor: contract.integrationStore.recordCounts.monitorChecks,
});
assert.equal(storeVector.expected.firstApply, true);
assert.equal(storeVector.expected.secondApplyIdempotent, true);
assert.equal(storeVector.expected.fileMode, contract.integrationStore.fileMode);
assert.equal(storeVector.expected.centralAcceptance, false);
assert.equal(storeVector.expected.sharedTestnet, false);
assert.equal(storeVector.expected.publicDeployment, false);
assert.equal(storeVector.expected.production, false);

const localEvidenceVector = vectorById.get("economics-local-testnet-evidence-v1");
assert.ok(localEvidenceVector);
assert.equal(localEvidenceVector.sourceCommit, contract.localTestnetEvidence.sourceCommit);
assert.equal(localEvidenceVector.storeSourceCommit, contract.sourceCommit);
assert.equal(localEvidenceVector.expected.schemaVersion, contract.localTestnetEvidence.schemaVersion);
assert.equal(localEvidenceVector.expected.evidenceClass, contract.localTestnetEvidence.evidenceClass);
assert.equal(localEvidenceVector.expected.transactionId, contract.localTestnetEvidence.fixture.transactionId);
assert.equal(localEvidenceVector.expected.blockHeight, contract.localTestnetEvidence.fixture.blockHeight);
assert.equal(localEvidenceVector.expected.blockHash, contract.localTestnetEvidence.fixture.blockHash);
assert.equal(localEvidenceVector.expected.receiptStatus, contract.localTestnetEvidence.fixture.receiptStatus);
assert.equal(localEvidenceVector.expected.finality, contract.localTestnetEvidence.fixture.finality);
assert.equal(localEvidenceVector.expected.evidenceHash, contract.localTestnetEvidence.fixture.evidenceHash);
assert.equal(localEvidenceVector.expected.explorerProofs, contract.localTestnetEvidence.fixture.explorerProofs);
assert.equal(localEvidenceVector.expected.monitorProofs, contract.localTestnetEvidence.fixture.monitorProofs);
assert.equal(localEvidenceVector.expected.fileMode, "0600");
assert.equal(localEvidenceVector.expected.integratedCentral, false);
assert.equal(localEvidenceVector.expected.sharedTestnet, false);
assert.equal(localEvidenceVector.expected.publicDeployment, false);
assert.equal(localEvidenceVector.expected.production, false);

const sharedAcceptanceVector = vectorById.get("economics-shared-testnet-acceptance-validator-v1");
assert.ok(sharedAcceptanceVector);
assert.equal(sharedAcceptanceVector.sourceCommit, contract.sharedTestnetAcceptance.sourceCommit);
assert.equal(sharedAcceptanceVector.schema, contract.sharedTestnetAcceptance.schema);
assert.equal(sharedAcceptanceVector.classification, "local-validator-test-fixture-not-owner-acceptance");
assert.deepEqual(sharedAcceptanceVector.expected.requiredOwners, contract.sharedTestnetAcceptance.requiredOwners);
assert.equal(sharedAcceptanceVector.expected.ownerSourceCommitModel, contract.sharedTestnetAcceptance.ownerSourceCommitModel);
assert.equal(sharedAcceptanceVector.expected.signatureAlgorithm, contract.sharedTestnetAcceptance.signatureAlgorithm);
assert.equal(sharedAcceptanceVector.expected.canonicalAttestationOrderRequired, true);
for (const key of ["acceptedEvidenceAttached", "integratedCentral", "deployedStaging", "sharedTestnetEvidence", "publicDeployment", "production"]) {
  assert.equal(sharedAcceptanceVector.expected[key], false, `${key} cannot be claimed by the local acceptance fixture`);
}
for (const requiredNegative of ["missing-owner", "reordered-attestation", "wrong-owner-source-commit", "future-dated-proof", "missing-installedLocal", "release-state-overclaim", "payload-tamper", "evidence-tamper"]) {
  assert.ok(sharedAcceptanceVector.negativeCases.includes(requiredNegative), `missing shared Testnet negative vector: ${requiredNegative}`);
}
const sharedAcceptanceRun = spawnSync("make", ["economics-shared-testnet-acceptance-check"], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
assert.equal(sharedAcceptanceRun.status, 0, sharedAcceptanceRun.stderr || "shared Testnet acceptance verification failed");

const feeVector = vectorById.get("fee-burn-revenue-separation-v1");
assert.ok(feeVector);
const fee = feeVector.input;
const burn = fee.baseFeeBurnYnxt + fee.serviceBurnYnxt;
const revenue = fee.validatorYnxt + fee.providerYnxt + fee.protocolYnxt + fee.treasuryYnxt;
assert.equal(burn, feeVector.expected.burnYnxt);
assert.equal(revenue, feeVector.expected.revenueYnxt);
assert.equal(burn + revenue, fee.grossFeeYnxt);
assert.equal(feeVector.expected.burnClassifiedAsRevenue, false);

const releaseVector = vectorById.get("release-truth-boundary-v1");
assert.ok(releaseVector);
assert.deepEqual(releaseVector.expected, contract.releaseStates);

console.log(`economics integration contract verified: contract=${contract.contractId} source=${contract.sourceCommit} vectors=${vectors.vectors.length} economicsState=${economicsState.stateHash} stakingState=${stakingState.stateHash}`);
