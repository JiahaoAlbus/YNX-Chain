#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const verifyDir = process.env.YNX_VERIFY_TESTNET_OUT || "tmp/verify-testnet";
const evidencePath = process.env.YNX_REMOTE_EVIDENCE_PATH || path.join(verifyDir, "remote-evidence.json");
const sshPath = path.join(verifyDir, "ssh-services.txt");
const outPath = process.env.YNX_REMOTE_BLOCKER_REPORT || path.join(verifyDir, "REMOTE_BLOCKERS.md");

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function section(title, body) {
  return [`## ${title}`, "", body.trim() || "No evidence available.", ""].join("\n");
}

const evidence = readJson(evidencePath);
const ssh = readText(sshPath);
const failedChecks = evidence?.checks?.filter((check) => !check.ok) || [];
const nodeFailures = ssh
  .split(/\n(?=== )/)
  .map((block) => block.trim())
  .filter((block) => block.includes("FAIL"))
  .map((block) => block.split("\n").slice(0, 18).join("\n"));

const lines = [
  "# Remote Testnet Blockers",
  "",
  `Generated at: ${new Date().toISOString()}`,
  `Evidence status: ${evidence?.status || "missing"}`,
  "",
  "This report is diagnostic evidence. It is not public testnet proof and must not be presented as completed deployment.",
  "",
  section(
    "Expected Network",
    evidence
      ? [
          `- Cosmos chain id: ${evidence.expected?.cosmosChainId || "unknown"}`,
          `- EVM chain id: ${evidence.expected?.evmChainId || "unknown"} (${evidence.expected?.evmChainIdHex || "unknown"})`,
          `- Native symbol: ${evidence.expected?.nativeSymbol || "unknown"}`,
          `- Minimum validators: ${evidence.expected?.minValidators || "unknown"}`,
        ].join("\n")
      : "Remote evidence JSON is missing."
  ),
  section(
    "Node And SSH Blockers",
    nodeFailures.length
      ? nodeFailures.map((block) => `\`\`\`text\n${block}\n\`\`\``).join("\n\n")
      : "No SSH node failures were found in ssh-services.txt."
  ),
  section(
    "Public Endpoint Blockers",
    failedChecks.length
      ? failedChecks.map((check) => `- ${check.name}: ${check.detail}`).join("\n")
      : "No failed public endpoint checks were found."
  ),
  section(
    "Required Next Actions",
    [
      "- Independently verify changed SSH host fingerprints for Singapore and Silicon Valley before updating local known_hosts.",
      "- Run `ENV_FILE=.env.deploy make backup` against reachable legacy nodes before switching any public domains.",
      "- Run `ENV_FILE=.env.deploy make deploy-testnet` only after host-key audit passes and real deployment env values exist outside git.",
      "- Run `ENV_FILE=.env.deploy make verify-testnet` and `ENV_FILE=.env.deploy make public-proof`; only accept proof when `validPublicProof` is true.",
    ].join("\n")
  ),
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
console.log(`remote blocker report written: ${outPath}`);
