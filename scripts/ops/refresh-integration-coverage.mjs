#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outputPath = path.join(root, ".ai-bridge/full-goal-coverage.json");
const acceptanceMatrixPath = path.join(root, "release/integration/acceptance-matrix.json");
const allowedStatuses = [
  "notStarted",
  "inProgress",
  "implementedLocal",
  "testedLocal",
  "integratedCentral",
  "testnetVerified",
  "publicVerified",
  "externalBlocked",
  "notApplicable",
  "verifiedComplete"
];
const args = new Set(process.argv.slice(2));
const expectedProductIds = Array.from({ length: 36 }, (_, index) => String(index + 1).padStart(2, "0"));

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout).trim());
  return String(result.stdout).trim();
}

function requirement(id, category, text, status, nextAction, options = {}) {
  return {
    id,
    category,
    requirement: text,
    applicability: "applicable",
    status,
    evidence: options.evidence ?? [],
    sourceCommit: options.sourceCommit,
    tests: options.tests ?? [],
    artifact: options.artifact ?? null,
    publicProof: options.publicProof ?? [],
    blockedBy: options.blockedBy ?? [],
    owner: "29-integration",
    nextAction,
    lastUpdated: new Date().toISOString()
  };
}

function acceptanceProductMap(products) {
  if (!Array.isArray(products)) {
    throw new Error("central acceptance matrix products must be an array");
  }
  const productMap = new Map(products.map((product) => [product.id, product]));
  const observedProductIds = [...productMap.keys()].sort();
  if (products.length !== 36 || JSON.stringify(observedProductIds) !== JSON.stringify(expectedProductIds)) {
    throw new Error("central acceptance matrix must contain each product id 01-36 exactly once");
  }
  return productMap;
}

