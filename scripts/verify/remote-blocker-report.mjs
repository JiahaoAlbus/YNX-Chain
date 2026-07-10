#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const verifyDir = process.env.YNX_VERIFY_TESTNET_OUT || "tmp/verify-testnet";
const evidencePath = process.env.YNX_REMOTE_EVIDENCE_PATH || path.join(verifyDir, "remote-evidence.json");
const sshPath = path.join(verifyDir, "ssh-services.txt");
const hostKeyAuditPath = process.env.YNX_HOST_KEY_AUDIT_REPORT || "tmp/host-key-audit/host-key-audit.txt";
const hostKeyApprovalRequestPath = process.env.YNX_HOST_KEY_APPROVAL_REQUEST || "tmp/host-key-audit/HOST_KEY_APPROVAL_REQUEST.md";
const hostKeyApprovalRequestJsonPath = process.env.YNX_HOST_KEY_APPROVAL_REQUEST_JSON || "tmp/host-key-audit/host-key-approval-request.json";
const hostKeyApprovalPacketPath = process.env.YNX_HOST_KEY_APPROVAL_PACKET || "tmp/host-key-audit/HOST_KEY_EXTERNAL_APPROVAL_PACKET.md";
const hostKeyApprovalPacketJsonPath = process.env.YNX_HOST_KEY_APPROVAL_PACKET_JSON || "tmp/host-key-audit/host-key-external-approval-packet.json";
const hostKeyApprovalStatusJsonPath = process.env.YNX_HOST_KEY_APPROVAL_STATUS_JSON || "tmp/host-key-audit/host-key-approval-status.json";
const legacyInventoryPath = process.env.YNX_LEGACY_INVENTORY_REPORT || "tmp/legacy-inventory/legacy-inventory.txt";
const outPath = process.env.YNX_REMOTE_BLOCKER_REPORT || path.join(verifyDir, "REMOTE_BLOCKERS.md");
const jsonOutPath = process.env.YNX_REMOTE_BLOCKER_JSON || path.join(verifyDir, "remote-blockers.json");
const maxAgeMinutes = Number(process.env.YNX_DEPLOY_GATE_MAX_AGE_MINUTES || 120);
const expectedCosmosChainId = process.env.YNX_COSMOS_CHAIN_ID || "ynx_6423-1";
const expectedEvmChainId = Number(process.env.YNX_EVM_CHAIN_ID || 6423);
const expectedEvmChainIdHex = String(process.env.YNX_EVM_CHAIN_ID_HEX || "0x1917").toLowerCase();
const expectedNativeSymbol = process.env.YNX_NATIVE_COIN_SYMBOL || "YNXT";

function currentGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

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

function fileSha256(file) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}

function fileMetadata(file, { required = false, jsonGeneratedAt = null } = {}) {
  let stat = null;
  try {
    stat = fs.statSync(file);
  } catch {
    return {
      path: file,
      required,
      exists: false,
      classification: required ? "missing-required-evidence" : "missing-optional-evidence",
      detail: "file does not exist",
    };
  }
  const parsedGeneratedAt = jsonGeneratedAt ? Date.parse(jsonGeneratedAt) : NaN;
  const timestampMs = Number.isFinite(parsedGeneratedAt) ? parsedGeneratedAt : stat.mtimeMs;
  const ageMinutes = (Date.now() - timestampMs) / 60000;
  const stale = ageMinutes > maxAgeMinutes;
  return {
    path: file,
    required,
    exists: true,
    timestamp: new Date(timestampMs).toISOString(),
    timestampSource: Number.isFinite(parsedGeneratedAt) ? "json-generatedAt" : "file-mtime",
    ageMinutes: Number(ageMinutes.toFixed(2)),
    maxAgeMinutes,
    classification: stale ? (required ? "stale-required-evidence" : "stale-optional-evidence") : "fresh",
    detail: stale ? `evidence age ${ageMinutes.toFixed(1)} minutes exceeds ${maxAgeMinutes}` : "fresh enough for deploy gate",
  };
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

function nodeFingerprints(block) {
  const fingerprints = {};
  for (const line of block.split("\n")) {
    const match = line.trim().match(/SHA256:[^\s]+\s+[^()]+\(([^)]+)\)$/);
    if (!match) continue;
    const fp = line.trim().match(/(SHA256:[^\s]+)/)?.[1] || "";
    if (fp) fingerprints[match[1].toUpperCase()] = fp;
  }
  return fingerprints;
}

