#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const verifyDir = process.env.YNX_VERIFY_TESTNET_OUT || "tmp/verify-testnet";
const evidencePath = process.env.YNX_REMOTE_EVIDENCE_PATH || path.join(verifyDir, "remote-evidence.json");
const sshPath = path.join(verifyDir, "ssh-services.txt");
const hostKeyAuditPath = process.env.YNX_HOST_KEY_AUDIT_REPORT || "tmp/host-key-audit/host-key-audit.txt";
const legacyInventoryPath = process.env.YNX_LEGACY_INVENTORY_REPORT || "tmp/legacy-inventory/legacy-inventory.txt";
const outPath = process.env.YNX_REMOTE_BLOCKER_REPORT || path.join(verifyDir, "REMOTE_BLOCKERS.md");
const jsonOutPath = process.env.YNX_REMOTE_BLOCKER_JSON || path.join(verifyDir, "remote-blockers.json");

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

function table(headers, rows) {
  if (!rows.length) return "";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function splitNodeBlocks(text) {
  return text
    .split(/\n(?=== )/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function nodeName(block) {
  const first = block.split("\n")[0] || "";
  const match = first.match(/^==\s+(.+?)\s+([^@\s]+)@([^\s=]+)\s+==$/);
  if (!match) return { role: "unknown", login: "unknown", host: "unknown" };
  return { role: match[1], login: `${match[2]}@${match[3]}`, host: match[3] };
}

function classifyNodeBlock(block) {
  const text = block.toLowerCase();
  const strictOk = text.includes("ok strict ssh accepted current host key");
  const keyscanNoKeys = text.includes("ssh-keyscan returned no keys");
  if (strictOk && keyscanNoKeys) return "ssh-strict-ok-keyscan-no-keys";
  if (strictOk) return "ok";
  if (text.includes("remote host identification has changed") || text.includes("offending") || text.includes("host key verification failed")) {
    return "host-key-mismatch";
  }
  if (text.includes("connection closed by")) return "ssh-connection-closed";
  if (keyscanNoKeys) return "ssh-host-keyscan-no-keys";
  if (text.includes("operation timed out") || text.includes("connection timed out")) return "ssh-timeout";
  if (text.includes("network is unreachable") || text.includes("no route to host")) return "ssh-network-unreachable";
  if (text.includes("permission denied")) return "ssh-auth-failed";
  if (text.includes("key is not readable")) return "ssh-key-not-readable";
  if (text.includes("fail")) return "ssh-failed";
  return "unknown";
}

function nodeDetail(block) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const important = lines.filter((line) => (
    line.startsWith("FAIL ") ||
    line.startsWith("OK ") ||
    line.includes("SHA256:") ||
    line.includes("Connection closed by") ||
    line.includes("REMOTE HOST IDENTIFICATION") ||
    line.includes("Host key verification failed") ||
    line.includes("Permission denied") ||
    line.includes("timed out") ||
    line.includes("No route to host") ||
    line.includes("Network is unreachable")
  ));
  return important.slice(0, 4).join("; ") || "see raw evidence";
}

function endpointOf(check) {
  return check?.observed?.url || check?.observed?.target || check?.observed?.host || "";
}

function classifyEndpointFailure(check) {
  const detail = String(check?.detail || "");
  const observed = JSON.stringify(check?.observed || {});
  const haystack = `${detail}\n${observed}`.toLowerCase();
  if (check?.name === "rpc.validators.count") return "validator-set-empty";
  if (check?.name === "rpc.validators.monikers" || check?.name === "rpc.validators.addresses") return "validator-metadata-missing";
  if (haystack.includes("ynx_9102-1")) return "legacy-chain";
  if (haystack.includes("expected 0x1917") || haystack.includes("expected ynx_6423-1") || haystack.includes("expected 6423")) {
    return "wrong-chain-id";
  }
  if (haystack.includes("timeout") || haystack.includes("aborted due to timeout")) return "timeout-or-unreachable";
  if (haystack.includes("http 404")) return "http-404";
  if (haystack.includes("http ")) return "http-error";
  if (haystack.includes("missing latest height") || haystack.includes("height did not grow")) return "dependent-height-failure";
  if (check?.name === "mutable.remote.actions") return "gated-mutation-skipped";
  return "failed";
}

function countBy(items, selector) {
  const counts = new Map();
  for (const item of items) {
    const key = selector(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const evidence = readJson(evidencePath);
const ssh = readText(sshPath);
const hostKeyAudit = readText(hostKeyAuditPath);
const failedChecks = evidence?.checks?.filter((check) => !check.ok) || [];
const sshBlocks = splitNodeBlocks(ssh);
const hostKeyBlocks = splitNodeBlocks(hostKeyAudit);
const nodeBlocks = hostKeyBlocks.length ? hostKeyBlocks : sshBlocks;
const nodeFindings = nodeBlocks.map((block) => {
  const identity = nodeName(block);
  return {
    ...identity,
    classification: classifyNodeBlock(block),
    detail: nodeDetail(block),
    raw: block.split("\n").slice(0, 22).join("\n"),
  };
});
const nodeFailures = nodeFindings.filter((finding) => finding.classification !== "ok");
const legacyInventory = readText(legacyInventoryPath)
  .split(/\n(?=== )/)
  .map((block) => block.trim())
  .filter(Boolean)
  .map((block) => block.split("\n").slice(0, 80).join("\n"));
const endpointFindings = failedChecks.map((check) => ({
  name: check.name,
  classification: classifyEndpointFailure(check),
  endpoint: endpointOf(check) || "n/a",
  detail: check.detail,
}));
const nodeSummary = countBy(nodeFailures, (finding) => finding.classification);
const endpointSummary = countBy(endpointFindings, (finding) => finding.classification);
const deployBlockingNodeClasses = new Set([
  "host-key-mismatch",
  "ssh-auth-failed",
  "ssh-connection-closed",
  "ssh-failed",
  "ssh-host-keyscan-no-keys",
  "ssh-key-not-readable",
  "ssh-network-unreachable",
  "ssh-strict-ok-keyscan-no-keys",
  "ssh-timeout",
  "unknown",
]);
const deployBlockingEndpointClasses = new Set([
  "failed",
  "http-404",
  "http-error",
  "timeout-or-unreachable",
]);
const nodeDeployBlockers = nodeFailures.filter((finding) => deployBlockingNodeClasses.has(finding.classification));
const endpointDeployBlockers = endpointFindings.filter((finding) => deployBlockingEndpointClasses.has(finding.classification));
const deployReady = nodeDeployBlockers.length === 0 && endpointDeployBlockers.length === 0;
const generatedAt = new Date().toISOString();

const lines = [
  "# Remote Testnet Blockers",
  "",
  `Generated at: ${generatedAt}`,
  `Evidence status: ${evidence?.status || "missing"}`,
  `Deploy gate: ${deployReady ? "ready-for-mutation" : "blocked"}`,
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
      ? [
          `Source: ${hostKeyBlocks.length ? hostKeyAuditPath : sshPath}`,
          "",
          table(["Role", "Login", "Host", "Classification", "Detail"], nodeFailures.map((finding) => [
            finding.role,
            finding.login,
            finding.host,
            finding.classification,
            finding.detail,
          ])),
          "",
          "Summary:",
          ...nodeSummary.map(([classification, count]) => `- ${classification}: ${count}`),
          "",
          "Raw evidence:",
          nodeFailures.map((finding) => `\`\`\`text\n${finding.raw}\n\`\`\``).join("\n\n"),
        ].join("\n")
      : `No SSH node failures were found in ${hostKeyBlocks.length ? hostKeyAuditPath : sshPath}.`
  ),
  section(
    "Public Endpoint Blockers",
    endpointFindings.length
      ? [
          table(["Check", "Endpoint", "Classification", "Detail"], endpointFindings.map((finding) => [
            finding.name,
            finding.endpoint,
            finding.classification,
            finding.detail,
          ])),
          "",
          "Summary:",
          ...endpointSummary.map(([classification, count]) => `- ${classification}: ${count}`),
        ].join("\n")
      : "No failed public endpoint checks were found."
  ),
  section(
    "Legacy Inventory Snapshot",
    legacyInventory.length
      ? legacyInventory.map((block) => `\`\`\`text\n${block}\n\`\`\``).join("\n\n")
      : `No legacy inventory report was found at ${legacyInventoryPath}.`
  ),
  section(
    "Required Next Actions",
    [
      deployReady
        ? "- Deploy gate is clear for mutation, but this is still not public proof. Run deployment, then verify-testnet and public-proof."
        : "- Do not run `ENV_FILE=.env.deploy make deploy-testnet` until the deploy gate blockers in `remote-blockers.json` are cleared.",
      nodeFailures.some((finding) => finding.classification === "ssh-connection-closed" || finding.classification === "ssh-host-keyscan-no-keys" || finding.classification === "ssh-strict-ok-keyscan-no-keys" || finding.classification === "ssh-timeout" || finding.classification === "ssh-network-unreachable")
        ? "- Verify cloud instance state, firewall/security-group rules, sshd status, and host-key scanning behavior for nodes classified as SSH closed, keyscan no-keys, timeout, or network-unreachable before changing local known_hosts."
        : "- Independently verify changed SSH host fingerprints before updating local known_hosts.",
      nodeFailures.some((finding) => finding.classification === "host-key-mismatch")
        ? "- For host-key-mismatch nodes, run `make host-key-repair-plan`, then confirm the presented fingerprints from the cloud console or another trusted channel before replacing any known_hosts entry."
        : "- Do not delete or rewrite known_hosts entries unless a trusted out-of-band host-key check proves a legitimate replacement.",
      "- Run `ENV_FILE=.env.deploy make backup` against reachable legacy nodes before switching any public domains.",
      "- Run `ENV_FILE=.env.deploy make deploy-testnet` only after host-key audit passes and real deployment env values exist outside git.",
      "- Run `ENV_FILE=.env.deploy make verify-testnet` and `ENV_FILE=.env.deploy make public-proof`; only accept proof when `validPublicProof` is true.",
    ].join("\n")
  ),
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
fs.writeFileSync(jsonOutPath, `${JSON.stringify({
  generatedAt,
  evidenceStatus: evidence?.status || "missing",
  deployReady,
  source: {
    evidencePath,
    sshPath,
    hostKeyAuditPath,
    legacyInventoryPath,
    reportPath: outPath,
  },
  expected: evidence?.expected || null,
  nodeFindings,
  endpointFindings,
  deployBlockers: {
    nodes: nodeDeployBlockers,
    endpoints: endpointDeployBlockers,
  },
  summaries: {
    nodes: Object.fromEntries(nodeSummary),
    endpoints: Object.fromEntries(endpointSummary),
  },
}, null, 2)}\n`);
console.log(`remote blocker report written: ${outPath}`);
console.log(`remote blocker json written: ${jsonOutPath}`);