function runSelfTest() {
  const valid = expectedProductIds.map((id) => ({ id }));
  acceptanceProductMap(valid);
  for (const invalid of [valid.slice(1), [...valid.slice(0, -1), { id: "35" }], null]) {
    let rejected = false;
    try {
      acceptanceProductMap(invalid);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("coverage refresh self-test accepted an invalid product matrix");
  }
  console.log("integration coverage refresh self-test passed");
}

if (args.has("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const head = git(["rev-parse", "HEAD"]);
if (!fs.existsSync(acceptanceMatrixPath)) {
  throw new Error(`missing required central acceptance matrix: ${path.relative(root, acceptanceMatrixPath)}`);
}
const acceptanceMatrix = JSON.parse(fs.readFileSync(acceptanceMatrixPath, "utf8"));
const productAcceptanceById = acceptanceProductMap(acceptanceMatrix.products);
const securityAcceptance = productAcceptanceById.get("30")?.centralAcceptance;
const securityIntegrated = securityAcceptance?.status === "integratedCentral"
  && typeof securityAcceptance?.acceptedSourceCommit === "string";
const globals = [
  ["INT-RECOVER-001", "recovery", "Confirm the exact Integration workspace, final branch, modes, Git state, history and direct repository evidence.", "verifiedComplete", "Repeat the takeover audit at every new session.", { evidence: ["workspace and branch matched; takeover status was clean"] }],
  ["INT-PROTECT-001", "git-protection", "Create and configure the final remote branch, preserve authoritative history, push all protected results and verify Local SHA equals Remote SHA.", "verifiedComplete", "Recheck Local and Remote SHA after every protected slice.", { evidence: ["origin/codex/final-integration created and synchronized before this implementation slice"] }],
  ["INT-CONCURRENCY-001", "concurrency", "Reject concurrent writers, test runners that commit, or push agents on the same Integration worktree.", "verifiedComplete", "Repeat the process and handoff-state check before each long write/test/push slice.", { evidence: ["no active same-worktree handoff state or matching writer was observed at takeover"] }],
  ["INT-REGISTRY-001", "central-registry", "Maintain the unique 01–36 product, owner, branch, phase and dependency registry.", "testedLocal", "Keep the registry synchronized with exact owner branches and rerun the matrix before every acceptance decision.", { evidence: ["release/integration/product-registry.json", "release/integration/acceptance-matrix.json"], tests: ["refresh-integration-acceptance --self-test", "integration-acceptance-check --self-test"], artifact: "release/integration/product-registry.json" }],
  ["INT-FREEZE-001", "protocol-freeze", "Freeze one authoritative owner and version for network, Wallet/Auth, Oracle, Bridge, Data Fabric, Quant, Economics, Governance, Security/SRE, Website and Integration.", "implementedLocal", "Bind the protected commit, then validate every Phase 0 authority bundle and record explicit conflict resolution.", { evidence: ["release/integration/integration-contract.json", "docs/integration/DEPENDENCY_ACCEPTANCE.md"], tests: ["integration-acceptance-check", "integration-acceptance-check --self-test"] }],
  ["INT-AUTH-001", "wallet-auth-gateway", "Accept only canonical Wallet/Auth, Product Registry and App Gateway contracts with replay, tamper, wrong-product, wrong-device, scope, expiry and revoke failure closure.", "notStarted", "Review 02 and rerun the central auth negative vectors.", { tests: ["CP-001", "CP-002", "CP-004", "CP-005", "CP-009"], blockedBy: ["02", "30"] }],
  ["INT-SOURCE-001", "authority-source-layering", "Require source, asOf, version, confidence or coverage and truthful failure for YNX, provider, estimate, AI and user-supplied data.", "notStarted", "Freeze source semantics across Oracle and Data Fabric.", { blockedBy: ["19", "26", "30"] }],
  ["INT-ASSET-001", "asset-boundaries", "Prove services, AI and Quant do not hold private keys, withdraw arbitrarily, change ownership or exceed mandates; preserve revoke, kill, exit and recovery.", "notStarted", "Review Wallet mandates, Exchange no-withdraw sessions and DEX vault ownership.", { tests: ["CP-004", "CP-005", "CP-012"], blockedBy: ["02", "07", "08", "27", "30"] }],
  ["INT-AI-001", "ai-boundaries", "Limit AI to advice and preview; require context consent, exact preview, approval decision, audit, provider/model/cost state and truthful failure.", "notStarted", "Review the AI approval contract and execute CP-009.", { tests: ["CP-009"], blockedBy: ["02", "14", "26", "30"] }],
  ["INT-PROVIDER-001", "providers", "Use official standards, APIs, sandboxes and SDKs where available and record terms, jurisdiction, authentication, rate limits, retention, data rights, versions, health and outage behavior.", "notStarted", "Aggregate provider registers and verify fail-closed adapters.", { blockedBy: ["14", "19", "21", "30"] }],
  ["INT-L10N-001", "localization-accessibility", "Verify 12 languages, Arabic RTL, runtime and legal semantics, keyboard, screen reader, focus, contrast, dynamic text, reduced motion, light/dark and 390px.", "notStarted", "Define and run one central locale and accessibility conformance harness.", { blockedBy: ["all product owners", "30"] }],
  ["INT-PLATFORM-001", "platform-delivery", "Verify every applicable Web, PWA, Android, iOS, macOS, Windows, CLI, SDK, Docker or Server build, install, cold start, restart, callback and signing class.", "notStarted", "Import owner platform manifests and rerun installation evidence.", { blockedBy: ["all product owners", "30"] }],
  ["INT-SLO-001", "performance-capacity", "Measure p50/p95/p99, throughput, concurrency, queues, storage growth, provider latency, rate limits, cold start, failure rate, availability, RTO and RPO.", "notStarted", "Collect comparable SLO and capacity artifacts.", { blockedBy: ["01", "13", "16", "19", "20", "26", "30"] }],
  ["INT-ECON-001", "unit-economics", "Verify per-active-user cost, provider cost, free tier, subsidy, service revenue, margin candidate and sustainability without fabricated growth.", "notStarted", "Reconcile owner economics records against Billing Ledger facts.", { blockedBy: ["16", "17", "24", "26", "30"] }],
  ["INT-MIGRATION-001", "migration-compatibility", "Verify versioned schemas, migration, old-client compatibility, deprecation and rollback migration across central contracts.", "notStarted", "Freeze schema versions and execute forward/rollback vectors.", { blockedBy: ["01", "02", "19", "21", "26", "30"] }],
  ["INT-RESTORE-001", "backup-restore", "Verify backup integrity, full restore drill, RTO/RPO and post-restore consistency; distinguish restart persistence from disaster recovery.", "notStarted", "Consume the Security/SRE restore policy and execute the shared drill.", { blockedBy: ["01", "20", "26", "30"] }],
  ["INT-OBS-001", "observability-support", "Verify structured logs, metrics, traces, request/error/audit IDs, health, ready, version, alerts, incidents, status, support, disputes and recovery.", "notStarted", "Freeze common evidence fields and run Monitor integration.", { blockedBy: ["13", "15", "26", "30"] }],
  ["INT-SEC-001", "security-supply-chain", "Verify threat model, boundaries, secret/dependency/license/SAST/DAST/artifact/container scans, SBOM, provenance, reproducibility and build-script allowlist.", securityIntegrated ? "integratedCentral" : "inProgress", securityIntegrated ? "Retain the accepted source lock and execute the separate shared-Testnet security, monitoring and recovery drills." : "Review the synchronized Security/SRE candidate contract and close its remaining autonomous coverage before central acceptance.", { evidence: ["release/integration/acceptance-matrix.json", ...(securityIntegrated ? [securityAcceptance.decisionEvidence] : [])].filter(Boolean), tests: ["npm run security:test", "npm run security:verify", "npm run security:integration", "integration-acceptance-check", "secret-scan", "static-check"], blockedBy: securityIntegrated ? [] : ["Security/SRE owner coverage still contains autonomous/open items"] }],
  ["INT-NPM-AUDIT-001", "security-supply-chain", "Enforce the remediated Hardhat dependency graph with pinned fixed versions and zero vulnerabilities in both full and production-only npm audits.", "testedLocal", "Retain the locked policy and re-evaluate default-branch alerts after the accepted remediation reaches main.", { evidence: ["release/integration/security/npm-audit-policy.json"], tests: ["integration-npm-audit-policy-check", "integration-npm-audit-policy-check-test"], artifact: "release/integration/security/npm-audit-policy.json", blockedBy: ["Security/SRE production review remains required independently of source acceptance"] }],
  ["INT-PREFLIGHT-001", "release-gates", "Run Integration acceptance, pinned contract build, full Go tests, npm audit policy, negative self-tests, placeholder scan, secret scan and static checks in the required order.", "testedLocal", "Require the same green gate on every subsequent protected source commit and in the pull-request workflow.", { evidence: ["release/integration/evidence/protect-preflight-d05ddf0a.json"], tests: ["integration-acceptance-check", "contract-tooling-check", "integration-npm-audit-policy-check", "integration-npm-audit-policy-check-test", "go test ./...", "no-placeholder-check", "secret-scan", "static-check"], artifact: "release/integration/evidence/protect-preflight-d05ddf0a.json" }],
  ["INT-FEE-001", "fees-risk-transparency", "Verify explicit fees, user-owned profit/loss, high-water-mark calculation, no fee on unrealized PnL and no hidden spread, volume, mint, burn or revenue claim.", "notStarted", "Reconcile Quant, Exchange, DEX and Economics fee authorities.", { tests: ["CP-004", "CP-005", "CP-012"], blockedBy: ["07", "08", "17", "24", "27", "30"] }],
  ["INT-PUBLIC-001", "website-public-handoff", "Verify canonical routes, metadata, FAQ, structured data, screenshots, artifact manifests, support/privacy/security/status URLs and Website versus runtime state separation.", "inProgress", "Generate Integration public metadata and require Website consumption proof.", { tests: ["CP-011"], blockedBy: ["28", "30"] }],
  ["INT-EVIDENCE-001", "evidence-release-records", "Bind acceptance, tests, receipts, CI, artifacts, installation and public probes to exact reachable source commits without stale or internal facts.", "testedLocal", "Keep every acceptance decision fail-closed against source, merge ancestry, exact-head CI and its central test receipt.", { evidence: ["scripts/ops/refresh-integration-acceptance.mjs", "release/integration/central-acceptance-decisions.json", "release/integration/github-evidence.json"], tests: ["integration-acceptance-check", "integration-acceptance-check --self-test"], artifact: "release/integration/acceptance-matrix.json" }],
  ["INT-KPI-001", "founder-kpis", "Define activation, retention, task completion, crash-free sessions, support load, abuse, provider cost, margin, Testnet usage, conversion and scale/kill decisions without fake traffic.", "notStarted", "Map KPI owners and exclude internal test traffic.", { blockedBy: ["13", "24", "26", "28", "30"] }],
  ["INT-INPUTS-001", "operator-inputs", "Deduplicate true external inputs and request only minimum permissions through safe channels without collecting secrets in chat.", "notStarted", "Aggregate 01–36 input records after autonomous work is complete.", { blockedBy: ["product owner input records not yet aggregated"] }],
  ["INT-PHASE-001", "phase-state-machine", "Enforce RECOVER, PROTECT, FREEZE, INTEGRATE, TESTNET, PUBLIC and EXPAND in order without skipped gates.", "inProgress", "Complete PROTECT verification before promoting the controller gate to FREEZE.", { evidence: ["release/integration/integration-contract.json"] }],
  ["INT-CROSS-DEFINITION-001", "cross-product-testnet", "Define mandatory happy, fail-closed and required-evidence vectors for Wallet, Pay, Shop, Quant, DEX, Finance, Cloud, Resource, AI, Governance, Website and capital safety.", "implementedLocal", "Bind the protected commit, rerun exact-commit validation and keep vectors synchronized with accepted contracts.", { evidence: ["docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"], tests: ["integration-acceptance-check", "integration-acceptance-check --self-test"] }],
  ["INT-CROSS-001", "cross-product-testnet", "Execute mandatory Wallet, Pay, Shop, Quant, DEX, Finance, Cloud, Resource, AI, Governance, Website and capital-safety flows.", "notStarted", "Execute CP-001 through CP-012 after Phase 0 acceptance.", { evidence: ["docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"], tests: ["CP-001 through CP-012"], blockedBy: ["product owner contracts", "30"] }],
  ["INT-QUANT-001", "unique-quant-engine", "Prove one Quant Engine across Web/Desktop/Docker/SDK, Exchange, DEX, Paper/Shadow, mandates, independent risk, Explorer, Monitor, Finance, AI, Trust, Resource, Cloud, Mail and Website.", "notStarted", "Review 08 as the sole engine owner and reject duplicate engines.", { tests: ["CP-004", "CP-005"], blockedBy: ["02", "07", "08", "13", "15", "16", "19", "20", "24", "25", "26", "27", "28", "30"] }],
  ["INT-CAPITAL-001", "capital-safety", "Verify solvency, withdrawal capacity, oracle freshness, bridge exposure, stablecoin reserve/redemption, treasury runway, insurance, integrity, liquidity, provider risk and user exit.", "notStarted", "Freeze evidence contracts and execute fail-closed shortfall and exit drills.", { tests: ["CP-012"], blockedBy: ["01", "07", "13", "15", "17", "19", "21", "24", "26", "27", "30", "31"] }],
  ["INT-GITHUB-001", "github-release-artifacts", "Inventory final branches, upstreams, Actions, Releases and Artifacts and distinguish preview, test, unsigned and simulator classes from production.", "inProgress", "Generate source-bound GitHub evidence and require CI on the Integration branch.", { artifact: "release/integration/github-evidence.json" }],
  ["INT-PUBLICNET-001", "public-testnet", "Verify four-node BFT, Faucet, sponsored smart account, Exchange and DEX users, Quant PnL/risk/kill/exit, Pay/refund/webhook, Shop, Social E2EE, Cloud/Resource, AI truth, Trust, downloads, cross-region, restore and rollback.", "notStarted", "Start only after FREEZE and INTEGRATE gates pass.", { blockedBy: ["Phase 0 acceptance", "30", "external public infrastructure"] }],
  ["INT-SEO-001", "seo-brand", "Verify YNX, YNX Chain, YNX Web4, YNXWeb4, YNXT and 6423 consistency, indexability, sitemap, JSON-LD, Search Console, Bing and IndexNow without equating submission with ranking.", "notStarted", "Consume Website evidence and record observed indexing separately.", { blockedBy: ["18", "28", "30", "search verification access"] }],
  ["INT-MAINNET-001", "mainnet-separation", "Keep Mainnet as an independent later gate that Testnet cannot automatically promote.", "verifiedComplete", "Retain false production states until independent Mainnet evidence exists.", { evidence: ["release/integration/integration-contract.json"] }],
  ["INT-FINAL-001", "final-preflight", "Run complete tests, build, smoke, security, migration, restore, artifact, public and remote evidence; push the exact final SHA and verify a clean worktree.", "notStarted", "Execute only after every autonomous item is closed or truly externally blocked.", { blockedBy: ["all prior coverage items"] }]
];

const productNames = [
  "YNX Chain Core / StreamBFT", "YNX Wallet / Auth", "YNX Social", "YNX Pay", "Merchant Console", "YNX Card",
  "YNX Exchange", "YNX Quant Lab", "YNX Shop", "Seller Console", "YNX Developer / AI Build", "YNX Explorer",
  "YNX Monitor", "YNX AI", "YNX Trust Center", "YNX Resource Market", "YNXT Economics / Treasury / Stablecoin",
  "Whitepaper / Compliance / Brand", "YNX Oracle & Market Data", "YNX Cloud", "YNX Bridge & Interoperability",
  "YNX Browser", "YNX Search", "YNX Finance", "YNX Mail", "YNX Data Fabric & Billing Ledger", "YNX DEX",
  "YNX Website / SEO / Product Micro-sites", "YNX Integration / Founder Control", "YNX Security / SRE", "YNX Governance",
  "YNX Music", "YNX Video", "YNX Creator Studio", "YNX Docs", "YNX Calendar"
];

const items = globals.map(([id, category, text, status, nextAction, options]) => requirement(id, category, text, status, nextAction, { ...options, sourceCommit: head }));
for (let index = 0; index < productNames.length; index += 1) {
  const id = String(index + 1).padStart(2, "0");
  const observed = productAcceptanceById.get(id);
  const acceptedSourceCommit = observed?.centralAcceptance?.acceptedSourceCommit ?? null;
  const observedStatus = observed?.centralAcceptance?.status;
  const status = acceptedSourceCommit
    ? "integratedCentral"
    : (allowedStatuses.includes(observedStatus) ? observedStatus : "notStarted");
  const evidencePaths = observed?.evidence?.paths && typeof observed.evidence.paths === "object"
    ? Object.values(observed.evidence.paths).filter((value) => typeof value === "string")
    : [];
  const blockers = Array.isArray(observed?.blockers) && observed.blockers.length > 0
    ? observed.blockers
    : (observed ? [] : ["central acceptance row unavailable"]);
  items.push(requirement(
    `INT-PRODUCT-${id}`,
    "product-acceptance",
    `Accept ${id} ${productNames[index]} only after its exact final branch, owner bundle, central tests, dependency contracts, artifact class and public state pass all applicable gates.`,
    status,
    observed?.nextAction ?? "Generate the exact central acceptance row before promotion.",
    {
      sourceCommit: head,
      evidence: ["release/integration/acceptance-matrix.json", ...evidencePaths],
      tests: [`central acceptance row ${id}`],
      blockedBy: blockers
    }
  ));
}

const document = {
  schemaVersion: "1.0.0",
  owner: "29-integration",
  product: "YNX Integration / Founder Control",
  sourceCommit: head,
  allowedStatuses,
  items
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${path.relative(root, outputPath)} with ${items.length} coverage items at ${head}`);