function approvalRequestJsonMetadata(file, { required, mismatchFindings }) {
  const metadata = fileMetadata(file, { required });
  if (!required || metadata.classification !== "fresh") return metadata;
  const request = readJson(file);
  if (!request) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "approval request JSON is unreadable",
    };
  }
  if (request.trustedApproval !== false) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "approval request JSON must explicitly set trustedApproval=false",
    };
  }
  const rows = Array.isArray(request.rows) ? request.rows : [];
  if (!rows.length) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "approval request JSON has no rows",
    };
  }
  const rowByKey = new Map();
  for (const row of rows) {
    const key = `${row.role || ""}|${row.host || ""}|${String(row.keyType || "").toUpperCase()}`;
    rowByKey.set(key, row.presentedFingerprint || "");
  }
  const problems = [];
  let expectedCount = 0;
  for (const finding of mismatchFindings) {
    for (const [keyType, fingerprint] of Object.entries(finding.fingerprints || {})) {
      expectedCount += 1;
      const key = `${finding.role}|${finding.host}|${keyType}`;
      const observed = rowByKey.get(key);
      if (!observed) {
        problems.push(`missing ${key}`);
      } else if (observed !== fingerprint) {
        problems.push(`mismatch ${key}`);
      }
    }
  }
  if (!expectedCount) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "current host-key mismatch evidence has no parsed presented fingerprints",
    };
  }
  if (problems.length) {
    return {
      ...metadata,
      classification: "approval-request-mismatch",
      detail: `approval request JSON does not match current host-key audit: ${problems.slice(0, 4).join("; ")}`,
    };
  }
  return {
    ...metadata,
    classification: "fresh",
    detail: `fresh and matches ${expectedCount} current host-key mismatch fingerprint(s)`,
  };
}

function approvalPacketJsonMetadata(file, { required, mismatchFindings, hostKeyAuditPath }) {
  const packet = readJson(file);
  const metadata = fileMetadata(file, { required, jsonGeneratedAt: packet?.generatedAt });
  if (!required || metadata.classification !== "fresh") return metadata;
  if (!packet) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "approval packet JSON is unreadable",
    };
  }
  if (packet.trustedApproval !== false || packet.trustedSourceRequired !== true) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "approval packet JSON must be untrusted and require an external trusted source",
    };
  }
  const expectedAuditSha256 = fileSha256(hostKeyAuditPath);
  if (!expectedAuditSha256) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "current host-key audit report is missing or unreadable for packet hash validation",
    };
  }
  if (packet.hostKeyAuditSha256 !== expectedAuditSha256) {
    return {
      ...metadata,
      classification: "approval-packet-audit-mismatch",
      detail: "approval packet host-key audit SHA-256 does not match the current host-key audit report",
    };
  }
  const rows = Array.isArray(packet.rows) ? packet.rows : [];
  if (!rows.length) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "approval packet JSON has no rows",
    };
  }

  const rowByKey = new Map();
  for (const row of rows) {
    const key = `${row.role || ""}|${row.host || ""}|${String(row.keyType || "").toUpperCase()}`;
    rowByKey.set(key, row.presentedFingerprint || "");
  }
  const problems = [];
  let expectedCount = 0;
  for (const finding of mismatchFindings) {
    for (const [keyType, fingerprint] of Object.entries(finding.fingerprints || {})) {
      expectedCount += 1;
      const key = `${finding.role}|${finding.host}|${keyType}`;
      const observed = rowByKey.get(key);
      if (!observed) {
        problems.push(`missing ${key}`);
      } else if (observed !== fingerprint) {
        problems.push(`mismatch ${key}`);
      }
    }
  }
  if (!expectedCount) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "current host-key mismatch evidence has no parsed presented fingerprints",
    };
  }

  const draftNodes = Array.isArray(packet.approvalDraft?.nodes) ? packet.approvalDraft.nodes : [];
  for (const node of draftNodes) {
    for (const [keyType, value] of Object.entries(node.fingerprints || {})) {
      if (String(value || "").trim() !== "") {
        problems.push(`approval draft must keep ${node.role || ""}|${node.host || ""}|${keyType} blank`);
      }
    }
  }
  if (!draftNodes.length) {
    problems.push("approval draft has no nodes");
  }

  if (problems.length) {
    return {
      ...metadata,
      classification: "approval-packet-mismatch",
      detail: `approval packet JSON does not match current host-key audit or blank-draft rules: ${problems.slice(0, 4).join("; ")}`,
    };
  }
  return {
    ...metadata,
    classification: "fresh",
    detail: `fresh packet with ${expectedCount} untrusted fingerprint row(s), blank trusted approval draft, and current audit hash binding`,
  };
}

