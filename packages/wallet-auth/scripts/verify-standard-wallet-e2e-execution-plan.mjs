#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const plan = await readJson("release/integration/wallet-standard-wallet-e2e-execution-plan-p0-20260822.json");
const matrix = await readJson("release/integration/wallet-authorize-ecosystem-owner-runtime-matrix-v3-20260821.json");
const contract = await readJson("release/integration/wallet-standard-connection-conformance-contract-p0-20260822.json");
const responsibilityRegistry = await readJson("release/integration/wallet-ecosystem-responsibility-registry-p0-20260822.json");
const expectedProducts = ["calendar", "card", "creator-studio", "developer", "dex", "exchange", "finance", "pay", "quant", "shop", "social", "video"];
const expectedResponsibilityDomains = [
  "chain-core", "wallet-auth", "social", "pay", "merchant-console", "card", "exchange", "quant", "shop", "seller-console", "developer", "explorer", "monitor", "ai", "trust-center", "resource-market", "tokenomics", "whitepaper-compliance-brand", "oracle-market-data", "cloud", "bridge", "browser", "search", "finance", "mail", "data-fabric", "dex", "website", "integration", "security-sre-release", "governance", "music", "video", "creator-studio", "docs", "calendar"
];
const allowedResponsibilityClassifications = new Set(["interactiveWalletConsumer", "nonInteractiveProductSessionConsumer", "evidenceBackedNotApplicable"]);
const expectedCentralOwnerThreads = new Map([
  ["merchant-console", "6a676507-f814-83ec-b923-835e4238650e"],
  ["seller-console", "6a6765b8-9048-83ec-978a-9ea4a83e58d7"],
  ["trust-center", "6a676632-ab30-83ec-85f6-eb83b1035012"],
  ["search", "6a6766b9-2710-83ec-bf3f-c5d1d92f7f70"],
  ["mail", "6a6766d9-b494-83ec-93c5-6ef59d7ff102"],
  ["ai", "6a676622-589c-83ec-8036-81c2d2726ed9"],
  ["cloud", "6a676681-f7dc-83ec-9bb4-80c94c11d073"],
  ["resource-market", "6a67663f-5b50-83ec-bb88-56ddd786a4a5"],
  ["governance", "6a643fda-1e30-83ec-9282-a265ca9df8c3"],
  ["music", "6a676759-c080-83ec-bbab-80d0fe22aaaf"],
  ["bridge", "6a676692-8348-83ec-9209-6aff9ee89f6b"],
  ["browser", "6a6766a3-a6c8-83ec-ae21-a10df9762602"],
  ["docs", "6a67678c-1d78-83ec-8946-d51cf012714d"],
  ["explorer", "01a00020-1150-73c3-ab41-9b776db3b2a7"],
  ["monitor", "01a00020-1150-73c3-ab41-9b776db3b2a7"]
]);
const expectedFirstWaveAuditDomains = ["merchant-console", "seller-console", "trust-center", "search", "mail", "ai", "cloud", "resource-market", "governance", "music", "bridge", "browser", "docs", "explorer", "monitor", "card"];
const expectedScenarios = ["discovery", "approve-reject", "chain", "sign-and-send", "lifecycle", "product-session-boundary", "walletconnect-v2"];
const findings = [];

if (plan.version !== "standardWalletE2EExecution@1.0.0-p0.0") findings.push("unexpected execution-plan version");
if (plan.authoritativeInputs?.standardConnectionContract?.version !== contract.version) findings.push("execution plan does not bind the accepted conformance contract version");
if (plan.authoritativeInputs?.sharedProvider?.commit !== contract.authoritativeInputs?.sharedProvider?.commit || plan.authoritativeInputs?.sharedProvider?.tree !== contract.authoritativeInputs?.sharedProvider?.tree) findings.push("execution plan does not bind the exact shared Provider source");
if (plan.authoritativeInputs?.ecosystemResponsibilityRegistry?.path !== "release/integration/wallet-ecosystem-responsibility-registry-p0-20260822.json" || plan.authoritativeInputs?.ecosystemResponsibilityRegistry?.responsibilityDomainDenominator !== 36) findings.push("execution plan does not bind the 36-domain responsibility registry");
if (JSON.stringify(plan.invariants?.connectionSuccess) !== JSON.stringify(contract.layering?.successCondition)) findings.push("connection success condition drift");
if (plan.invariants?.rpcBoundary?.includes("never a connection prerequisite") !== true) findings.push("CORS-disabled RPC boundary is not explicit");
if (plan.invariants?.webTransport?.includes("iframe launcher") !== true || plan.invariants?.webTransport?.includes("blank top-level target") !== true) findings.push("no-blank-tab Web transport boundary is incomplete");
if (plan.invariants?.layer1Independence?.includes("PRIVATE_SERVICE_DEGRADED") !== true) findings.push("Layer 1 degradation boundary is incomplete");

