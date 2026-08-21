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
    assert.equal(product.runtime.realInstalledApproval, false, product.productId);
    assert.equal(product.runtime.productSessionV2, false, product.productId);
    assert.equal(product.runtime.computerControl, false, product.productId);
    assert.ok(product.ownerHandoff.length > 80, product.productId);
  }
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

test("shared Provider/connect recovery hands off to all products without promoting runtime", () => {
  assert.equal(auditV3.sharedProviderConnectRecovery.sourceCommit, providerRecovery.source.commit);
  assert.equal(auditV3.sharedProviderConnectRecovery.registeredProductConsumers, 0);
  assert.deepEqual(providerRecovery.registeredProductHandoffs.map(({ productId }) => productId).sort(), auditV3.registeredProducts.map(({ productId }) => productId).sort());
  assert.ok(providerRecovery.registeredProductHandoffs.every(({ consumed }) => consumed === false));
  assert.equal(providerRecovery.directChromeEvidence.shop.accountApprovalObserved, false);
  assert.equal(providerRecovery.directChromeEvidence.card.accountApprovalObserved, false);
  assert.equal(providerRecovery.truth.productsConnected, 0);
  assert.equal(providerRecovery.truth.threeProductChromeAcceptance, false);
  assert.equal(providerRecovery.truth.officialInstallersReplaced, false);
  assert.equal(providerRecovery.truth.websiteDirectLinksRestored, false);
});