function remoteEvidenceJsonMetadata(file, { required }) {
  const evidence = readJson(file);
  const metadata = fileMetadata(file, { required, jsonGeneratedAt: evidence?.generatedAt });
  if (!required || metadata.classification !== "fresh") return metadata;
  if (!evidence) {
    return {
      ...metadata,
      classification: "invalid-required-evidence",
      detail: "remote evidence JSON is unreadable",
    };
  }

  const problems = [];
  const headCommit = currentGitCommit();
  if (evidence.proofType !== "remote-public-testnet-smoke") {
    problems.push("proofType must be remote-public-testnet-smoke");
  }
  const evidenceCommit = String(evidence.gitCommit || "");
  if (!/^[0-9a-f]{40}$/i.test(evidenceCommit)) {
    problems.push("gitCommit must be a full 40-character SHA");
  } else if (headCommit !== "unknown" && evidenceCommit !== headCommit) {
    problems.push(`gitCommit ${evidenceCommit.slice(0, 12)} does not match current HEAD ${headCommit.slice(0, 12)}`);
  }
  const expected = evidence.expected || {};
  const releaseCommit = String(expected.releaseCommit || "");
  const releaseName = String(expected.releaseName || "");
  if (expected.cosmosChainId !== expectedCosmosChainId) {
    problems.push(`expected.cosmosChainId must be ${expectedCosmosChainId}`);
  }
  if (Number(expected.evmChainId) !== expectedEvmChainId) {
    problems.push(`expected.evmChainId must be ${expectedEvmChainId}`);
  }
  if (String(expected.evmChainIdHex || "").toLowerCase() !== expectedEvmChainIdHex) {
    problems.push(`expected.evmChainIdHex must be ${expectedEvmChainIdHex}`);
  }
  if (expected.nativeSymbol !== expectedNativeSymbol) {
    problems.push(`expected.nativeSymbol must be ${expectedNativeSymbol}`);
  }
  if (!/^[0-9a-f]{7,40}$/i.test(releaseCommit) || releaseCommit === "unknown") {
    problems.push("expected.releaseCommit must be a concrete git SHA prefix");
  } else if (headCommit !== "unknown" && !headCommit.startsWith(releaseCommit)) {
    problems.push(`expected.releaseCommit ${releaseCommit} does not match current HEAD ${headCommit.slice(0, 12)}`);
  }
  if (releaseName !== `ynx-chain-${releaseCommit}`) {
    problems.push("expected.releaseName must match ynx-chain-<releaseCommit>");
  }

  if (problems.length) {
    return {
      ...metadata,
      classification: "remote-evidence-identity-mismatch",
      detail: problems.slice(0, 4).join("; "),
    };
  }
  return {
    ...metadata,
    classification: "fresh",
    detail: `fresh and bound to current release ${releaseCommit}`,
  };
}