const scenarioIds = plan.realE2EScenarios?.map(({ id }) => id) ?? [];
for (const id of expectedScenarios) if (!scenarioIds.includes(id)) findings.push(`missing required E2E scenario ${id}`);
if (plan.dappCoverage?.firstParty?.id !== "ynx-first-party") findings.push("missing first-party DApp profile");
const external = plan.dappCoverage?.external?.map(({ id }) => id) ?? [];
for (const id of ["uniswap-interface-reference", "opensea-reference", "safe-reference"]) if (!external.includes(id)) findings.push(`missing external DApp profile ${id}`);
if (plan.dappCoverage?.requirement?.includes("separately opened") !== true) findings.push("external DApps are not required to be independently opened");

const dispatch = plan.ownerDispatch ?? [];
const dispatchIds = dispatch.map(({ productId }) => productId).sort();
if (JSON.stringify(dispatchIds) !== JSON.stringify(expectedProducts)) findings.push("owner dispatch does not cover exactly the registered 12 products");
for (const row of dispatch) {
  if (!row.owner || !Array.isArray(row.nextE2E) || row.nextE2E.length < 3) findings.push(`incomplete owner dispatch for ${row.productId}`);
}
const matrixIds = (matrix.registeredProducts ?? []).map(({ productId }) => productId).sort();
if (JSON.stringify(matrixIds) !== JSON.stringify(expectedProducts)) findings.push("matrix does not contain exactly the execution-plan product set");
if (matrix.standardWalletE2EExecution?.plan !== "release/integration/wallet-standard-wallet-e2e-execution-plan-p0-20260822.json") findings.push("matrix does not bind the E2E execution plan");
if (matrix.counts?.productsConnected !== 0 || matrix.counts?.productsMigratedV2 !== 0 || plan.truth?.productsConnected !== 0 || plan.truth?.productsMigratedV2 !== 0) findings.push("unproven product completion was promoted");
if (plan.truth?.realDappDirectRuntimeCount !== 0 || plan.truth?.walletConnectRealRelay !== false || plan.truth?.installedWalletApproved !== false) findings.push("unproven direct E2E truth was promoted");

