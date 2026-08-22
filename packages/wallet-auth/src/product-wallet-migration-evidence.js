import { exactFields, WalletAuthError } from "./canonical.js";

export const PRODUCT_WALLET_MIGRATION_EVIDENCE_VERSION = 1;
export const PRODUCT_WALLET_MIGRATION_SHARED_SOURCE = Object.freeze({
  commit: "98c6d5d784d212df8981a53b17118a511e246ad2",
  tree: "51a60a362d4ad5dd748bcdefb101f71b1d9e0cee",
  evidenceCommit: "c3ab255c32bdeb9c8e056882c315f8ad43c29c7f",
});
export const PRODUCT_WALLET_MIGRATION_PRODUCT_IDS = Object.freeze([
  "calendar", "card", "creator-studio", "developer", "dex", "exchange",
  "finance", "pay", "quant", "shop", "social", "video",
]);

const PROVIDERS = Object.freeze(["metamask", "ynx-wallet"]);

export function evaluateProductWalletMigrationEvidence(input) {
  exactFields(input, ["schemaVersion", "productId", "sharedSource", "ownerSource", "publicRuntime", "standardWallet", "callback", "productSession"], "Product Wallet migration evidence");
  if (input.schemaVersion !== PRODUCT_WALLET_MIGRATION_EVIDENCE_VERSION) fail("UNSUPPORTED_MIGRATION_EVIDENCE_VERSION", "Product Wallet migration evidence version is unsupported");
  if (!PRODUCT_WALLET_MIGRATION_PRODUCT_IDS.includes(input.productId)) fail("UNKNOWN_MIGRATION_PRODUCT", "Product Wallet migration evidence product is not registered");

  const shared = parseShared(input.sharedSource);
  const owner = parseOwner(input.ownerSource);
  const publicRuntime = parsePublic(input.publicRuntime);
  const standard = parseStandard(input.standardWallet);
  const callback = parseCallback(input.callback);
  const session = parseSession(input.productSession);

  const sourceAccepted = shared.commit === PRODUCT_WALLET_MIGRATION_SHARED_SOURCE.commit
    && shared.tree === PRODUCT_WALLET_MIGRATION_SHARED_SOURCE.tree
    && shared.evidenceCommit === PRODUCT_WALLET_MIGRATION_SHARED_SOURCE.evidenceCommit
    && shared.consumerGatePassed;
  const publicRuntimeAccepted = sourceAccepted
    && publicRuntime.sourceBound
    && publicRuntime.sourceCommit === owner.commit
    && publicRuntime.urlStable
    && publicRuntime.topLevelTabDelta === 0
    && publicRuntime.chooserClosedAfterSuccess;
  const standardWalletAccepted = publicRuntimeAccepted
    && PROVIDERS.includes(standard.selectedProvider)
    && standard.accountApproved
    && standard.chainId === "0x1917"
    && standard.refreshRestore
    && standard.disconnectOrAccountChangeHandled
    && standard.productSessionDegradedPreservesConnection;
  const callbackAccepted = standardWalletAccepted
    && callback.approveExact
    && callback.rejectExact
    && callback.coldStartRecovered;
  const productSessionAccepted = callbackAccepted
    && Object.values(session).every((value) => value === true);

  const missing = [];
  if (!sourceAccepted) missing.push("exact-shared-source-consumption");
  if (!publicRuntimeAccepted) missing.push("source-bound-public-runtime");
  if (!standardWalletAccepted) missing.push("visible-standard-wallet-lifecycle");
  if (!callbackAccepted) missing.push("exact-approve-reject-callback");
  if (!productSessionAccepted) missing.push("product-session-v2-lifecycle");

  return Object.freeze({
    schemaVersion: PRODUCT_WALLET_MIGRATION_EVIDENCE_VERSION,
    productId: input.productId,
    sourceAccepted,
    publicRuntimeAccepted,
    standardWalletAccepted,
    callbackAccepted,
    productSessionAccepted,
    productsConnected: productSessionAccepted ? 1 : 0,
    migratedV2: productSessionAccepted,
    missing: Object.freeze(missing),
    authority: "evidence-evaluation-only",
  });
}

function parseShared(value) {
  exactFields(value, ["commit", "tree", "evidenceCommit", "consumerGatePassed"], "Shared Provider source evidence");
  return Object.freeze({ commit: sha(value.commit), tree: sha(value.tree), evidenceCommit: sha(value.evidenceCommit), consumerGatePassed: boolean(value.consumerGatePassed) });
}
function parseOwner(value) {
  exactFields(value, ["commit", "tree"], "Product owner source evidence");
  return Object.freeze({ commit: sha(value.commit), tree: sha(value.tree) });
}
function parsePublic(value) {
  exactFields(value, ["sourceCommit", "sourceBound", "urlStable", "topLevelTabDelta", "chooserClosedAfterSuccess"], "Product public runtime evidence");
  if (!Number.isSafeInteger(value.topLevelTabDelta) || value.topLevelTabDelta < 0) fail("INVALID_MIGRATION_EVIDENCE", "Product public runtime tab delta is invalid");
  return Object.freeze({ sourceCommit: sha(value.sourceCommit), sourceBound: boolean(value.sourceBound), urlStable: boolean(value.urlStable), topLevelTabDelta: value.topLevelTabDelta, chooserClosedAfterSuccess: boolean(value.chooserClosedAfterSuccess) });
}
function parseStandard(value) {
  exactFields(value, ["selectedProvider", "accountApproved", "chainId", "refreshRestore", "disconnectOrAccountChangeHandled", "productSessionDegradedPreservesConnection"], "Standard Wallet lifecycle evidence");
  if (value.selectedProvider !== null && !PROVIDERS.includes(value.selectedProvider)) fail("INVALID_MIGRATION_EVIDENCE", "Standard Wallet selected provider is invalid");
  if (value.chainId !== null && value.chainId !== "0x1917") fail("INVALID_MIGRATION_EVIDENCE", "Standard Wallet chain evidence is invalid");
  return Object.freeze({ selectedProvider: value.selectedProvider, accountApproved: boolean(value.accountApproved), chainId: value.chainId, refreshRestore: boolean(value.refreshRestore), disconnectOrAccountChangeHandled: boolean(value.disconnectOrAccountChangeHandled), productSessionDegradedPreservesConnection: boolean(value.productSessionDegradedPreservesConnection) });
}
function parseCallback(value) {
  exactFields(value, ["approveExact", "rejectExact", "coldStartRecovered"], "Wallet callback evidence");
  return Object.freeze({ approveExact: boolean(value.approveExact), rejectExact: boolean(value.rejectExact), coldStartRecovered: boolean(value.coldStartRecovered) });
}
function parseSession(value) {
  const fields = ["challenge", "approve", "reject", "timeout", "revoke", "secondLaunch", "networkRetry", "tenantIsolation"];
  exactFields(value, fields, "Product Session lifecycle evidence");
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, boolean(value[field])])));
}
function sha(value) { if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) fail("INVALID_MIGRATION_EVIDENCE", "Migration evidence Git identity is invalid"); return value; }
function boolean(value) { if (typeof value !== "boolean") fail("INVALID_MIGRATION_EVIDENCE", "Migration evidence boolean is invalid"); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
