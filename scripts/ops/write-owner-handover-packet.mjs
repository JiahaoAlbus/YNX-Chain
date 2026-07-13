#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toYNXAddress } from "../../sdk/js/index.js";
import { assertNoSecretFields, inventoryCore, normalizeRecord, readRestricted, serviceRoles, sha256, validateInventory, validatorRoles } from "../verify/lib/owner-handover.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requiredEnv = ["YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST", "YNX_OWNER_HANDOVER_SERVICE_SIGNER_MANIFEST", "YNX_OWNER_HANDOVER_SERVICE_SIGNER_STATUS"];
for (const name of requiredEnv) if (!process.env[name]) throw new Error(`${name} is required`);
const validatorPath = path.resolve(process.env.YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST);
const servicePath = path.resolve(process.env.YNX_OWNER_HANDOVER_SERVICE_SIGNER_MANIFEST);
const statusPath = path.resolve(process.env.YNX_OWNER_HANDOVER_SERVICE_SIGNER_STATUS);
const catalogPath = path.resolve(process.env.YNX_OWNER_HANDOVER_OPERATIONAL_CATALOG || path.join(repoRoot, "docs/custody/OWNER_HANDOVER_OPERATIONAL_ACCOUNTS.json"));

const validatorSource = readRestricted(validatorPath, "validator public manifest");
const serviceSource = readRestricted(servicePath, "service signer public manifest");
const statusSource = readRestricted(statusPath, "service signer ceremony status");
const catalogRaw = fs.readFileSync(catalogPath);
const catalog = JSON.parse(catalogRaw);
assertNoSecretFields(validatorSource.value, "validator public manifest");
assertNoSecretFields(serviceSource.value, "service signer public manifest");
assertNoSecretFields(statusSource.value, "service signer status");
assertNoSecretFields(catalog, "operational account catalog");

const validators = validatorSource.value;
if (validators.version !== 1 || validators.purpose !== "ynx-production-bft-candidate-public-keys-only" || validators.chainId !== "ynx_6423-1" || !Array.isArray(validators.validators) || validators.validators.length !== 4) throw new Error("validator public manifest identity is invalid");
const validatorRecords = validatorRoles.map((role, index) => {
  const record = validators.validators[index];
  if (record?.role !== role || record.validatorAddress !== `ynx_validator_${role.replaceAll("-", "_")}` || record.consensusKeyType !== "tendermint/PubKeyEd25519" || !/^[A-Za-z0-9+/]{43}=$/.test(record.consensusPubKey || "") || !/^[0-9A-F]{40}$/.test(record.consensusAddress || "") || !/^[0-9a-f]{40}$/.test(record.nodeId || "")) throw new Error(`validator ${role} public identity is invalid`);
  return normalizeRecord({
    id: `validator-${role}`,
    category: "production-validator",
    identityType: "cometbft-ed25519-validator",
    publicIdentity: record.consensusAddress,
    publicAlias: record.validatorAddress,
    secondaryPublicIdentity: record.nodeId,
    role,
    environment: "public-testnet-bft-candidate",
    custodyLocationClass: "owner-controlled-host-local",
    fundingState: "not-applicable",
    recoveryStatus: "not-verified-by-handover-packet",
    rotationStatus: "not-verified-by-handover-packet",
    remoteInstallStatus: "public-manifest-bound-host-key",
    handoverStatus: "not-verified",
    handoverRequired: true,
  });
});
if (new Set(validatorRecords.map((record) => record.publicIdentity)).size !== 4 || new Set(validatorRecords.map((record) => record.secondaryPublicIdentity)).size !== 4) throw new Error("validator public identities must be distinct");

const serviceManifest = serviceSource.value;
const serviceStatus = statusSource.value;
if (serviceManifest.schemaVersion !== 1 || serviceManifest.purpose !== "ynx-production-service-signer-public-manifest" || !Array.isArray(serviceManifest.records) || serviceManifest.records.length !== 5) throw new Error("service signer public manifest identity is invalid");
const serviceManifestSha256 = sha256(serviceSource.raw);
if (serviceStatus.schemaVersion !== 1 || serviceStatus.purpose !== "ynx-production-service-signer-ceremony-status" || serviceStatus.publicManifestSha256 !== serviceManifestSha256 || serviceStatus.signerCount !== 5 || serviceStatus.distinctAddressesVerified !== true || serviceStatus.ownerLocalKeysModeRestricted !== true || serviceStatus.ownerDesignatedRecoveryCopyMatched !== true) throw new Error("service signer ceremony status is invalid");
for (const field of ["remoteSignerInstallCompleted", "offlineRecoveryVerified", "ownerHandoverVerified", "rotationProcedureVerified", "independentCustodyReviewVerified"]) if (serviceStatus[field] !== false) throw new Error(`source service signer status ${field} must remain false until external evidence exists`);
const serviceRecords = serviceRoles.map((role, index) => {
  const record = serviceManifest.records[index];
  if (record?.role !== role || record.purpose !== `ynx-production-${role}-signer` || !/^0x[0-9a-f]{40}$/.test(record.address || "")) throw new Error(`service signer ${role} public identity is invalid`);
  return normalizeRecord({
    id: `service-signer-${role}`,
    category: "service-signer",
    identityType: "secp256k1-account",
    publicIdentity: record.address,
    publicAlias: toYNXAddress(record.address),
    secondaryPublicIdentity: "",
    role,
    environment: "public-testnet-bft-candidate",
    custodyLocationClass: "owner-local-mode-0600",
    fundingState: "not-verified",
    recoveryStatus: "same-volume-staging-copy-matched-not-offline",
    rotationStatus: "not-verified",
    remoteInstallStatus: "not-installed",
    handoverStatus: "not-verified",
    handoverRequired: true,
  });
});
if (new Set(serviceRecords.map((record) => record.publicIdentity)).size !== 5) throw new Error("service signer public identities must be distinct");

