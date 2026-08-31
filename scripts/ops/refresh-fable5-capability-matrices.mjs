#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const matrixPath = "release/integration/PRODUCT_RELEASE_MATRIX.json";
const outputs = {
  ai: "release/integration/AI_CAPABILITY_MATRIX.json",
  stablecoin: "release/economics/STABLECOIN_PRICE_RESERVE_ACCEPTANCE.json",
  asset: "release/security/ASSET_SECURITY_TRACEABILITY_MATRIX.json",
  catalog: "release/integration/ECOSYSTEM_FUNCTION_CATALOG.json",
};

const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const writeJson = (relative, value) => {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
};
const exists = (relative) => fs.existsSync(path.join(root, relative));
const unique = (values) => [...new Set(values.filter(Boolean))];

const categories = {
  "01":"infrastructure", "02":"identity-and-wallet", "03":"content-and-users", "04":"payments-and-commerce",
  "05":"payments-and-commerce", "06":"payments-and-commerce", "07":"finance-and-liquidity", "08":"finance-and-liquidity",
  "09":"payments-and-commerce", "10":"payments-and-commerce", "11":"developer-and-enterprise", "12":"trust-and-transparency",
  "13":"trust-and-transparency", "14":"developer-and-enterprise", "15":"trust-and-transparency", "16":"finance-and-liquidity",
  "17":"finance-and-liquidity", "18":"trust-and-transparency", "19":"infrastructure", "20":"content-and-users",
  "21":"infrastructure", "22":"content-and-users", "23":"content-and-users", "24":"finance-and-liquidity",
  "25":"content-and-users", "26":"infrastructure", "27":"finance-and-liquidity", "28":"developer-and-enterprise",
  "29":"infrastructure", "30":"infrastructure", "31":"infrastructure", "32":"content-and-users",
  "33":"content-and-users", "34":"content-and-users", "35":"developer-and-enterprise", "36":"content-and-users",
};

const functionCatalog = {
  "01":["chain state", "signed transactions", "receipts", "validator replication", "RPC"],
  "02":["wallet custody boundary", "product-scoped sessions", "native transfer", "EVM compatibility"],
  "03":["profiles", "social posts", "comments", "reactions", "moderation reports"],
  "04":["merchant intent", "invoice", "settlement evidence", "refund", "dispute", "sponsored gas", "reconciliation"],
  "05":["merchant onboarding", "catalog", "orders", "webhooks", "analytics"],
  "06":["sandbox authorization", "spending controls", "Pay-linked review"],
  "07":["exchange integration candidate", "signed transfer", "nonce", "receipt and log verification"],
  "08":["strategy research", "simulation", "risk review", "exchange and DEX routing proposal"],
  "09":["catalog", "cart", "checkout candidate", "delivery and refund handoff"],
  "10":["seller orders", "fulfillment candidate", "payout reconciliation"],
  "11":["web IDE", "compiler checks", "bounded deployment", "SDK and CLI"],
  "12":["block search", "transaction search", "account history", "validator view", "leaderboard", "SSE"],
  "13":["metrics", "logs", "traces", "alerts", "SLO", "incident timeline"],
  "14":["AI gateway", "consent", "preview", "approval", "audit", "credential redaction"],
  "15":["evidence tracing", "risk labels", "appeal", "correction", "transparency export"],
  "16":["resource quote", "delegation", "rental settlement", "provider income", "analytics"],
  "17":["treasury", "stablecoin sandbox", "staking", "fee market", "solvency evidence"],
  "18":["whitepaper", "compliance boundaries", "brand facts", "claims evidence"],
  "19":["multi-source oracle", "median", "weighted median", "TWAP", "staleness", "divergence", "attestation"],
  "20":["cloud storage candidate", "resource integration", "recovery boundary"],
  "21":["bridge coordinator", "source confirmations", "relay attestations", "fail-closed external submission"],
  "22":["browser candidate", "wallet session", "search and Trust integration"],
  "23":["ecosystem search", "evidence-aware discovery", "indexing candidate"],
  "24":["budget", "ledger", "statements", "finance analysis candidate"],
  "25":["mail draft", "attachment", "provider sandbox", "delivery recovery"],
  "26":["canonical events", "billing ledger", "redelivery", "schema registry", "reconciliation"],
  "27":["DEX contract candidate", "quote and swap simulation", "liquidity boundary"],
  "28":["official website", "DApp directory", "docs", "manual", "status", "SEO"],
  "29":["release train", "central contracts", "dependency acceptance", "E2E evidence", "product matrix"],
  "30":["security gates", "SRE", "SBOM", "provenance", "backup", "restore", "rollback", "release controls"],
  "31":["proposal", "vote", "timelock", "chain execution", "appeal and emergency boundary"],
  "32":["music candidate", "creator and Pay handoff", "rights boundary"],
  "33":["video candidate", "creator and Pay handoff", "moderation boundary"],
  "34":["creator workflow", "music and video handoff", "Pay and Data Fabric handoff"],
  "35":["developer documentation", "API reference", "operator guides", "recovery documentation"],
  "36":["calendar events", "invites", "reminders", "time-zone and recurrence candidate"],
};