if (responsibilityRegistry.authorityCatalog?.kind !== "YNX 01-36 responsibility domains" || responsibilityRegistry.authorityCatalog?.count !== 36) findings.push("responsibility registry does not bind the 01-36 authority catalog");
if (responsibilityRegistry.authoritativeE2EGate?.commit !== "875be208e8a7ddb60345d55b93fc299949664e5c" || responsibilityRegistry.authoritativeE2EGate?.tree !== "3499ddfbe2a4bb08cbbcaef8c71b911aca51dde4" || responsibilityRegistry.authoritativeE2EGate?.directE2EProductSubset !== 12) findings.push("responsibility registry does not retain the exact 875be208 direct-E2E gate");
if (JSON.stringify(responsibilityRegistry.classificationValues) !== JSON.stringify([...allowedResponsibilityClassifications])) findings.push("responsibility registry classification vocabulary drift");
const responsibilityRows = responsibilityRegistry.domains ?? [];
const responsibilityIds = responsibilityRows.map(({ domainId }) => domainId);
if (responsibilityRows.length !== 36 || JSON.stringify(responsibilityIds) !== JSON.stringify(expectedResponsibilityDomains)) findings.push("responsibility registry must contain the exact ordered 36-domain catalog");
if (new Set(responsibilityIds).size !== responsibilityIds.length) findings.push("responsibility registry contains duplicate domains");
for (const row of responsibilityRows) {
  if (!row.owner || !allowedResponsibilityClassifications.has(row.classification) || row.dispatch !== "central-orchestrator") findings.push(`invalid responsibility routing for ${row.domainId}`);
  if (row.directE2E !== false || row.aggregateComplete !== false) findings.push(`unproven responsibility completion was promoted for ${row.domainId}`);
  if (row.catalogNumber !== expectedResponsibilityDomains.indexOf(row.domainId) + 1) findings.push(`catalog number drift for ${row.domainId}`);
}
for (const [domainId, ownerThread] of expectedCentralOwnerThreads) {
  const row = responsibilityRows.find((candidate) => candidate.domainId === domainId);
  if (!row || row.ownerThread !== ownerThread || row.ownerBranch !== null || !Array.isArray(row.ownedPaths) || row.ownedPaths.length !== 0 || row.mappingFrozen !== false) findings.push(`central audit mapping is not pending-frozen for ${domainId}`);
}
for (const domainId of ["explorer", "monitor"]) {
  const row = responsibilityRows.find((candidate) => candidate.domainId === domainId);
  if (row?.classification !== "interactiveWalletConsumer" || row?.auditFrozen !== true || row?.auditRequestHead !== "5f430a4642ee93e59604dd6a2ab5f2ea5af67378" || row?.auditCandidateCommit !== "49cbb150" || !row.publicBoundary?.includes("guest read") || !row.publicBoundary?.includes("interactive Wallet consumer")) findings.push(`${domainId} guest-versus-privileged Wallet routing boundary is incomplete`);
}
const classificationCounts = responsibilityRows.reduce((counts, { classification }) => ({ ...counts, [classification]: (counts[classification] ?? 0) + 1 }), {});
const aggregate = responsibilityRegistry.aggregate ?? {};
if (aggregate.responsibilityDomainDenominator !== 36 || aggregate.interactiveWalletConsumerDenominator !== classificationCounts.interactiveWalletConsumer || aggregate.nonInteractiveProductSessionConsumerDenominator !== classificationCounts.nonInteractiveProductSessionConsumer || aggregate.evidenceBackedNotApplicableDenominator !== classificationCounts.evidenceBackedNotApplicable) findings.push("responsibility aggregate denominators do not match the classified 36-domain catalog");
if (aggregate.directE2ECompleteDomains !== 0 || aggregate.aggregateCompleteDomains !== 0 || aggregate.productsConnected !== 0 || aggregate.productsMigratedV2 !== 0 || aggregate.aggregateComplete !== false) findings.push("unproven 36-domain aggregate completion was promoted");
if (responsibilityRegistry.truth?.centralOrchestratorDispatchRequired !== true || responsibilityRegistry.truth?.ownerDispatchPerformedByProtocolOwner !== false || responsibilityRegistry.truth?.directRuntimeEvidenceComplete !== false || responsibilityRegistry.truth?.installedOrPublicParityComplete !== false) findings.push("responsibility registry truth gates drift");
const auditFacts = responsibilityRegistry.ownerAuditFacts ?? {};
if (auditFacts.routingOnly !== true || auditFacts.auditRound !== "2026-08-22-first-wave" || !auditFacts.rule?.includes("never promote")) findings.push("first-wave owner audit is not constrained to routing facts");
if (JSON.stringify(Object.keys(auditFacts).filter((key) => !["routingOnly", "auditRound", "rule"].includes(key)).sort()) !== JSON.stringify([...expectedFirstWaveAuditDomains].sort())) findings.push("first-wave owner audit coverage drift");
for (const domainId of expectedFirstWaveAuditDomains) if (auditFacts[domainId]?.runtimePromoted !== false) findings.push(`owner audit must not promote runtime for ${domainId}`);
if (auditFacts["merchant-console"]?.blocker !== "CENTRAL_CALLBACK_AND_SESSION_MISSING") findings.push("merchant routing blocker drift");
if (auditFacts["seller-console"]?.reportedSourceCommit !== "88c0f3a5" || auditFacts["seller-console"]?.integratedCentral !== false || auditFacts["seller-console"]?.walletRegisteredDeployed !== false) findings.push("seller audit boundary drift");
if (auditFacts.ai?.walletAuthIntegratedCentral !== false || auditFacts.cloud?.publicRuntime !== false || auditFacts["resource-market"]?.sourceState !== "LOCAL_CANDIDATE" || auditFacts.governance?.sourceState !== "SOURCE_ONLY" || auditFacts.bridge?.sourceState !== "LOCAL_ONLY" || auditFacts.docs?.appsDocsOwnership !== "UNRESOLVED") findings.push("first-wave source-only audit boundary drift");
if (auditFacts.explorer?.auditState !== "TERMINAL_ROUTING_ONLY" || auditFacts.explorer?.privilegedWalletClassification !== "interactiveWalletConsumer" || auditFacts.explorer?.privilegedWalletEvidence !== false || auditFacts.monitor?.auditState !== "TERMINAL_ROUTING_ONLY" || auditFacts.monitor?.privilegedWalletClassification !== "interactiveWalletConsumer" || auditFacts.monitor?.legacyWalletPath !== "top-level ynx-wallet:// plus handwritten signature paste" || auditFacts.monitor?.deploymentBlocker !== "CADDY_CONNECTIVITY_MATCHER_MISSING" || auditFacts.monitor?.publicVerified !== false || auditFacts.monitor?.privilegedWalletEvidence !== false) findings.push("Explorer/Monitor terminal guest-versus-privileged audit drift");
if (auditFacts.card?.auditState !== "P0_195_DEPLOY_FAILED_CLOSED" || auditFacts.card?.candidateArtifactHashesMatched !== 12 || auditFacts.card?.failure !== "VERCEL_FIXED_OUTPUT_DIRECTORY_DIST_WEB_CONFLICTS_WITH_UPLOADED_STATIC_ROOT" || auditFacts.card?.retryAllowed !== false || auditFacts.card?.currentRollbackDeploymentPrefix !== "dpl_DqMu" || auditFacts.card?.publicHashesUnchanged !== true || auditFacts.card?.nextOwnerAction !== "CARD_OWNED_NESTED_DEPLOYMENT_ENVELOPE_WITHOUT_VERCEL_SETTING_CHANGE") findings.push("Card P0-195 fail-closed deployment audit drift");

if (findings.length) {
  console.error(`Standard Wallet E2E execution-plan gate failed:\n${findings.map((item) => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else console.log(`Standard Wallet E2E execution-plan gate passed for ${dispatch.length} direct-E2E products and ${responsibilityRows.length} responsibility domains`);

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(repoRoot, relativePath), "utf8"));
}
