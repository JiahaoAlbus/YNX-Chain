#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

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
  "release/operator-inputs.request.json"
];

const jsonFiles = [
  "docs/acceptance/DOCS_COMPLIANCE_REQUIREMENTS.json",
  "release/public-product-metadata.json",
  "release/product-release.json",
  "release/operator-inputs.request.json",
  "release/structured-data-suggestions.json",
  "release/evidence/local-read-benchmark-2026-07-22.json",
  "release/evidence/supply-chain-2026-07-22.json",
  "release/sbom-npm.cdx.json",
  "release/go-module-inventory.json"
];

const failures = [];
for (const file of required) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) failures.push(`missing or empty: ${file}`);
}
for (const file of jsonFiles) {
  try { JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { failures.push(`invalid JSON ${file}: ${error.message}`); }
}

const release = JSON.parse(fs.readFileSync("release/product-release.json", "utf8"));
const stateKeys = ["implementedLocal", "testedLocal", "installedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"];
const expectedStates = {implementedLocal: true, testedLocal: true, installedLocal: false, integratedCentral: false, deployedStaging: false, deployedPublic: false, downloadHosted: false, productionSigned: false, storeReleased: false};
for (const key of stateKeys) {
  if (typeof release.states?.[key] !== "boolean") failures.push(`release state is not boolean: ${key}`);
  if (release.states?.[key] !== expectedStates[key]) failures.push(`release state does not match recorded direct evidence: ${key}`);
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

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`docs compliance check passed: ${required.length} named artifacts, ${jsonFiles.length} JSON records, ${expectedSearch.length} search pages, ${publicFiles.length} public documents, and ${stateKeys.length} evidence-bound release states\n`);