const aiModes = {
  "03":"content", "05":"advisory", "07":"advisory", "08":"advisory", "09":"advisory", "10":"advisory",
  "11":"developer", "13":"operations-readonly", "14":"native-ai", "15":"advisory", "18":"content",
  "22":"advisory", "23":"advisory", "24":"advisory", "25":"content", "28":"content",
  "29":"operations-readonly", "30":"operations-readonly", "32":"content", "33":"content", "34":"content", "35":"content",
};

const aiUses = {
  none: [],
  advisory: ["explain", "summarize", "research", "simulate", "propose"],
  content: ["explain", "summarize", "translate", "generate draft"],
  developer: ["explain", "generate draft", "debug assistance", "audit assistance"],
  "operations-readonly": ["explain", "summarize", "read-only anomaly review", "propose remediation"],
  "native-ai": ["explain", "summarize", "translate", "research", "simulate", "generate draft", "propose"],
};

const prohibitedAIUses = [
  "automatic signing", "automatic payment", "automatic trading or swap", "automatic withdrawal",
  "change withdrawal address", "expand permissions or session scope", "change asset ownership",
  "decide consensus", "decide oracle truth", "decide bridge finality", "freeze, seize, or transfer assets",
];

const publicRuntimes = {
  "01":"https://rpc.ynxweb4.com", "04":"https://pay.ynxweb4.com", "12":"https://explorer.ynxweb4.com",
  "14":"https://ai.ynxweb4.com", "15":"https://trust.ynxweb4.com", "16":"https://resource.ynxweb4.com",
  "21":"https://bridge.ynxweb4.com", "28":"https://ynxweb4.com",
};

