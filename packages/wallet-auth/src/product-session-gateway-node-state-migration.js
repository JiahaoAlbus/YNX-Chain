import { sha256 as sha256Digest } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { ProductSessionGatewayKernel } from "./product-session-gateway.js";
import { migrateProductSessionRegistryV2, parseProductSessionRegistry } from "./product-session-registry.js";

const ENVELOPE_FIELDS = ["registrySha256", "schemaVersion", "snapshot", "snapshotSha256"];
const INPUT_FIELDS = ["currentRegistry", "previousRegistry", "stateEnvelope"];
const WEB_COMPANION = Object.freeze({
  applicationId: "web.ynx.wallet.companion", clientId: "ynx-wallet-web-companion-v1", displayName: "YNX Wallet Web Companion",
  evmCompatible: true, legacyCallbacks: Object.freeze(["ynxwalletcompanion://wallet-auth/callback"]), nativeCallback: "ynxwalletcompanion://wallet-auth/callback",
  platforms: Object.freeze(["web"]), productId: "wallet-web-companion", retiredClients: Object.freeze([]),
  scopes: Object.freeze(["account:read", "chain:network:add", "chain:network:switch", "wallet:session:request"]), sessionDurationSeconds: 180,
  webApplicationId: "web.ynx.wallet.companion", webCallback: "https://www.ynxweb4.com/dapp/wallet/wallet-auth/callback", webOrigin: "https://www.ynxweb4.com",
});

export function migrateProductSessionGatewayNodeStateRegistryV2(input) {
  exactFields(input, INPUT_FIELDS, "Product Session registry state migration input");
  const previousRegistry = productSessionRegistryV2MigrationSource(input.previousRegistry);
  const currentRegistry = parseProductSessionRegistry(input.currentRegistry);
  const expectedCurrent = migrateProductSessionRegistryV2(input.previousRegistry);
  assertReviewedTransition(expectedCurrent, currentRegistry);
  const previousRegistrySha256 = sha256(canonicalJSON(previousRegistry));
  const currentRegistrySha256 = sha256(canonicalJSON(currentRegistry));
  const state = parseEnvelope(input.stateEnvelope, previousRegistrySha256);
  const migratedKernel = new ProductSessionGatewayKernel(currentRegistry, () => fail("INVALID_MIGRATION", "Registry state migration cannot issue challenges"), state.snapshot);
  const snapshot = migratedKernel.snapshot();
  return Object.freeze({
    registrySha256: currentRegistrySha256,
    schemaVersion: state.schemaVersion,
    snapshot,
    snapshotSha256: sha256(canonicalJSON(snapshot)),
  });
}

function assertReviewedTransition(expected, current) {
  const companion = current.products.find((product) => product.productId === WEB_COMPANION.productId);
  const retained = current.products.filter((product) => product.productId !== WEB_COMPANION.productId);
  const withoutCompanion = { ...current, products: retained };
  if (canonicalJSON(companion) !== canonicalJSON(WEB_COMPANION) || canonicalJSON(withoutCompanion) !== canonicalJSON(expected)) {
    fail("UNSUPPORTED_REGISTRY_MIGRATION", "Current Product Session registry is not the exact reviewed v2-to-v3 retirement and Web companion transition");
  }
}

export function productSessionRegistryV2MigrationSource(input) {
  const migrated = migrateProductSessionRegistryV2(input);
  return Object.freeze({
    schemaVersion: 2,
    chainId: migrated.chainId,
    wallet: migrated.wallet,
    products: Object.freeze(migrated.products.map(({ retiredClients: _retiredClients, ...product }) => Object.freeze(product))),
  });
}

function parseEnvelope(input, registrySha256) {
  exactFields(input, ENVELOPE_FIELDS, "Product Session Gateway Node state envelope");
  if (input.schemaVersion !== 1 || input.registrySha256 !== registrySha256 || typeof input.snapshotSha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.snapshotSha256) || input.snapshotSha256 !== sha256(canonicalJSON(input.snapshot))) {
    fail("REGISTRY_STATE_MISMATCH", "Product Session Gateway copied state is not bound to the reviewed v2 registry");
  }
  return input;
}

function sha256(value) { return bytesToHex(sha256Digest(utf8ToBytes(value))); }
function fail(code, message) { throw new WalletAuthError(code, message); }