function approvalStatusJsonMetadata(file, { required, mismatchFindings, hostKeyAuditPath }) {
  const status = readJson(file);
  const metadata = fileMetadata(file, { required, jsonGeneratedAt: status?.generatedAt });
  const statusContext = status
    ? {
        approvalStatus: status.status || "",
        approvalOk: status.ok === true,
        approvalRequestRowCount: status.approvalRequestRowCount ?? null,
        mismatchNodeCount: status.mismatchNodeCount ?? null,
        skippedMismatchNodes: Array.isArray(status.skippedMismatchNodes) ? status.skippedMismatchNodes : [],
      }
    : {};
  if (!required || metadata.classification !== "fresh") return metadata;
  if (!status) {
    return {
      ...metadata,
      ...statusContext,
      classification: "invalid-required-evidence",
      detail: "approval status JSON is unreadable",
    };
  }
  if (status.note !== "Non-mutating status only; not trusted approval and not known_hosts repair.") {
    return {
      ...metadata,
      ...statusContext,
      classification: "invalid-required-evidence",
      detail: "approval status JSON must identify itself as non-mutating status only",
    };
  }
  if (status.status === "awaiting-trusted-approval") {
    return {
      ...metadata,
      ...statusContext,
      classification: "approval-awaiting-trusted-confirmation",
      detail: "trusted approval file is absent or unreadable; external fingerprint confirmation is still required",
    };
  }
  if (status.status === "approval-does-not-match-current-scan" || status.ok === false) {
    return {
      ...metadata,
      ...statusContext,
      classification: "approval-status-blocked",
      detail: `approval status is ${status.status || "blocked"}`,
    };
  }
  if (status.status !== "approved-current-scan" || status.ok !== true) {
    return {
      ...metadata,
      ...statusContext,
      classification: "invalid-required-evidence",
      detail: `unexpected approval status ${status.status || "missing"}`,
    };
  }

  const approvalMetadata = status.approvalMetadata && typeof status.approvalMetadata === "object" ? status.approvalMetadata : {};
  const requiredApprovalFields = ["hostKeyAuditSha256", "source", "approvedAt", "approvedBy", "verificationChannel", "evidence"];
  const missingApprovalFields = requiredApprovalFields.filter((field) => typeof approvalMetadata[field] !== "string" || approvalMetadata[field].trim() === "");
  if (missingApprovalFields.length) {
    return {
      ...metadata,
      ...statusContext,
      classification: "approval-status-missing-audit-metadata",
      detail: `approved status lacks trusted approval metadata: ${missingApprovalFields.join(", ")}`,
    };
  }
  if (!Number.isFinite(Date.parse(approvalMetadata.approvedAt))) {
    return {
      ...metadata,
      ...statusContext,
      classification: "approval-status-missing-audit-metadata",
      detail: "approved status approvedAt is not a valid timestamp",
    };
  }
  const currentAuditSha256 = fileSha256(hostKeyAuditPath);
  if (!currentAuditSha256 || approvalMetadata.hostKeyAuditSha256 !== currentAuditSha256 || status.currentHostKeyAuditSha256 !== currentAuditSha256) {
    return {
      ...metadata,
      ...statusContext,
      classification: "approval-status-audit-mismatch",
      detail: "approved status host-key audit SHA-256 does not match the current host-key audit report",
    };
  }

  const findings = Array.isArray(status.findings) ? status.findings : [];
  const rowByKey = new Map();
  for (const finding of findings) {
    const key = `${finding.role || ""}|${finding.host || ""}|${String(finding.keyType || "").toUpperCase()}`;
    rowByKey.set(key, {
      presented: finding.presented || "",
      ok: finding.ok === true,
    });
  }
  const problems = [];
  let expectedCount = 0;
  for (const finding of mismatchFindings) {
    for (const [keyType, fingerprint] of Object.entries(finding.fingerprints || {})) {
      expectedCount += 1;
      const key = `${finding.role}|${finding.host}|${keyType}`;
      const observed = rowByKey.get(key);
      if (!observed) {
        problems.push(`missing ${key}`);
      } else if (observed.presented !== fingerprint) {
        problems.push(`fingerprint mismatch ${key}`);
      } else if (!observed.ok) {
        problems.push(`not approved ${key}`);
      }
    }
  }
  if (!expectedCount) {
    return {
      ...metadata,
      ...statusContext,
      classification: "invalid-required-evidence",
      detail: "current host-key mismatch evidence has no parsed presented fingerprints",
    };
  }
  if (problems.length) {
    return {
      ...metadata,
      ...statusContext,
      classification: "approval-status-mismatch",
      detail: `approval status JSON does not match current host-key audit: ${problems.slice(0, 4).join("; ")}`,
    };
  }
  return {
    ...metadata,
    ...statusContext,
    approvalMetadata,
    classification: "fresh",
    detail: `approved status matches ${expectedCount} current host-key mismatch fingerprint(s)`,
  };
}

