import { sha256 as sha256Digest } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { ProductSessionGatewayKernel } from "./product-session-gateway.js";
import { migrateProductSessionRegistryV2, parseProductSessionRegistry } from "./product-session-registry.js";

const ENVELOPE_FIELDS = ["registrySha256", "schemaVersion", "snapshot", "snapshotSha256"];
const INPUT_FIELDS = ["currentRegistry", "previousRegistry", "stateEnvelope"];
const LEGACY_6CF_ENVELOPE_FIELDS = ["schemaVersion", "snapshot", "snapshotDigest"];
const LEGACY_6CF_INPUT_FIELDS = ["currentRegistryBytes", "expectedCurrentRegistryFileSha256", "expectedPreviousRegistryFileSha256", "expectedSourceStateFileSha256", "previousRegistryBytes", "stateBytes"];
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

export function migrateLegacy6cfProductSessionGatewayNodeState(input) {
  exactFields(input, LEGACY_6CF_INPUT_FIELDS, "Legacy 6cf Product Session state migration input");
  const currentRegistryBytes = exactBytes(input.currentRegistryBytes, "current registry");
  const previousRegistryBytes = exactBytes(input.previousRegistryBytes, "previous registry");
  const stateBytes = exactBytes(input.stateBytes, "source state");
  assertFileDigest(currentRegistryBytes, input.expectedCurrentRegistryFileSha256, "current registry");
  assertFileDigest(previousRegistryBytes, input.expectedPreviousRegistryFileSha256, "previous registry");
  assertFileDigest(stateBytes, input.expectedSourceStateFileSha256, "source state");
  const currentRegistry = parseJson(currentRegistryBytes, "current registry");
  const previousRegistry = parseJson(previousRegistryBytes, "previous registry");
  const legacy = parseCanonicalLegacy6cfEnvelope(stateBytes);
  const previousRegistrySha256 = sha256(canonicalJSON(productSessionRegistryV2MigrationSource(previousRegistry)));
  return migrateProductSessionGatewayNodeStateRegistryV2({
    currentRegistry,
    previousRegistry,
    stateEnvelope: {
      registrySha256: previousRegistrySha256,
      schemaVersion: legacy.schemaVersion,
      snapshot: legacy.snapshot,
      snapshotSha256: legacy.snapshotDigest,
    },
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

function parseCanonicalLegacy6cfEnvelope(bytes) {
  if (!bytes.endsWith("\n") || bytes.slice(0, -1).includes("\n")) fail("INVALID_MIGRATION", "Legacy 6cf Product Session state must be one canonical JSON line");
  const parsed = parseJson(bytes, "legacy 6cf Product Session state");
  exactFields(parsed, LEGACY_6CF_ENVELOPE_FIELDS, "Legacy 6cf Product Session state envelope");
  if (canonicalJSON(parsed) !== bytes.slice(0, -1) || parsed.schemaVersion !== 1 || typeof parsed.snapshotDigest !== "string" || !/^[0-9a-f]{64}$/.test(parsed.snapshotDigest) || parsed.snapshotDigest !== sha256(canonicalJSON(parsed.snapshot))) {
    fail("REGISTRY_STATE_MISMATCH", "Legacy 6cf Product Session copied state failed canonical digest verification");
  }
  return parsed;
}

function exactBytes(value, label) {
  if (typeof value !== "string" || value.length < 2 || value.length > 64 * 1024 * 1024) fail("INVALID_MIGRATION", `${label} bytes are invalid`);
  return value;
}

function assertFileDigest(bytes, expected, label) {
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected) || sha256(bytes) !== expected) fail("SOURCE_DIGEST_MISMATCH", `${label} file digest does not match the reviewed migration input`);
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes); } catch { fail("INVALID_MIGRATION", `${label} is not JSON`); }
}

function sha256(value) { return bytesToHex(sha256Digest(utf8ToBytes(value))); }
function fail(code, message) { throw new WalletAuthError(code, message); }
