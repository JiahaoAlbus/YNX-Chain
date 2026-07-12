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
  throw new Error(`production rehearsal evidence invalid: ${message}`);
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
  const heights = new Set();
  for (const role of roles) {
    const roleDir = path.join(root, "roles", role);
    const status = readJSON(path.join(roleDir, "status.json"));
    const block = readJSON(path.join(roleDir, "block.json"));
    const checks = fs.readFileSync(path.join(roleDir, "preflight.txt"), "utf8");
    const expectedMode = role === "primary" ? "authoritative_producer" : "authenticated_follower";
    const expectedProduction = role === "primary";
    if (Number(status.chainId) !== 6423 || status.nativeCurrencySymbol !== "YNXT") fail(`${role} chain identity mismatch`);
    if (status.build?.commit !== commit || status.build?.release !== release) fail(`${role} release mismatch`);
    if (status.nodeIdentity?.validatorAddress !== validators[role]) fail(`${role} validator identity mismatch`);
    if (status.nodeIdentity?.replicationMode !== expectedMode || status.nodeIdentity?.blockProductionEnabled !== expectedProduction) fail(`${role} authoritative role mismatch`);
    for (const marker of [`role=${role}`, `validator=${validators[role]}`, `release=${release}`, "services=active", "overlay=active", "keys=restricted", "candidate=absent", "freeze=absent", "ports=free", "disk=ready", "backup=present"]) {
      if (!checks.split(/\r?\n/).includes(marker)) fail(`${role} missing ${marker}`);
    }
    if (!/^manifest_sha256=[0-9a-f]{64}$/m.test(checks)) fail(`${role} manifest checksum missing`);
    if (!Number.isSafeInteger(Number(block.height)) || !/^[0-9a-f]{64}$/.test(String(block.hash || ""))) fail(`${role} block evidence invalid`);
    heights.add(Number(block.height));
    hashes.add(block.hash);
  }
  if (heights.size !== 1 || hashes.size !== 1) fail("four roles do not agree on fixed-height block hash");
  const binaries = fs.readFileSync(path.join(root, "prebuilt.sha256"), "utf8").trim().split(/\r?\n/);
  if (binaries.length !== 4 || binaries.some((line) => !/^[0-9a-f]{64}\s+/.test(line))) fail("prebuilt binary checksums incomplete");
  return { status: "passed", commit, release, roles: roles.length, height: [...heights][0], hash: [...hashes][0], remoteMutation: false, publicIngressChanged: false };
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-production-rehearsal-"));
  const commit = "abc123def456";
  const release = `ynx-chain-${commit}`;
  fs.mkdirSync(path.join(root, "roles"), { recursive: true });
  fs.writeFileSync(path.join(root, "prebuilt.sha256"), ["a", "b", "c", "d"].map((name) => `${"1".repeat(64)}  ${name}`).join("\n"));
  for (const role of roles) {
    const roleDir = path.join(root, "roles", role);
    fs.mkdirSync(roleDir);
    fs.writeFileSync(path.join(roleDir, "status.json"), JSON.stringify({ chainId: 6423, nativeCurrencySymbol: "YNXT", build: { commit, release }, nodeIdentity: { validatorAddress: validators[role], replicationMode: role === "primary" ? "authoritative_producer" : "authenticated_follower", blockProductionEnabled: role === "primary" } }));
    fs.writeFileSync(path.join(roleDir, "block.json"), JSON.stringify({ height: 42, hash: "2".repeat(64) }));
    fs.writeFileSync(path.join(roleDir, "preflight.txt"), [`role=${role}`, `validator=${validators[role]}`, `release=${release}`, "services=active", "overlay=active", "keys=restricted", "candidate=absent", "freeze=absent", "ports=free", "disk=ready", "backup=present", `manifest_sha256=${"3".repeat(64)}`].join("\n"));
  }
  validate(root, commit, release);
  const bad = readJSON(path.join(root, "roles", "seoul", "block.json"));
  bad.hash = "4".repeat(64);
  fs.writeFileSync(path.join(root, "roles", "seoul", "block.json"), JSON.stringify(bad));
  try { validate(root, commit, release); fail("divergent fixture unexpectedly passed"); } catch (error) { if (!String(error.message).includes("fixed-height")) throw error; }
  fs.rmSync(root, { recursive: true, force: true });
  console.log("public-bft-production-rehearsal-check passed: release, role, custody, candidate absence, and fixed-height convergence evidence fail closed");
}

if (process.argv[2] === "--self-test") {
  selfTest();
} else {
  const [root, commit, release] = process.argv.slice(2);
  if (!root || !commit || !release) fail("usage: validate-public-bft-production-rehearsal.mjs <evidence-dir> <commit> <release>");
  console.log(JSON.stringify(validate(root, commit, release), null, 2));
}