const assetProducts = new Set(["01","02","04","05","06","07","08","09","10","12","15","16","17","19","21","24","26","27","29","30","31"]);
const assetControls = [
  "productScopedSession", "deviceBinding", "scope", "expiry", "nonce", "replayProtection", "revoke", "killSwitch",
  "transactionPreview", "chainIdBinding", "bundleCallbackBinding", "singleTransactionLimit", "dailyLimit", "assetLimit",
  "methodLimit", "unlimitedApprovalRejection", "withdrawalBoundary", "newAddressRisk", "highRiskAddressDetection",
  "explorerTrace", "canonicalEvents", "billingLedger", "trustEvidence", "correction", "appeal", "emergencyExit",
];
const attackDrills = [
  "stolenSession", "wrongDevice", "wrongProduct", "scopeWidening", "replay", "tamperedDigest",
  "withdrawalAddressChange", "unlimitedApproval", "suspiciousContractMethod", "duplicatePayment",
  "bridgeReplay", "oracleManipulationCandidate",
];
const assetEvidence = {
  "02":["internal/appgateway/session_test.go", "internal/appgateway/gateway_test.go", "internal/assetauth/mandate_test.go", "apps/wallet/src/chain/nativeTransfer.test.ts"],
  "04":["internal/payproduct/service_test.go", "internal/payproduct/review_regression_test.go", "internal/payproduct/refund_test.go", "internal/chain/pay_settlement_test.go"],
  "07":["internal/api/exchange_transaction_test.go", "scripts/verify/exchange-local-check.mjs"],
  "15":["internal/trustproduct/service_test.go"],
  "16":["internal/resourceproduct/auth_http_test.go", "internal/resourceproduct/service_test.go"],
  "17":["internal/economics/stable_reserve_integration_test.go", "internal/stablecoinissuer/issuer_test.go"],
  "19":["internal/oracle/aggregate_test.go", "internal/oracle/dex_twap_test.go", "internal/oracle/providers/runtime_test.go"],
  "21":["internal/bridgegateway/state_machine_test.go", "internal/bridgegateway/gateway_test.go"],
  "26":["internal/datafabric/saga_test.go", "internal/datafabric/redelivery_test.go", "internal/datafabricpay/bridge_test.go"],
  "31":["internal/governance/auth_test.go", "internal/governance/timelock_test.go", "internal/consensus/governance_execution_test.go"],
};

function evidenceState(product, evidence) {
  const present = evidence.filter(exists);
  if (!present.length) return { status: "unverified", evidence: [] };
  if (product.states?.testedLocal === true && product.ci?.exactHeadSuccess === true) {
    return { status: "verified-candidate", evidence: present };
  }
  return { status: "candidate-evidence", evidence: present };
}

function buildAI(matrix) {
  return {
    schemaVersion: "1.0.0",
    generatedAt: matrix.generatedAt,
    controllerSourceCommit: matrix.controllerSourceCommit,
    authority: "Product 29 Integration; fail-closed from PRODUCT_RELEASE_MATRIX.json",
    products: matrix.products.map((product) => {
      const mode = aiModes[product.productNumber] ?? "none";
      const enabled = mode !== "none";
      return {
        productNumber: product.productNumber,
        productName: product.productName,
        aiMode: mode,
        aiGateway: enabled ? "YNX AI Gateway candidate" : null,
        permittedUses: aiUses[mode],
        prohibitedUses: prohibitedAIUses,
        contextConsent: enabled ? "required before context leaves the product boundary" : "not-applicable",
        dataClassification: enabled ? "explicit per-request classification; secrets and credentials prohibited" : "not-applicable",
        provider: enabled ? "provider selected by YNX AI Gateway runtime configuration" : null,
        model: enabled ? "provider-reported model; never an authority source" : null,
        costBoundary: enabled ? "preview and approval required; AI cannot authorize spend or asset movement" : "no AI cost",
        auditEvidence: enabled ? unique(["docs/security/SECURITY_PRIVACY_AI_GOVERNANCE.md", product.integrationContract]) : [],
        sourceCommit: product.localSha,
        tests: { testedLocal: product.states?.testedLocal === true, exactHeadCi: product.ci?.exactHeadSuccess === true },
        status: !enabled ? "documented-none" : product.states?.testedLocal && product.ci?.exactHeadSuccess ? "candidate-verified" : "candidate-unverified",
      };
    }),
  };
}

