#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { toYNXAddress } from "../../sdk/js/index.js";
import { inventoryCore, sha256, validateInventory } from "./lib/owner-handover.mjs";

const [outputDirInput, commit, serviceManifestInput] = process.argv.slice(2);
if (!outputDirInput || !/^[0-9a-f]{12}$/.test(commit || "")) throw new Error("usage: write-owner-handover-fixture.mjs <output-dir> <commit12>");
const outputDir = path.resolve(outputDirInput);
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
fs.chmodSync(outputDir, 0o700);
const roles = ["primary", "singapore", "silicon-valley", "seoul"];
const serviceRoles = ["faucet", "ai", "pay", "trust", "resource"];
const serviceManifestRaw = serviceManifestInput ? fs.readFileSync(path.resolve(serviceManifestInput)) : null;
const serviceManifest = serviceManifestRaw ? JSON.parse(serviceManifestRaw) : null;
if (serviceManifest && (!Array.isArray(serviceManifest.records) || serviceManifest.records.length !== 5)) throw new Error("fixture service manifest is invalid");
const records = [
  ...roles.map((role, index) => ({
    id: `validator-${role}`, category: "production-validator", identityType: "cometbft-ed25519-validator",
    publicIdentity: String.fromCharCode(65 + index).repeat(40), publicAlias: `ynx_validator_${role.replaceAll("-", "_")}`,
    secondaryPublicIdentity: String(index + 1).repeat(40), role, environment: "public-testnet-bft-candidate",
    custodyLocationClass: "owner-controlled-host-local", fundingState: "not-applicable", recoveryStatus: "not-verified-by-handover-packet",
    rotationStatus: "not-verified-by-handover-packet", remoteInstallStatus: "public-manifest-bound-host-key", handoverStatus: "not-verified", handoverRequired: true,
  })),
  ...serviceRoles.map((role, index) => {
    const source = serviceManifest?.records[index];
    const address = source?.address || `0x${String(index + 1).repeat(40)}`;
    if (source && (source.role !== role || source.purpose !== `ynx-production-${role}-signer` || !/^0x[0-9a-f]{40}$/.test(address))) throw new Error(`fixture service signer ${role} is invalid`);
    return {
      id: `service-signer-${role}`, category: "service-signer", identityType: "secp256k1-account", publicIdentity: address,
      publicAlias: toYNXAddress(address), secondaryPublicIdentity: "", role, environment: "public-testnet-bft-candidate",
      custodyLocationClass: "owner-local-mode-0600", fundingState: "not-verified", recoveryStatus: "same-volume-staging-copy-matched-not-offline",
      rotationStatus: "not-verified", remoteInstallStatus: "not-installed", handoverStatus: "not-verified", handoverRequired: true,
    };
  }),
  {
    id: "authoritative-faucet-runtime", category: "faucet-operator-signer", identityType: "authoritative-runtime-account", publicIdentity: "ynx_faucet",
    publicAlias: "", secondaryPublicIdentity: "", role: "authoritative-faucet", environment: "public-testnet-authoritative",
    custodyLocationClass: "no-private-key-runtime-state", fundingState: "runtime-protocol-balance", recoveryStatus: "state-backup-bound",
    rotationStatus: "not-applicable", remoteInstallStatus: "not-applicable", handoverStatus: "not-applicable", handoverRequired: false,
  },
  {
    id: "public-address-proof-account", category: "funded-test-account", identityType: "secp256k1-test-account",
    publicIdentity: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf", publicAlias: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",
    secondaryPublicIdentity: "", role: "public-address-proof", environment: "public-testnet", custodyLocationClass: "public-known-test-key-not-secure",
    fundingState: "funded-testnet-observed", recoveryStatus: "not-applicable", rotationStatus: "not-applicable", remoteInstallStatus: "not-applicable",
    handoverStatus: "not-applicable", handoverRequired: false,
  },
  {
    id: "remote-smoke-runtime-pattern", category: "deterministic-smoke-only-account", identityType: "authoritative-runtime-account-pattern",
    publicIdentity: "ynx_remote_smoke_*", publicAlias: "", secondaryPublicIdentity: "", role: "remote-smoke", environment: "public-testnet-authoritative",
    custodyLocationClass: "no-private-key-ephemeral-runtime-state", fundingState: "ephemeral-faucet-funded", recoveryStatus: "not-applicable",
    rotationStatus: "not-applicable", remoteInstallStatus: "not-applicable", handoverStatus: "not-applicable", handoverRequired: false,
  },
];
const generatedAt = new Date().toISOString();
const inventory = {
  schemaVersion: 1, purpose: "ynx-owner-handover-public-inventory", commit, generatedAt,
  sources: {
    validatorManifestSha256: "a".repeat(64), serviceSignerManifestSha256: serviceManifestRaw ? sha256(serviceManifestRaw) : "b".repeat(64),
    serviceSignerStatusSha256: "c".repeat(64), operationalCatalogSha256: "d".repeat(64),
  },
  records,
  readiness: {
    recordCount: 12, validatorCount: 4, serviceSignerCount: 5, handoverRequiredCount: 9, unknownOwnershipCount: 0,
    offlineRecoveryVerified: false, ownerHandoverVerified: false, rotationProcedureVerified: false,
    remoteServiceSignerInstallCompleted: false, independentCustodyReviewVerified: false, publicBFTReady: false,
  },
};
inventory.inventoryDigest = `sha256:${sha256(`${JSON.stringify(inventoryCore(inventory))}\n`)}`;
validateInventory(inventory, commit);
const inventoryPath = path.join(outputDir, "owner-handover-inventory.json");
fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(inventoryPath, 0o600);
const acknowledgedAt = new Date();
const expiresAt = new Date(acknowledgedAt.getTime() + 2 * 24 * 60 * 60 * 1000);
const receipt = {
  schemaVersion: 1, action: "ynx-owner-custody-handover", receiptId: `owner-fixture-${commit}`, owner: "owner fixture",
  independentReviewer: "independent handover fixture", acknowledged: true, commit, inventoryDigest: inventory.inventoryDigest,
  inventoryFileSha256: sha256(fs.readFileSync(inventoryPath)), recordCount: 12,
  handoverRequiredIds: records.filter((record) => record.handoverRequired).map((record) => record.id), allIdentitiesClassified: true,
  validatorRecoveryVerified: true, serviceSignerOfflineRecoveryVerified: true, ownerHandoverVerified: true, rotationProcedureVerified: true,
  validatorRecoveryEvidence: "offline:validator-restore-001", serviceSignerRecoveryEvidence: "offline:service-restore-001",
  ownerHandoverEvidence: "handover:owner-ack-001", rotationProcedureEvidence: "rotation:review-001",
  acknowledgedAt: acknowledgedAt.toISOString().replace(".000Z", "Z"), expiresAt: expiresAt.toISOString().replace(".000Z", "Z"),
};
const receiptPath = path.join(outputDir, "owner-handover-receipt.json");
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(receiptPath, 0o600);
process.stdout.write(`${JSON.stringify({
  ownerHandoverReceiptId: receipt.receiptId, owner: receipt.owner, ownerHandoverReviewer: receipt.independentReviewer,
  ownerHandoverInventoryDigest: inventory.inventoryDigest, ownerHandoverInventoryEvidence: `sha256:${sha256(fs.readFileSync(inventoryPath))}`,
  ownerHandoverReceiptEvidence: `sha256:${sha256(fs.readFileSync(receiptPath))}`,
})}\n`);