if (catalog.schemaVersion !== 1 || catalog.purpose !== "ynx-owner-handover-operational-account-catalog" || !Array.isArray(catalog.records) || catalog.records.length === 0) throw new Error("operational account catalog identity is invalid");
const operationalRecords = catalog.records.map(normalizeRecord);
const records = [...validatorRecords, ...serviceRecords, ...operationalRecords];
const commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const generatedAt = new Date().toISOString();
const readiness = {
  recordCount: records.length,
  validatorCount: validatorRecords.length,
  serviceSignerCount: serviceRecords.length,
  handoverRequiredCount: records.filter((record) => record.handoverRequired).length,
  unknownOwnershipCount: records.filter((record) => record.category === "external-or-unknown").length,
  offlineRecoveryVerified: false,
  ownerHandoverVerified: false,
  rotationProcedureVerified: false,
  remoteServiceSignerInstallCompleted: false,
  independentCustodyReviewVerified: false,
  publicBFTReady: false,
};
const inventory = {
  schemaVersion: 1,
  purpose: "ynx-owner-handover-public-inventory",
  commit,
  generatedAt,
  sources: {
    validatorManifestSha256: sha256(validatorSource.raw),
    serviceSignerManifestSha256: serviceManifestSha256,
    serviceSignerStatusSha256: sha256(statusSource.raw),
    operationalCatalogSha256: sha256(catalogRaw),
  },
  records,
  readiness,
};
inventory.inventoryDigest = `sha256:${sha256(`${JSON.stringify(inventoryCore(inventory))}\n`)}`;
validateInventory(inventory, commit);

const packetId = process.env.YNX_OWNER_HANDOVER_PACKET_ID || `owner-handover-${commit}-${generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(packetId)) throw new Error("YNX_OWNER_HANDOVER_PACKET_ID is invalid");
const outputRoot = path.resolve(process.env.YNX_OWNER_HANDOVER_OUTPUT_DIR || path.join(repoRoot, "tmp/owner-handover"), packetId);
if (fs.existsSync(outputRoot)) throw new Error(`owner handover packet already exists: ${outputRoot}`);
fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(outputRoot, 0o700);
const inventoryPath = path.join(outputRoot, "inventory.json");
fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(inventoryPath, 0o600);
const inventoryFileSha256 = sha256(fs.readFileSync(inventoryPath));
const requiredIds = records.filter((record) => record.handoverRequired).map((record) => record.id);
const receipt = {
  schemaVersion: 1,
  action: "ynx-owner-custody-handover",
  receiptId: `pending-${packetId}`,
  owner: "",
  independentReviewer: "",
  acknowledged: false,
  commit,
  inventoryDigest: inventory.inventoryDigest,
  inventoryFileSha256,
  recordCount: records.length,
  handoverRequiredIds: requiredIds,
  allIdentitiesClassified: readiness.unknownOwnershipCount === 0,
  validatorRecoveryVerified: false,
  serviceSignerOfflineRecoveryVerified: false,
  ownerHandoverVerified: false,
  rotationProcedureVerified: false,
  validatorRecoveryEvidence: "",
  serviceSignerRecoveryEvidence: "",
  ownerHandoverEvidence: "",
  rotationProcedureEvidence: "",
  acknowledgedAt: "",
  expiresAt: "",
};
const receiptPath = path.join(outputRoot, "receipt.template.json");
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(receiptPath, 0o600);
const requestPath = path.join(outputRoot, "HANDOVER_REQUEST.md");
const request = `# Owner Custody Handover Request

This packet contains public identities, status classifications, and hashes only. It does not contain or transfer a private key, mnemonic, PEM, token, or password, and it does not authorize a network mutation.

- Commit: \`${commit}\`
- Inventory digest: \`${inventory.inventoryDigest}\`
- Inventory file SHA-256: \`${inventoryFileSha256}\`
- Records: ${records.length} total; ${requiredIds.length} require owner handover
- Production validators: 4
- Future BFT service signers: 5
- Authoritative \`ynx_faucet\`: runtime state account with no mnemonic/private key
- Public address proof account: funded smoke-only test identity, not a secure production wallet
- Public BFT ready: false

The owner and independent reviewer must be different people. Keep evidence fields as compact non-secret references. Set recovery, handover, and rotation assertions to true only after observing the corresponding external procedure. A same-volume staging copy is not offline recovery.

Validate a completed mode-0600 receipt with:

\`node scripts/verify/validate-owner-handover-receipt.mjs '${receiptPath.replaceAll("'", `'"'"'`)}' '${inventoryPath.replaceAll("'", `'"'"'`)}' ${commit}\`

Validation emits exact receipt and inventory hashes. It does not install signers, move funds, or authorize freeze, pause, ingress, candidate start, or BFT cutover.
`;
fs.writeFileSync(requestPath, request, { mode: 0o600 });
fs.chmodSync(requestPath, 0o600);

console.log(`owner handover inventory: ${inventoryPath}`);
console.log(`owner handover receipt template: ${receiptPath}`);
console.log(`owner handover request: ${requestPath}`);
console.log(`inventory=${inventory.inventoryDigest} records=${records.length} handoverRequired=${requiredIds.length} publicBFTReady=false`);