function approvalStatusSkippedLines(metadata) {
  const skipped = Array.isArray(metadata?.skippedMismatchNodes) ? metadata.skippedMismatchNodes : [];
  if (!skipped.length) return [];
  return [
    "",
    "Host-key approval status skipped mismatch nodes:",
    ...skipped.map((item) => {
      const role = item.role || "unknown";
      const host = item.host || "unknown";
      const reason = item.reason || "no valid scanned fingerprint available";
      return `- ${role}/${host}: ${reason}`;
    }),
  ];
}

function endpointOf(check) {
  return check?.observed?.url || check?.observed?.target || check?.observed?.host || "";
}

function classifyEndpointFailure(check) {
  const detail = String(check?.detail || "");
  const observed = JSON.stringify(check?.observed || {});
  const haystack = `${detail}\n${observed}`.toLowerCase();
  if (check?.name === "rpc.validators.count") return "validator-set-empty";
  if (String(check?.name || "").startsWith("release.manifest.")) return "release-manifest-missing";
  if (check?.name === "rpc.validators.monikers" || check?.name === "rpc.validators.addresses") return "validator-metadata-missing";
  if (check?.name === "rpc.validators.peerReadiness") return "validator-peer-readiness-missing";
  if (String(check?.name || "").includes(".build")) return "release-identity-missing";
  if (String(check?.name || "").startsWith("rpc.nodeIdentity.")) return "validator-node-identity-missing";
  if (check?.name === "rpc.validators.peers.expected" || check?.name === "rpc.validators.peers.observed") return "validator-peer-discovery-missing";
  if (check?.name === "rpc.validators.peerSync") return "validator-peer-sync-missing";
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
const sourceEvidence = {
  remoteEvidence: remoteEvidenceJsonMetadata(evidencePath, { required: true }),
  hostKeyAudit: fileMetadata(hostKeyAuditPath, { required: true }),
  sshServices: fileMetadata(sshPath),
  legacyInventory: fileMetadata(legacyInventoryPath),
};
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
    fingerprints: nodeFingerprints(block),
    raw: block.split("\n").slice(0, 22).join("\n"),
  };
});
const nodeFailures = nodeFindings.filter((finding) => finding.classification !== "ok");
const hostKeyMismatchPresent = nodeFailures.some((finding) => finding.classification === "host-key-mismatch");
const hostKeyMismatchFindings = nodeFailures.filter((finding) => finding.classification === "host-key-mismatch");
sourceEvidence.hostKeyApprovalRequest = fileMetadata(hostKeyApprovalRequestPath, { required: hostKeyMismatchPresent });
sourceEvidence.hostKeyApprovalRequestJson = approvalRequestJsonMetadata(hostKeyApprovalRequestJsonPath, {
  required: hostKeyMismatchPresent,
  mismatchFindings: hostKeyMismatchFindings,
});
sourceEvidence.hostKeyApprovalPacket = fileMetadata(hostKeyApprovalPacketPath, { required: hostKeyMismatchPresent });
sourceEvidence.hostKeyApprovalPacketJson = approvalPacketJsonMetadata(hostKeyApprovalPacketJsonPath, {
  required: hostKeyMismatchPresent,
  mismatchFindings: hostKeyMismatchFindings,
  hostKeyAuditPath,
});
sourceEvidence.hostKeyApprovalStatusJson = approvalStatusJsonMetadata(hostKeyApprovalStatusJsonPath, {
  required: hostKeyMismatchPresent,
  mismatchFindings: hostKeyMismatchFindings,
  hostKeyAuditPath,
});
const sourceFindings = Object.entries(sourceEvidence)
  .map(([name, metadata]) => ({ name, ...metadata }))
  .filter((item) => item.required && item.classification !== "fresh");
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
  "dependent-height-failure",
  "failed",
  "gated-mutation-skipped",
  "http-404",
  "http-error",
  "legacy-chain",
  "release-manifest-missing",
  "release-identity-missing",
  "timeout-or-unreachable",
  "validator-metadata-missing",
  "validator-node-identity-missing",
  "validator-peer-discovery-missing",
  "validator-peer-readiness-missing",
  "validator-peer-sync-missing",
  "validator-set-empty",
  "wrong-chain-id",
]);
const nodeDeployBlockers = nodeFailures.filter((finding) => deployBlockingNodeClasses.has(finding.classification));
const endpointDeployBlockers = endpointFindings.filter((finding) => deployBlockingEndpointClasses.has(finding.classification));
const deployReady = sourceFindings.length === 0 && nodeDeployBlockers.length === 0 && endpointDeployBlockers.length === 0;
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
    "Source Evidence Freshness",
    [
      table(["Source", "Path", "Required", "Classification", "Age Minutes", "Detail"], Object.entries(sourceEvidence).map(([name, metadata]) => [
        name,
        metadata.path,
        metadata.required ? "yes" : "no",
        metadata.classification,
        metadata.ageMinutes ?? "n/a",
        metadata.detail,
      ])),
      sourceFindings.length
        ? ["", "Deploy-blocking source evidence issues:", ...sourceFindings.map((finding) => `- ${finding.name}: ${finding.classification} (${finding.detail})`)].join("\n")
        : "",
      ...approvalStatusSkippedLines(sourceEvidence.hostKeyApprovalStatusJson),
    ].join("\n")
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
        ? "- For host-key-mismatch nodes, run `make host-key-repair-plan`, `make host-key-approval-request`, and `make host-key-approval-packet`, confirm the presented fingerprints from the cloud console or another trusted channel, write the confirmed values plus the current `hostKeyAuditSha256`, `approvedBy`, `verificationChannel`, top-level `evidence`, and per-node `evidence` to ignored `.host-key-approvals.json`, require `make host-key-approval-check` to pass, run `make host-key-approved-repair-dry-run`, and only then run `make host-key-approved-repair`."
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
    hostKeyApprovalRequestPath,
    hostKeyApprovalRequestJsonPath,
    hostKeyApprovalPacketPath,
    hostKeyApprovalPacketJsonPath,
    hostKeyApprovalStatusJsonPath,
    legacyInventoryPath,
    reportPath: outPath,
  },
  expected: evidence?.expected || null,
  nodeFindings,
  endpointFindings,
  deployBlockers: {
    sources: sourceFindings,
    nodes: nodeDeployBlockers,
    endpoints: endpointDeployBlockers,
  },
  sourceEvidence,
  summaries: {
    sources: Object.fromEntries(countBy(sourceFindings, (finding) => finding.classification)),
    nodes: Object.fromEntries(nodeSummary),
    endpoints: Object.fromEntries(endpointSummary),
  },
}, null, 2)}\n`);
console.log(`remote blocker report written: ${outPath}`);
console.log(`remote blocker json written: ${jsonOutPath}`);
