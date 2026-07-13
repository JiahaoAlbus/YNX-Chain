import crypto from "node:crypto";
import fs from "node:fs";

export const validatorRoles = Object.freeze(["primary", "singapore", "silicon-valley", "seoul"]);
export const serviceRoles = Object.freeze(["faucet", "ai", "pay", "trust", "resource"]);
export const recordKeys = Object.freeze([
  "id", "category", "identityType", "publicIdentity", "publicAlias", "secondaryPublicIdentity", "role", "environment",
  "custodyLocationClass", "fundingState", "recoveryStatus", "rotationStatus", "remoteInstallStatus", "handoverStatus", "handoverRequired",
]);

const categories = new Set([
  "production-validator", "service-signer", "faucet-operator-signer", "funded-test-account", "deterministic-smoke-only-account", "external-or-unknown",
]);
const forbiddenField = /(^|_)(private|secret|mnemonic|seed|password|token|pem)(_|$)|privatekey|secretpath/i;

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function readRestricted(file, label) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error(`${label} must be a mode-restricted regular file`);
  const raw = fs.readFileSync(file);
  return { raw, value: JSON.parse(raw) };
}

export function assertNoSecretFields(value, label = "handover data") {
  const visit = (item) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    for (const [key, nested] of Object.entries(item)) {
      if (forbiddenField.test(key)) throw new Error(`${label} contains forbidden secret field ${key}`);
      visit(nested);
    }
  };
  visit(value);
}

export function normalizeRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("handover record must be an object");
  if (Object.keys(record).sort().join(",") !== [...recordKeys].sort().join(",")) throw new Error(`handover record ${record.id || "unknown"} has unexpected fields`);
  for (const key of recordKeys.filter((key) => key !== "handoverRequired")) {
    if (typeof record[key] !== "string") throw new Error(`handover record ${record.id || "unknown"} field ${key} must be text`);
  }
  if (typeof record.handoverRequired !== "boolean") throw new Error(`handover record ${record.id || "unknown"} handoverRequired must be boolean`);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(record.id) || !categories.has(record.category) || !record.publicIdentity) throw new Error(`handover record ${record.id || "unknown"} identity is invalid`);
  if (record.category === "production-validator") {
    if (record.identityType !== "cometbft-ed25519-validator" || !/^[0-9A-F]{40}$/.test(record.publicIdentity) || !/^[0-9a-f]{40}$/.test(record.secondaryPublicIdentity) || !validatorRoles.includes(record.role)) throw new Error(`validator record ${record.id} is invalid`);
  }
  if (record.category === "service-signer") {
    if (record.identityType !== "secp256k1-account" || !/^0x[0-9a-f]{40}$/.test(record.publicIdentity) || !/^ynx1[02-9ac-hj-np-z]{38}$/.test(record.publicAlias) || !serviceRoles.includes(record.role)) throw new Error(`service signer record ${record.id} is invalid`);
  }
  if (record.category === "funded-test-account" && record.handoverRequired) throw new Error(`funded test account ${record.id} cannot be treated as a production handover key`);
  if (record.category === "external-or-unknown" && record.fundingState !== "not-applicable") throw new Error(`funded or active identity ${record.id} cannot have unknown ownership`);
  return Object.fromEntries(recordKeys.map((key) => [key, record[key]]));
}

export function inventoryCore(inventory) {
  return {
    schemaVersion: inventory.schemaVersion,
    purpose: inventory.purpose,
    commit: inventory.commit,
    generatedAt: inventory.generatedAt,
    sources: inventory.sources,
    records: inventory.records,
    readiness: inventory.readiness,
  };
}

export function validateInventory(inventory, expectedCommit) {
  const allowed = ["schemaVersion", "purpose", "commit", "generatedAt", "sources", "records", "readiness", "inventoryDigest"];
  if (Object.keys(inventory).sort().join(",") !== allowed.sort().join(",")) throw new Error("owner handover inventory has unexpected fields");
  assertNoSecretFields(inventory, "owner handover inventory");
  if (inventory.schemaVersion !== 1 || inventory.purpose !== "ynx-owner-handover-public-inventory" || inventory.commit !== expectedCommit || !Number.isFinite(Date.parse(inventory.generatedAt || ""))) throw new Error("owner handover inventory identity is invalid");
  const sourceKeys = ["validatorManifestSha256", "serviceSignerManifestSha256", "serviceSignerStatusSha256", "operationalCatalogSha256"];
  if (!inventory.sources || Object.keys(inventory.sources).sort().join(",") !== sourceKeys.sort().join(",")) throw new Error("owner handover inventory source binding is invalid");
  for (const key of sourceKeys) if (!/^[0-9a-f]{64}$/.test(inventory.sources[key] || "")) throw new Error(`owner handover inventory source ${key} is invalid`);
  if (!Array.isArray(inventory.records) || inventory.records.length < 9) throw new Error("owner handover inventory records are incomplete");
  inventory.records = inventory.records.map(normalizeRecord);
  if (new Set(inventory.records.map((record) => record.id)).size !== inventory.records.length) throw new Error("owner handover inventory record IDs are not distinct");
  if (new Set(inventory.records.map((record) => `${record.identityType}:${record.publicIdentity}`)).size !== inventory.records.length) throw new Error("owner handover public identities are not distinct");
  const validatorCount = inventory.records.filter((record) => record.category === "production-validator").length;
  const serviceSignerCount = inventory.records.filter((record) => record.category === "service-signer").length;
  const handoverRequiredCount = inventory.records.filter((record) => record.handoverRequired).length;
  const unknownOwnershipCount = inventory.records.filter((record) => record.category === "external-or-unknown").length;
  const expectedReadiness = {
    recordCount: inventory.records.length,
    validatorCount,
    serviceSignerCount,
    handoverRequiredCount,
    unknownOwnershipCount,
    offlineRecoveryVerified: false,
    ownerHandoverVerified: false,
    rotationProcedureVerified: false,
    remoteServiceSignerInstallCompleted: false,
    independentCustodyReviewVerified: false,
    publicBFTReady: false,
  };
  if (JSON.stringify(inventory.readiness) !== JSON.stringify(expectedReadiness) || validatorCount !== 4 || serviceSignerCount !== 5 || handoverRequiredCount !== 9) throw new Error("owner handover inventory readiness boundary is invalid");
  const digest = sha256(`${JSON.stringify(inventoryCore(inventory))}\n`);
  if (inventory.inventoryDigest !== `sha256:${digest}`) throw new Error("owner handover inventory digest mismatch");
  return inventory;
}
