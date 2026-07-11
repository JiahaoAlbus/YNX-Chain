#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const [validatorRecordsRoot, overlayRecordsRoot, output] = process.argv.slice(2);
if (!validatorRecordsRoot || !overlayRecordsRoot || !output) {
  throw new Error("usage: build-production-validator-manifest.mjs <validator-records> <overlay-records> <output>");
}
const roles = ["primary", "singapore", "silicon-valley", "seoul"];
const validators = roles.map((role) => {
  const validator = JSON.parse(fs.readFileSync(path.join(validatorRecordsRoot, `${role}.json`), "utf8"));
  const overlay = JSON.parse(fs.readFileSync(path.join(overlayRecordsRoot, `${role}.json`), "utf8"));
  if (validator.role !== role || overlay.role !== role || validator.custodyBoundary !== "owner-controlled-host-local" || overlay.custodyBoundary !== "owner-controlled-host-local" || validator.privateKeysRemainOnHost !== undefined || overlay.privateKeysRemainOnHost !== undefined) {
    throw new Error(`invalid custody or role boundary for ${role}`);
  }
  return {
    validatorAddress: validator.validatorAddress,
    role,
    privateP2PHost: overlay.overlayAddress,
    p2pPort: 27656,
    nodeId: validator.nodeId,
    consensusKeyType: validator.consensusKeyType,
    consensusPubKey: validator.consensusPubKey,
    consensusAddress: validator.consensusAddress,
  };
});
if (new Set(validators.map((validator) => validator.nodeId)).size !== 4 || new Set(validators.map((validator) => validator.consensusAddress)).size !== 4 || new Set(validators.map((validator) => validator.privateP2PHost)).size !== 4) {
  throw new Error("production validator manifest identities must be unique");
}
const manifest = { version: 1, purpose: "ynx-production-bft-candidate-public-keys-only", chainId: "ynx_6423-1", validators };
const payload = `${JSON.stringify(manifest, null, 2)}\n`;
if (/priv_key|privateKey|mnemonic|wireguard\.key/i.test(payload)) throw new Error("production validator manifest contains a forbidden secret field");
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
fs.writeFileSync(output, payload, { mode: 0o600 });
fs.chmodSync(output, 0o600);
console.log(`production validator public manifest ready: validators=${validators.length} output=${output}`);
