#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const plan = await readJson("release/integration/wallet-standard-wallet-e2e-execution-plan-p0-20260822.json");
const matrix = await readJson("release/integration/wallet-authorize-ecosystem-owner-runtime-matrix-v3-20260821.json");
const contract = await readJson("release/integration/wallet-standard-connection-conformance-contract-p0-20260822.json");
const expectedProducts = ["calendar", "card", "creator-studio", "developer", "dex", "exchange", "finance", "pay", "quant", "shop", "social", "video"];
const expectedScenarios = ["discovery", "approve-reject", "chain", "sign-and-send", "lifecycle", "product-session-boundary", "walletconnect-v2"];
const findings = [];

if (plan.version !== "standardWalletE2EExecution@1.0.0-p0.0") findings.push("unexpected execution-plan version");
if (plan.authoritativeInputs?.standardConnectionContract?.version !== contract.version) findings.push("execution plan does not bind the accepted conformance contract version");
if (plan.authoritativeInputs?.sharedProvider?.commit !== contract.authoritativeInputs?.sharedProvider?.commit || plan.authoritativeInputs?.sharedProvider?.tree !== contract.authoritativeInputs?.sharedProvider?.tree) findings.push("execution plan does not bind the exact shared Provider source");
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

if (findings.length) {
  console.error(`Standard Wallet E2E execution-plan gate failed:\n${findings.map((item) => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else console.log(`Standard Wallet E2E execution-plan gate passed for ${dispatch.length} registered products`);

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(repoRoot, relativePath), "utf8"));
}