function buildStablecoin(matrix) {
  const economics = matrix.products.find((product) => product.productNumber === "17");
  const oracle = matrix.products.find((product) => product.productNumber === "19");
  const tests = {
    multiSourceAggregation: ["internal/oracle/aggregate_test.go"],
    medianWeightedMedian: ["internal/oracle/aggregate_test.go"],
    twap: ["internal/oracle/dex_twap_test.go"],
    providerFailure: ["internal/oracle/providers/runtime_test.go"],
    staleness: ["internal/oracle/server_test.go"],
    divergence: ["internal/oracle/aggregate_test.go"],
    lastGoodValue: ["internal/oracle/store_test.go"],
    circuitBreaker: ["internal/oracle/reserve_test.go"],
    depeg: ["internal/economics/stable_reserve_integration_test.go", "internal/yusdsandbox/service_test.go"],
    recovery: ["internal/economics/stable_reserve_integration_test.go", "internal/yusdsandbox/service_test.go"],
  };
  return {
    schemaVersion: "1.0.0",
    generatedAt: matrix.generatedAt,
    controllerSourceCommit: matrix.controllerSourceCommit,
    authority: "Oracle observations and reserve evidence; AI and frontend constants are prohibited price authorities",
    nativeAsset: { symbol: "YNXT", network: "YNX Testnet", classification: "testnet-native-asset-not-stablecoin", productionValueClaim: false },
    oracleObservationRequiredFields: ["asset", "quoteAsset", "value", "sources", "asOf", "sequence", "confidence", "coverage", "method", "signature", "stale", "divergence", "depegState", "sourceCommit"],
    prohibitedPriceAuthorities: ["AI", "frontend constant", "single unverified provider", "manual static price"],
    oracle: {
      productNumber: "19", sourceCommit: oracle.localSha,
      exactHeadCi: oracle.ci?.exactHeadSuccess === true,
      tests: Object.fromEntries(Object.entries(tests).map(([name, paths]) => [name, evidenceState(oracle, paths)])),
    },
    stablecoins: [{
      asset: "YUSD", status: "testnet-candidate", sourceCommit: economics.localSha,
      reserve: "sandbox evidence only", reserveAttestation: "candidate cryptographic attestation; no bank custody claim",
      mint: "testnet sandbox", burn: "testnet sandbox", redemption: "testnet sandbox only",
      supplyReconciliation: "candidate tests", limits: "candidate controls", pause: "candidate controls",
      depegControl: "oracle-driven candidate", governanceBoundary: "candidate", solvencyBoundary: "no production reserve or redemption claim",
      productionStablecoin: false, mainnetReleased: false,
      evidence: ["docs/stablecoin/STABLECOIN_RESERVE_REDEMPTION.md", "docs/stablecoin/YUSD_SANDBOX.md", "internal/stablecoinissuer/issuer_test.go", "internal/economics/stable_reserve_integration_test.go"].filter(exists),
    }],
  };
}

function buildAsset(matrix) {
  return {
    schemaVersion: "1.0.0",
    generatedAt: matrix.generatedAt,
    controllerSourceCommit: matrix.controllerSourceCommit,
    claimsBoundary: ["risk reduction", "rapid revocation", "block unauthorized actions", "trace flows", "generate evidence", "support lawful handling"],
    prohibitedClaims: ["theft can never occur", "assets are guaranteed recoverable", "secret asset freeze", "AI as asset administrator or final arbiter"],
    traceabilityChain: ["chain transaction or receipt", "Explorer", "canonical events", "Data Fabric", "billing ledger", "Monitor", "Trust evidence", "export, appeal, correction"],
    products: matrix.products.map((product) => {
      const relevant = assetProducts.has(product.productNumber);
      const state = relevant ? evidenceState(product, assetEvidence[product.productNumber] ?? []) : { status: "not-applicable", evidence: [] };
      return {
        productNumber: product.productNumber, productName: product.productName, assetRelevant: relevant,
        sourceCommit: product.localSha,
        controls: Object.fromEntries(assetControls.map((control) => [control, relevant ? state : { status: "not-applicable", evidence: [] }])),
        attackDrills: Object.fromEntries(attackDrills.map((drill) => [drill, relevant ? state : { status: "not-applicable", evidence: [] }])),
        status: relevant ? state.status : "not-applicable",
      };
    }),
  };
}

