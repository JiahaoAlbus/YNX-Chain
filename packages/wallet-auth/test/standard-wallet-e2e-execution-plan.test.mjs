import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const plan = JSON.parse(await readFile(new URL("../../../release/integration/wallet-standard-wallet-e2e-execution-plan-p0-20260822.json", import.meta.url), "utf8"));

test("the E2E plan requires identity distinction, all four DApps and all user-authority lifecycles", () => {
  assert.deepEqual(plan.authoritativeInputs.walletWebProviderIdentity.ynx, { name: "YNX Wallet", rdns: "com.ynx.wallet", isYNXWallet: true, isMetaMask: false });
  assert.deepEqual(plan.authoritativeInputs.walletWebProviderIdentity.metamask, { isMetaMask: true, isYNXWallet: false });
  assert.deepEqual(plan.dappCoverage.external.map(({ id }) => id), ["uniswap-interface-reference", "opensea-reference", "safe-reference"]);
  assert.deepEqual(plan.realE2EScenarios.map(({ id }) => id), ["discovery", "approve-reject", "chain", "sign-and-send", "lifecycle", "product-session-boundary", "walletconnect-v2"]);
  assert.match(plan.invariants.webTransport, /iframe launcher/);
  assert.match(plan.invariants.webTransport, /blank top-level target/);
});

test("the E2E plan dispatches exact work to all registered products without promoting source evidence", () => {
  assert.deepEqual(plan.ownerDispatch.map(({ productId }) => productId), ["calendar", "card", "creator-studio", "developer", "dex", "exchange", "finance", "pay", "quant", "shop", "social", "video"]);
  assert.equal(plan.ownerDispatch.find(({ productId }) => productId === "card").restriction, "Card has an independent goal; Protocol Owner must not change Card source.");
  assert.equal(plan.truth.realDappDirectRuntimeCount, 0);
  assert.equal(plan.truth.productsConnected, 0);
  assert.equal(plan.truth.productsMigratedV2, 0);
  assert.equal(plan.truth.installedWalletApproved, false);
});
