#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function expectedFromPackage(packageRoot) {
  const packageManifest = readJSON(path.join(packageRoot, "package-manifest.json"));
  if (!Array.isArray(packageManifest.roles) || packageManifest.roles.length !== 4) {
    throw new Error("candidate package must contain four roles");
  }
  const nodes = packageManifest.roles.map((role) => readJSON(path.join(packageRoot, "roles", role, "role-manifest.json")).node);
  return { packageManifest, nodes };
}

function verify(packageRoot, evidenceRoot) {
  const { packageManifest, nodes } = expectedFromPackage(packageRoot);
  const expectedAddresses = nodes.map((node) => node.consensusAddress).sort();
  const expectedNodeIDs = new Set(nodes.map((node) => node.nodeId));
  const results = [];
  let commonHeight = null;
  let commonHash = null;
  const observedSigners = new Set();
  for (const node of nodes) {
    const roleRoot = path.join(evidenceRoot, node.role);
    const status = readJSON(path.join(roleRoot, "status.json")).result;
    const validators = readJSON(path.join(roleRoot, "validators.json")).result;
    const netInfo = readJSON(path.join(roleRoot, "net_info.json")).result;
    const block = readJSON(path.join(roleRoot, "block.json")).result;
    if (!status || status.node_info?.network !== packageManifest.chainId) {
      throw new Error(`${node.role} status chain ID mismatch`);
    }
    if (status.validator_info?.address !== node.consensusAddress) {
      throw new Error(`${node.role} validator identity mismatch`);
    }
    const height = Number(block?.block?.header?.height);
    const hash = block?.block_id?.hash;
    if (!Number.isSafeInteger(height) || height <= 0 || !/^[0-9A-F]{64}$/.test(hash || "")) {
      throw new Error(`${node.role} block evidence is invalid`);
    }
    if (commonHeight === null) {
      commonHeight = height;
      commonHash = hash;
    } else if (height !== commonHeight || hash !== commonHash) {
      throw new Error(`${node.role} does not match the common candidate block`);
    }
    const validatorAddresses = (validators?.validators || []).map((validator) => validator.address).sort();
    if (JSON.stringify(validatorAddresses) !== JSON.stringify(expectedAddresses)) {
      throw new Error(`${node.role} validator set differs from the approved package`);
    }
    const signatures = (block?.block?.last_commit?.signatures || []).filter((signature) => signature.block_id_flag === 2 && expectedAddresses.includes(signature.validator_address));
    if (signatures.length < 3) {
      throw new Error(`${node.role} common block has fewer than three approved precommit signatures`);
    }
    signatures.forEach((signature) => observedSigners.add(signature.validator_address));
    const peers = Number(netInfo?.n_peers);
    if (!Number.isSafeInteger(peers) || peers < 3) {
      throw new Error(`${node.role} has fewer than three P2P peers`);
    }
    const peerIDs = new Set((netInfo?.peers || []).map((peer) => peer.node_info?.id).filter(Boolean));
    for (const expectedID of expectedNodeIDs) {
      if (expectedID !== node.nodeId && !peerIDs.has(expectedID)) {
        throw new Error(`${node.role} is missing approved peer ${expectedID}`);
      }
    }
    results.push({ role: node.role, validatorAddress: node.consensusAddress, height, hash, peers, precommitSignatures: signatures.length });
  }
  if (observedSigners.size < 3) {
    throw new Error("candidate evidence does not prove a greater-than-two-thirds commit");
  }
  return {
    schemaVersion: 1,
    status: "passed",
    scope: "remote-parallel-consensus-candidate",
    publicCutoverAuthorized: false,
    chainId: packageManifest.chainId,
    genesisHash: packageManifest.genesisHash,
    migrationStateHash: packageManifest.migrationStateHash,
    commonHeight,
    commonHash,
    observedSignerCount: observedSigners.size,
    nodes: results,
  };
}

function writeSelfTestEvidence(packageRoot, evidenceRoot) {
  const { packageManifest, nodes } = expectedFromPackage(packageRoot);
  const signatures = nodes.slice(0, 3).map((node) => ({ block_id_flag: 2, validator_address: node.consensusAddress }));
  for (const node of nodes) {
    const roleRoot = path.join(evidenceRoot, node.role);
    fs.mkdirSync(roleRoot, { recursive: true });
    const peers = nodes.filter((peer) => peer.role !== node.role).map((peer) => ({ node_info: { id: peer.nodeId } }));
    const files = {
      "status.json": { result: { node_info: { network: packageManifest.chainId }, validator_info: { address: node.consensusAddress } } },
      "validators.json": { result: { validators: nodes.map((entry) => ({ address: entry.consensusAddress, voting_power: "1" })) } },
      "net_info.json": { result: { n_peers: "3", peers } },
      "block.json": { result: { block_id: { hash: "A".repeat(64) }, block: { header: { height: "42" }, last_commit: { signatures } } } },
    };
    for (const [name, value] of Object.entries(files)) {
      fs.writeFileSync(path.join(roleRoot, name), `${JSON.stringify(value)}\n`);
    }
  }
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  const packageRoot = args[1];
  if (!packageRoot) throw new Error("--self-test requires a candidate package");
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-consensus-evidence-"));
  try {
    writeSelfTestEvidence(packageRoot, evidenceRoot);
    const result = verify(packageRoot, evidenceRoot);
    if (result.status !== "passed" || result.publicCutoverAuthorized !== false || result.nodes.length !== 4) throw new Error("candidate evidence self-test did not pass");
    const primaryBlock = path.join(evidenceRoot, result.nodes[0].role, "block.json");
    const tampered = readJSON(primaryBlock);
    tampered.result.block_id.hash = "B".repeat(64);
    fs.writeFileSync(primaryBlock, `${JSON.stringify(tampered)}\n`);
    let rejected = false;
    try { verify(packageRoot, evidenceRoot); } catch { rejected = true; }
    if (!rejected) throw new Error("candidate evidence self-test accepted a divergent block hash");
    console.log("consensus candidate evidence self-test passed");
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
} else {
  const [packageRoot, evidenceRoot, outputPath] = args;
  if (!packageRoot || !evidenceRoot || !outputPath) {
    throw new Error("usage: consensus-candidate-evidence.mjs <package> <evidence-dir> <output-json>");
  }
  const result = verify(packageRoot, evidenceRoot);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(`candidate evidence passed: height=${result.commonHeight} hash=${result.commonHash} signers=${result.observedSignerCount}`);
}
