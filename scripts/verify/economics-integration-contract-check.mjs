import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJSON = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const contractPath = "release/integration/ynxt-economics-contract.json";
const vectorsPath = "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json";
const contract = readJSON(contractPath);
const vectors = readJSON(vectorsPath);

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
