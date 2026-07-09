#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", ...options });
}

function fail(message, details = []) {
  console.error(`host-key-approval-check failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail(`missing or unreadable approval JSON at ${file}`, [
      err.message,
      "Create this ignored file only after confirming fingerprints through a trusted cloud-console or provider channel.",
    ]);
  }
}

function fingerprintMap(scanFile) {
  const result = run("ssh-keygen", ["-lf", scanFile]);
  if (result.status !== 0) {
    throw new Error(`ssh-keygen failed for ${scanFile}: ${result.stderr || result.stdout}`);
  }
  const entries = new Map();
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^\d+\s+(SHA256:[^\s]+)\s+.+\(([^)]+)\)$/);
    if (!match) continue;
    entries.set(match[2].toUpperCase(), match[1]);
  }
  return entries;
}

function compareApprovals({ approvalPath, auditOut, reportPath, jsonPath }) {
  const approval = readJson(approvalPath);
  const approvedNodes = Array.isArray(approval.nodes) ? approval.nodes : [];
  const findings = [];

  if (!approval.source || !approval.approvedAt) {
    findings.push({
      role: "approval-file",
      host: "",
      ok: false,
      reason: "approval JSON must include source and approvedAt",
    });
  }
  if (!approvedNodes.length) {
    findings.push({
      role: "approval-file",
      host: "",
      ok: false,
      reason: "approval JSON must include at least one node",
    });
  }

  for (const node of approvedNodes) {
    const role = String(node.role || "");
    const host = String(node.host || "");
    const approved = node.fingerprints && typeof node.fingerprints === "object" ? node.fingerprints : {};
    const scanFile = node.scanFile ? path.resolve(repoRoot, node.scanFile) : path.join(auditOut, `${role}-${host}.known_hosts`);

    if (!role || !host) {
      findings.push({ role, host, ok: false, reason: "node role and host are required" });
      continue;
    }
    if (!Object.keys(approved).length) {
      findings.push({ role, host, ok: false, reason: "node fingerprints are required" });
      continue;
    }
    if (!fs.existsSync(scanFile)) {
      findings.push({
        role,
        host,
        ok: false,
        reason: `scan file missing: ${path.relative(repoRoot, scanFile)}`,
      });
      continue;
    }

    let presented;
    try {
      presented = fingerprintMap(scanFile);
    } catch (err) {
      findings.push({ role, host, ok: false, reason: err.message });
      continue;
    }

    for (const [type, fingerprint] of presented.entries()) {
      const expected = approved[type] || approved[type.toLowerCase()];
      findings.push({
        role,
        host,
        keyType: type,
        presented: fingerprint,
        approved: expected || "",
        ok: expected === fingerprint,
        reason: expected ? "compared" : "presented key type is not approved",
      });
    }
    for (const type of Object.keys(approved)) {
      if (!presented.has(type.toUpperCase())) {
        findings.push({
          role,
          host,
          keyType: type.toUpperCase(),
          presented: "",
          approved: approved[type],
          ok: false,
          reason: "approved key type was not presented by current scan",
        });
      }
    }
  }

  const ok = findings.length > 0 && findings.every((finding) => finding.ok);
  const markdown = [
    "# Host Key Approval Status",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Approval file: ${approvalPath}`,
    `Audit directory: ${auditOut}`,
    `Approved source: ${approval.source || "missing"}`,
    `Approved at: ${approval.approvedAt || "missing"}`,
    `Status: ${ok ? "approved-current-scan" : "blocked"}`,
    "",
    "| Role | Host | Key Type | Presented | Approved | Status | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...findings.map((finding) => [
      finding.role || "",
      finding.host || "",
      finding.keyType || "",
      finding.presented || "",
      finding.approved || "",
      finding.ok ? "ok" : "blocked",
      finding.reason || "",
    ].map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")).map((row) => `| ${row} |`),
    "",
    ok
      ? "The approved fingerprints match the currently scanned host keys. This check does not update known_hosts; use the repair plan commands only after this status is current."
      : "Do not update known_hosts. Resolve every blocked row through trusted out-of-band verification first.",
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, markdown);
  fs.writeFileSync(jsonPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    ok,
    approvalPath,
    auditOut,
    source: approval.source || "",
    approvedAt: approval.approvedAt || "",
    findings,
  }, null, 2)}\n`);

  if (!ok) {
    fail("approved fingerprints do not match current scan", [
      `report: ${reportPath}`,
      `json: ${jsonPath}`,
    ]);
  }
  console.log(`host-key approval check passed: ${reportPath}`);
}

function selfTest() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-host-key-approval-"));
  const keyPath = path.join(workDir, "host_ed25519");
  const keygen = run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]);
  assert.equal(keygen.status, 0, keygen.stderr);

  const auditOut = path.join(workDir, "audit");
  fs.mkdirSync(auditOut, { recursive: true });
  const scanFile = path.join(auditOut, "testnode-127.0.0.1.known_hosts");
  const pub = fs.readFileSync(`${keyPath}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(scanFile, `127.0.0.1 ${pub[0]} ${pub[1]}\n`);
  const ed25519 = fingerprintMap(scanFile).get("ED25519");
  assert(ed25519);

  const approvalPath = path.join(workDir, "approvals.json");
  const reportPath = path.join(workDir, "status.md");
  const jsonPath = path.join(workDir, "status.json");
  fs.writeFileSync(approvalPath, JSON.stringify({
    source: "self-test trusted channel",
    approvedAt: new Date().toISOString(),
    nodes: [{
      role: "testnode",
      host: "127.0.0.1",
      fingerprints: { ED25519: ed25519 },
    }],
  }, null, 2));
  compareApprovals({ approvalPath, auditOut, reportPath, jsonPath });

  fs.writeFileSync(approvalPath, JSON.stringify({
    source: "self-test trusted channel",
    approvedAt: new Date().toISOString(),
    nodes: [{
      role: "testnode",
      host: "127.0.0.1",
      fingerprints: { ED25519: "SHA256:mismatched-self-test-fingerprint" },
    }],
  }, null, 2));
  const bad = run(process.execPath, [fileURLToPath(import.meta.url)], {
    env: {
      ...process.env,
      YNX_HOST_KEY_APPROVALS: approvalPath,
      YNX_HOST_KEY_AUDIT_OUT: auditOut,
      YNX_HOST_KEY_APPROVAL_REPORT: reportPath,
      YNX_HOST_KEY_APPROVAL_JSON: jsonPath,
    },
  });
  assert.notEqual(bad.status, 0, "mismatched approval should fail");
  assert.match(`${bad.stdout}\n${bad.stderr}`, /approved fingerprints do not match current scan/);
  console.log("host-key-approval-check self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const auditOut = path.resolve(repoRoot, process.env.YNX_HOST_KEY_AUDIT_OUT || "tmp/host-key-audit");
  const approvalPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVALS || ".host-key-approvals.json");
  const reportPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_REPORT || "tmp/host-key-audit/HOST_KEY_APPROVAL_STATUS.md");
  const jsonPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_JSON || "tmp/host-key-audit/host-key-approval-status.json");
  compareApprovals({ approvalPath, auditOut, reportPath, jsonPath });
}
