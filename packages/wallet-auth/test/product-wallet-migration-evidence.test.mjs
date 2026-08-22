import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateProductWalletMigrationEvidence,
  PRODUCT_WALLET_MIGRATION_SHARED_SOURCE,
  WalletAuthError,
} from "../src/index.js";

const OWNER = "1111111111111111111111111111111111111111";
const TREE = "2222222222222222222222222222222222222222";

function receipt() {
  return {
    schemaVersion: 1,
    productId: "social",
    sharedSource: { ...PRODUCT_WALLET_MIGRATION_SHARED_SOURCE, consumerGatePassed: true },
    ownerSource: { commit: OWNER, tree: TREE },
    publicRuntime: { sourceCommit: OWNER, sourceBound: true, urlStable: true, topLevelTabDelta: 0, chooserClosedAfterSuccess: true },
    standardWallet: { selectedProvider: "metamask", accountApproved: true, chainId: "0x1917", refreshRestore: true, disconnectOrAccountChangeHandled: true, productSessionDegradedPreservesConnection: true },
    callback: { approveExact: true, rejectExact: true, coldStartRecovered: true },
    productSession: { challenge: true, approve: true, reject: true, timeout: true, revoke: true, secondLaunch: true, networkRetry: true, tenantIsolation: true },
  };
}

test("complete owner evidence accepts exactly one product migration without granting runtime authority", () => {
  const result = evaluateProductWalletMigrationEvidence(receipt());
  assert.equal(result.sourceAccepted, true);
  assert.equal(result.publicRuntimeAccepted, true);
  assert.equal(result.standardWalletAccepted, true);
  assert.equal(result.callbackAccepted, true);
  assert.equal(result.productSessionAccepted, true);
  assert.equal(result.productsConnected, 1);
  assert.equal(result.migratedV2, true);
  assert.equal(result.authority, "evidence-evaluation-only");
  assert.deepEqual(result.missing, []);
});

test("source and public checkpoints never count as a connected or migrated product", () => {
  const input = receipt();
  input.standardWallet.accountApproved = false;
  input.callback = { approveExact: false, rejectExact: false, coldStartRecovered: false };
  input.productSession = { challenge: false, approve: false, reject: false, timeout: false, revoke: false, secondLaunch: false, networkRetry: false, tenantIsolation: false };
  const result = evaluateProductWalletMigrationEvidence(input);
  assert.equal(result.sourceAccepted, true);
  assert.equal(result.publicRuntimeAccepted, true);
  assert.equal(result.standardWalletAccepted, false);
  assert.equal(result.productsConnected, 0);
  assert.equal(result.migratedV2, false);
});

test("shared tree substitution and public source substitution fail closed", () => {
  const shared = receipt();
  shared.sharedSource.tree = "3333333333333333333333333333333333333333";
  assert.equal(evaluateProductWalletMigrationEvidence(shared).sourceAccepted, false);
  const runtime = receipt();
  runtime.publicRuntime.sourceCommit = "4444444444444444444444444444444444444444";
  const result = evaluateProductWalletMigrationEvidence(runtime);
  assert.equal(result.publicRuntimeAccepted, false);
  assert.equal(result.productsConnected, 0);
});

test("wrong chain, tab creation, persistent chooser and Product Session gaps remain incomplete", () => {
  const tab = receipt(); tab.publicRuntime.topLevelTabDelta = 1;
  assert.equal(evaluateProductWalletMigrationEvidence(tab).publicRuntimeAccepted, false);
  const chooser = receipt(); chooser.publicRuntime.chooserClosedAfterSuccess = false;
  assert.equal(evaluateProductWalletMigrationEvidence(chooser).standardWalletAccepted, false);
  const session = receipt(); session.productSession.networkRetry = false;
  const result = evaluateProductWalletMigrationEvidence(session);
  assert.equal(result.standardWalletAccepted, true);
  assert.equal(result.productSessionAccepted, false);
  assert.equal(result.migratedV2, false);
  const wrongChain = receipt(); wrongChain.standardWallet.chainId = "0x1";
  assert.throws(() => evaluateProductWalletMigrationEvidence(wrongChain), error("INVALID_MIGRATION_EVIDENCE"));
});

test("unknown products, fields and malformed identities are rejected", () => {
  const unknown = receipt(); unknown.productId = "faucet";
  assert.throws(() => evaluateProductWalletMigrationEvidence(unknown), error("UNKNOWN_MIGRATION_PRODUCT"));
  const extra = receipt(); extra.publicRuntime.opened = true;
  assert.throws(() => evaluateProductWalletMigrationEvidence(extra), error("UNKNOWN_OR_MISSING_FIELD"));
  const malformed = receipt(); malformed.ownerSource.commit = "short";
  assert.throws(() => evaluateProductWalletMigrationEvidence(malformed), error("INVALID_MIGRATION_EVIDENCE"));
});

function error(code) { return (value) => value instanceof WalletAuthError && value.code === code; }
