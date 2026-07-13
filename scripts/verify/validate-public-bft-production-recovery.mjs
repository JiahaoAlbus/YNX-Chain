#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const roles = ["primary", "singapore", "silicon-valley", "seoul"];
const validators = {
  primary: "ynx_validator_primary",
  singapore: "ynx_validator_singapore",
  "silicon-valley": "ynx_validator_silicon_valley",
  seoul: "ynx_validator_seoul",
};

function fail(message) {
  throw new Error(`production recovery evidence invalid: ${message}`);
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${file}: ${error.message}`);
  }
}

function validate(root, commit, release) {
  if (!/^[0-9a-f]{12}$/.test(commit) || release !== `ynx-chain-${commit}`) fail("invalid expected release identity");
  const hashes = new Set();
  const blockHeights = new Set();
  const beforeHeights = {};
  const afterHeights = {};
  for (const role of roles) {
    const before = readJSON(path.join(root, "roles", `${role}-before-status.json`));
    const after = readJSON(path.join(root, "roles", `${role}-after-status.json`));
    const block = readJSON(path.join(root, "roles", `${role}-block.json`));
    const checks = fs.readFileSync(path.join(root, "roles", `${role}-recovery.txt`), "utf8").split(/\r?\n/);
    const expectedMode = role === "primary" ? "authoritative_producer" : "authoritative_follower";
    const expectedProduction = role === "primary";
    for (const [stage, status] of [["before", before], ["after", after]]) {
      if (Number(status.chainId) !== 6423 || status.nativeCurrencySymbol !== "YNXT") fail(`${role} ${stage} chain identity mismatch`);
      if (status.build?.commit !== commit || status.build?.release !== release) fail(`${role} ${stage} release mismatch`);
      if (status.nodeIdentity?.validatorAddress !== validators[role]) fail(`${role} ${stage} validator mismatch`);
      if (status.nodeIdentity?.replicationMode !== expectedMode || status.nodeIdentity?.blockProductionEnabled !== expectedProduction) fail(`${role} ${stage} authoritative mode mismatch`);
      if (!Number.isSafeInteger(Number(status.height))) fail(`${role} ${stage} height invalid`);
    }
    beforeHeights[role] = Number(before.height);
    afterHeights[role] = Number(after.height);
    if (afterHeights[role] < beforeHeights[role]) fail(`${role} height regressed`);
    for (const marker of [`role=${role}`, "freeze=absent", "services=active", "status_read=200", "evm_read=200", "mutations=unfrozen"]) {
      if (!checks.includes(marker)) fail(`${role} missing ${marker}`);
    }
    if (!Number.isSafeInteger(Number(block.height)) || !/^[0-9a-f]{64}$/.test(String(block.hash || ""))) fail(`${role} block evidence invalid`);
    blockHeights.add(Number(block.height));
    hashes.add(block.hash);
  }
  if (afterHeights.primary <= beforeHeights.primary) fail("authoritative producer did not resume block growth");
  if (Math.max(...Object.values(afterHeights)) - Math.min(...Object.values(afterHeights)) > 4) fail("recovered roles exceed convergence lag bound");
  if (blockHeights.size !== 1 || hashes.size !== 1) fail("recovered roles do not agree on fixed-height block hash");
  return {
    status: "passed",
    commit,
    release,
    beforeHeights,
    afterHeights,
    convergenceHeight: [...blockHeights][0],
    convergenceHash: [...hashes][0],
    freezeRemoved: true,
    authoritativePaused: false,
    publicIngressChanged: false,
  };
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-production-recovery-"));
  const commit = "abc123def456";
  const release = `ynx-chain-${commit}`;
  fs.mkdirSync(path.join(root, "roles"), { recursive: true });
  for (const [index, role] of roles.entries()) {
    const identity = { validatorAddress: validators[role], replicationMode: role === "primary" ? "authoritative_producer" : "authoritative_follower", blockProductionEnabled: role === "primary" };
    const base = { chainId: 6423, nativeCurrencySymbol: "YNXT", build: { commit, release }, nodeIdentity: identity };
    fs.writeFileSync(path.join(root, "roles", `${role}-before-status.json`), JSON.stringify({ ...base, height: 100 - index }));
    fs.writeFileSync(path.join(root, "roles", `${role}-after-status.json`), JSON.stringify({ ...base, height: 103 - index }));
    fs.writeFileSync(path.join(root, "roles", `${role}-block.json`), JSON.stringify({ height: 97, hash: "2".repeat(64) }));
    fs.writeFileSync(path.join(root, "roles", `${role}-recovery.txt`), [`role=${role}`, "freeze=absent", "services=active", "status_read=200", "evm_read=200", "mutations=unfrozen"].join("\n"));
  }
  validate(root, commit, release);
  const badPath = path.join(root, "roles", "seoul-recovery.txt");
  fs.writeFileSync(badPath, fs.readFileSync(badPath, "utf8").replace("mutations=unfrozen", "mutations=frozen"));
  try { validate(root, commit, release); fail("frozen recovery fixture unexpectedly passed"); } catch (error) { if (!String(error.message).includes("mutations=unfrozen")) throw error; }
  fs.rmSync(root, { recursive: true, force: true });
  console.log("public-bft-production-recovery-check passed: release identity, authoritative growth, convergence, reads, service health, and unfreeze evidence fail closed");
}

if (process.argv[2] === "--self-test") {
  selfTest();
} else {
  const [root, commit, release] = process.argv.slice(2);
  if (!root || !commit || !release) fail("usage: validate-public-bft-production-recovery.mjs <evidence-dir> <commit> <release>");
  console.log(JSON.stringify(validate(root, commit, release), null, 2));
}
