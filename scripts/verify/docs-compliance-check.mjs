#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const required = [
  "docs/whitepaper/YNX_CHAIN_WHITEPAPER.md",
  "docs/whitepaper/STREAMBFT_SPECIFICATION.md",
  "docs/whitepaper/EXECUTION_AND_LOCAL_FEE_MARKETS.md",
  "docs/whitepaper/TRADING_CORE_ULTRALIQUIDITY_FAIRFLOW.md",
  "docs/economics/YNXT_TOKENOMICS.md",
  "docs/economics/STAKING_LIQUID_STAKING_SAFETY_MODULE.md",
  "docs/stablecoin/STABLECOIN_RESERVE_REDEMPTION.md",
  "docs/economics/TREASURY_REVENUE_BURN.md",
  "docs/economics/PROOF_OF_SOLVENCY.md",
  "docs/architecture/WALLET_AUTH_SMART_ACCOUNT_STRATEGY_MANDATE.md",
  "docs/quant/QUANT_ARCHITECTURE_ASSET_BOUNDARY_FEES_RISKS.md",
  "docs/bridge/BRIDGE_ORACLE_DATA_FABRIC.md",
  "docs/security/SECURITY_PRIVACY_AI_GOVERNANCE.md",
  "docs/trust/TRUST_APPEALS_MARKET_INTEGRITY.md",
  "docs/legal/TERMS_OF_USE_DRAFT.md",
  "docs/legal/PRIVACY_NOTICE_DRAFT.md",
  "docs/legal/ACCEPTABLE_USE_POLICY_DRAFT.md",
  "docs/public/MARKETING_CLAIMS_EVIDENCE_MATRIX.md",
  "docs/public/PRESS_KIT.md",
  "docs/public/BRAND_GUIDE.md",
  "docs/public/FAQ.md",
  "docs/public/SUPPORT_AND_DISPUTES.md",
  "docs/public/INCIDENT_COMMUNICATION.md",
  "docs/public/LAUNCH_PLAN.md",
  "docs/legal/LEGAL_REVIEW_PACKET.md",
  "docs/operations/SLO_CAPACITY_PLAN.md",
  "docs/economics/UNIT_ECONOMICS.md",
  "docs/operations/MIGRATION_COMPATIBILITY.md",
  "docs/operations/OBSERVABILITY.md",
  "docs/acceptance/FEATURE_COMPLETION_EVIDENCE.md",
  "docs/acceptance/EVIDENCE_INDEX.md",
  "docs/acceptance/UI_DESIGN_AUDIT.md",
  "docs/acceptance/RELEASE_NOTES.md",
  "docs/acceptance/OPERATIONS.md",
  "release/public-product-metadata.json",
  "release/product-release.json",
  "release/operator-inputs.request.json",
  "release/facts/authoritative-facts.json",
  "release/schemas/public-record.schema.json",
  "release/schemas/authoritative-facts.schema.json",
  "release/schemas/claims-matrix.schema.json",
  "release/document-metadata-inventory.json",
  "release/evidence/document-metadata-2026-07-29.json",
  "release/recovery-inventory-2026-07-25.json",
  "docs/coordination/DOCS_COMPLIANCE_INTEGRATION_MANIFEST.md",
  "scripts/verify/public-disclosure-gate.mjs",
  ".ai-bridge/full-goal-coverage.json",
  "release/integration/docs-compliance-brand-contract.json",
  "docs/integration/INTEGRATION_HANDOFF.md",
  "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json",
  "docs/integration/DEPENDENCY_ACCEPTANCE.md",
  "scripts/verify/full-goal-coverage-gate.mjs",
  "scripts/verify/document-metadata-gate.mjs"
];

