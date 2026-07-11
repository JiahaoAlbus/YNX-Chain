#!/usr/bin/env node

import fs from "node:fs";

const [labManifestPath, outputPath] = process.argv.slice(2);
if (!labManifestPath || !outputPath) {
  throw new Error("usage: build-consensus-production-fixture.mjs <lab-manifest> <output>");
}

const lab = JSON.parse(fs.readFileSync(labManifestPath, "utf8"));
const roleByAddress = {
  ynx_validator_primary: "primary",
  ynx_validator_singapore: "singapore",
  ynx_validator_silicon_valley: "silicon-valley",
  ynx_validator_seoul: "seoul",
};
const privateHostByRole = {
  primary: "10.42.0.1",
  singapore: "10.42.0.2",
  "silicon-valley": "10.42.0.3",
  seoul: "10.42.0.4",
};

if (!Array.isArray(lab.nodes) || lab.nodes.length !== 4) {
  throw new Error("local consensus lab must contain exactly four nodes");
}
const validators = lab.nodes.map((node) => {
  const role = roleByAddress[node.validatorAddress];
  if (!role) {
    throw new Error(`unexpected local fixture validator ${node.validatorAddress}`);
  }
  return {
    validatorAddress: node.validatorAddress,
    role,
    privateP2PHost: privateHostByRole[role],
    p2pPort: 27656,
    nodeId: node.nodeId,
    consensusKeyType: node.consensusKeyType,
    consensusPubKey: node.consensusPubKey,
    consensusAddress: node.consensusAddress,
  };
});
const output = {
  version: 1,
  purpose: "ynx-production-bft-candidate-public-keys-only",
  chainId: lab.chainId,
  validators,
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (/priv_key|privateKey|mnemonic/i.test(serialized)) {
  throw new Error("public production fixture unexpectedly contains private key fields");
}
fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