function buildCatalog(matrix, registry) {
	const slugs = new Map(registry.products.map((product) => [product.id, product.slug]));
  return {
    schemaVersion: "1.0.0",
    generatedAt: matrix.generatedAt,
    controllerSourceCommit: matrix.controllerSourceCommit,
    authority: "Product 29 release matrix and official /dapp information architecture",
    products: matrix.products.map((product) => {
      const mode = aiModes[product.productNumber] ?? "none";
      const route = `/dapp/${slugs.get(product.productNumber)}`;
      return {
        productNumber: product.productNumber, productName: product.productName,
        category: categories[product.productNumber], coreFunctions: functionCatalog[product.productNumber],
        userFlows: functionCatalog[product.productNumber], aiCapabilities: { mode, permittedUses: aiUses[mode] },
        assetCapabilities: { relevant: assetProducts.has(product.productNumber) },
        integrationDependencies: product.integrationContract ? [product.integrationContract] : [],
        publicRoutes: [route], runtime: publicRuntimes[product.productNumber] ? { availability: "public-testnet", url: publicRuntimes[product.productNumber], evidence: "docs/acceptance/TESTNET_TRANSFER_AND_CONCURRENCY_EVIDENCE_2026_08_01.md" } : { availability: "not-publicly-verified", url: null },
        sourceCommit: product.localSha,
        release: product.release?.githubReleases?.[0]?.tagName ?? null,
        tests: { testedLocal: product.states?.testedLocal === true, exactHeadCi: product.ci?.exactHeadSuccess === true },
        status: publicRuntimes[product.productNumber] ? "public-testnet" : product.classification === "READY_FOR_SOURCE_RELEASE" ? "source-candidate" : "pending-recovery",
      };
    }),
  };
}

function validate(matrix, documents) {
  if (!Array.isArray(matrix.products) || matrix.products.length !== 36) throw new Error("release matrix must contain 36 products");
  for (const [name, document] of Object.entries(documents)) {
    if (document.schemaVersion !== "1.0.0") throw new Error(`${name} schemaVersion is invalid`);
    if (document.controllerSourceCommit !== matrix.controllerSourceCommit) throw new Error(`${name} controller source binding mismatch`);
  }
  for (const name of ["ai", "asset", "catalog"]) {
    const products = documents[name].products;
    if (!Array.isArray(products) || products.length !== 36) throw new Error(`${name} must contain 36 products`);
    for (const [index, product] of products.entries()) {
      const source = matrix.products[index];
      if (product.productNumber !== source.productNumber || product.sourceCommit !== source.localSha) throw new Error(`${name} product ${source.productNumber} source binding mismatch`);
    }
  }
  if (documents.stablecoin.nativeAsset.classification !== "testnet-native-asset-not-stablecoin") throw new Error("YNXT must not be classified as a stablecoin");
  if (documents.stablecoin.stablecoins.some((coin) => coin.productionStablecoin || coin.mainnetReleased)) throw new Error("stablecoin production claim must fail closed");
  if (documents.ai.products.some((product) => product.prohibitedUses.length !== prohibitedAIUses.length)) throw new Error("AI prohibited-use coverage is incomplete");
  if (documents.asset.products.some((product) => Object.keys(product.controls).length !== assetControls.length || Object.keys(product.attackDrills).length !== attackDrills.length)) throw new Error("asset security coverage is incomplete");
}

function main() {
  const matrix = readJson(matrixPath);
  const registry = readJson("release/integration/product-registry.json");
  const documents = { ai: buildAI(matrix), stablecoin: buildStablecoin(matrix), asset: buildAsset(matrix), catalog: buildCatalog(matrix, registry) };
  validate(matrix, documents);
  if (process.argv.includes("--check")) {
    for (const [name, relative] of Object.entries(outputs)) {
      if (JSON.stringify(readJson(relative)) !== JSON.stringify(documents[name])) throw new Error(`${relative} is stale; refresh it`);
    }
    console.log("Fable5 capability matrices check passed");
    return;
  }
  for (const [name, relative] of Object.entries(outputs)) writeJson(relative, documents[name]);
  console.log("wrote AI, stablecoin, asset-security and ecosystem-function matrices");
}

main();