const jsonFiles = [
  "docs/acceptance/DOCS_COMPLIANCE_REQUIREMENTS.json",
  "release/public-product-metadata.json",
  "release/product-release.json",
  "release/operator-inputs.request.json",
  "release/structured-data-suggestions.json",
  "release/evidence/website-public-acceptance-2026-07-26.json",
  "release/evidence/local-read-benchmark-2026-07-22.json",
  "release/evidence/supply-chain-2026-07-22.json",
  "release/sbom-npm.cdx.json",
  "release/go-module-inventory.json",
  "release/facts/authoritative-facts.json",
  "release/document-metadata-inventory.json",
  "release/evidence/document-metadata-2026-07-29.json",
  "release/recovery-inventory-2026-07-25.json",
  ".ai-bridge/full-goal-coverage.json",
  "release/integration/docs-compliance-brand-contract.json",
  "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"
];

const failures = [];
for (const file of required) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) failures.push(`missing or empty: ${file}`);
}
for (const file of jsonFiles) {
  try { JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { failures.push(`invalid JSON ${file}: ${error.message}`); }
}

const release = JSON.parse(fs.readFileSync("release/product-release.json", "utf8"));
const publicMetadata = JSON.parse(fs.readFileSync("release/public-product-metadata.json", "utf8"));
const operatorInputs = JSON.parse(fs.readFileSync("release/operator-inputs.request.json", "utf8"));
const websiteHandoff = fs.readFileSync("docs/public/WEBSITE_INTEGRATION_HANDOFF.md", "utf8");
const stateKeys = ["implementedLocal", "testedLocal", "installedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"];
const expectedStates = {implementedLocal: true, testedLocal: true, installedLocal: false, integratedCentral: true, deployedStaging: true, deployedPublic: true, downloadHosted: true, productionSigned: false, storeReleased: false};
for (const key of stateKeys) {
  if (typeof release.states?.[key] !== "boolean") failures.push(`release state is not boolean: ${key}`);
  if (release.states?.[key] !== expectedStates[key]) failures.push(`release state does not match recorded direct evidence: ${key}`);
}
const expectedPublicUrls = {
  support: "https://ynxweb4.com/support",
  privacy: "https://ynxweb4.com/privacy",
  security: "https://ynxweb4.com/security",
  status: "https://ynxweb4.com/status",
};
if (publicMetadata.canonicalUrl !== "https://ynxweb4.com/what-is-ynx-chain") {
  failures.push("public metadata canonical URL does not match the deployed authority route");
}
for (const [key, value] of Object.entries(expectedPublicUrls)) {
  if (publicMetadata.urls?.[key] !== value) failures.push(`public metadata URL is stale: ${key}`);
}
const documentationDownload = publicMetadata.downloads?.find((entry) => entry.type === "documentation-bundle");
if (
  documentationDownload?.manifestUrl !== "https://ynxweb4.com/docs-authority/artifact-manifest.json" ||
  documentationDownload?.status !== "hosted-unsigned-candidate" ||
  documentationDownload?.productionSigned !== false
) {
  failures.push("public metadata documentation download state is stale or overstated");
}
for (const marker of [
  "https://ynxweb4.com/what-is-ynx-chain",
  "`integratedCentral=true`",
  "`deployedStaging=true`",
  "`deployedPublic=true`",
  "`downloadHosted=true`",
  "`productionSigned=false`",
  "IndexNow",
]) {
  if (!websiteHandoff.includes(marker)) failures.push(`website handoff lacks current marker: ${marker}`);
}
for (const stale of ["All nine booleans are currently false", "URLs remain unset", "Downloads remain empty"]) {
  if (websiteHandoff.includes(stale)) failures.push(`website handoff contains stale release truth: ${stale}`);
}
const expectedOperatorInputIds = [
  "brand-media-rights-approval",
  "named-review-approvals",
  "production-signing-approval",
  "search-and-independent-public-proof",
];
const operatorInputIds = (operatorInputs.inputs ?? []).map((entry) => entry.id).sort();
if (
  operatorInputs.requestStatus !== "required-before-production-signed-and-reviewed-release" ||
  !/^[0-9a-f]{40}$/.test(operatorInputs.sourceCommit ?? "") ||
  JSON.stringify(operatorInputIds) !== JSON.stringify(expectedOperatorInputIds)
) {
  failures.push("operator input request is not the minimal production-release request");
}
for (const staleId of [
  "official-public-urls-and-domain-control",
  "provider-procurement-and-access",
  "economics-and-funding-decision",
]) {
  if (operatorInputIds.includes(staleId)) failures.push(`operator input request still contains resolved or out-of-scope item: ${staleId}`);
}
if (
  operatorInputs.notApplicableStates?.installedLocal == null ||
  operatorInputs.notApplicableStates?.storeReleased == null ||
  !operatorInputs.satisfiedByEvidence?.some((entry) => entry.evidence === "release/evidence/website-public-acceptance-2026-07-26.json")
) {
  failures.push("operator input request does not separate satisfied and non-applicable release states");
}

const searchDir = "docs/public/search";
const expectedSearch = ["WHAT_IS_YNX_CHAIN.md", "WHAT_IS_YNX_WEB4.md", "WHAT_IS_YNXT.md", "YNX_TESTNET_GUIDE.md", "WALLET.md", "DEVELOPER.md", "EXCHANGE.md", "DEX.md", "QUANT.md", "SECURITY.md", "TRUST.md", "ECONOMICS.md", "PRODUCTS.md"];
for (const name of expectedSearch) {
  const file = path.join(searchDir, name);
  if (!fs.existsSync(file)) { failures.push(`missing search page: ${file}`); continue; }
  const text = fs.readFileSync(file, "utf8");
  for (const marker of ["Canonical", "Title", "description", "# ", "Last reviewed", "source commit", "Evidence", "Related pages"]) {
    if (!text.toLowerCase().includes(marker.toLowerCase())) failures.push(`${file} lacks ${marker}`);
  }
}

const publicFiles = [
  ...walk("docs/public"),
  ...walk("docs/whitepaper"),
  ...walk("docs/economics"),
  ...walk("docs/guides"),
  "docs/quant/QUANT_ARCHITECTURE_ASSET_BOUNDARY_FEES_RISKS.md",
  "docs/trust/TRUST_APPEALS_MARKET_INTEGRITY.md",
  "docs/security/SECURITY_PRIVACY_AI_GOVERNANCE.md"
].filter((file) => file.endsWith(".md"));
const banned = [/codex/i, /worktree/i, /\/users\//i, /localhost/i, /127\.0\.0\.1/i, /example\.com/i];
for (const file of publicFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of banned) if (pattern.test(text)) failures.push(`${file} contains prohibited public reference ${pattern}`);
}

function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(root, entry.name);
    return entry.isDirectory() ? walk(item) : [item];
  });
}

const disclosureGate = spawnSync(process.execPath, ["scripts/verify/public-disclosure-gate.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8"
});
if (disclosureGate.status !== 0) {
  failures.push(`public disclosure gate failed:\n${(disclosureGate.stderr || disclosureGate.stdout || "no output").trim()}`);
}

const coverageGate = spawnSync(process.execPath, ["scripts/verify/full-goal-coverage-gate.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8"
});
if (coverageGate.status !== 0) {
  failures.push(`full goal coverage gate failed:\n${(coverageGate.stderr || coverageGate.stdout || "no output").trim()}`);
}

const metadataGate = spawnSync(process.execPath, ["scripts/verify/document-metadata-gate.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8"
});
if (metadataGate.status !== 0) {
  failures.push(`document metadata gate failed:\n${(metadataGate.stderr || metadataGate.stdout || "no output").trim()}`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`docs compliance check passed: ${required.length} named artifacts, ${jsonFiles.length} JSON records, ${expectedSearch.length} search pages, ${publicFiles.length} public documents, ${stateKeys.length} evidence-bound release states, the public disclosure gate, the full goal coverage gate, and the document metadata gate\n`);
