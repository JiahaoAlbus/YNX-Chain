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
  const result = {
    generatedAt: new Date().toISOString(),
    ok,
    approvalPath,
    auditOut,
    source: approval.source || "",
    approvedAt: approval.approvedAt || "",
    findings,
    approval,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);

  if (!ok) {
    fail("approved fingerprints do not match current scan", [
      `report: ${reportPath}`,
      `json: ${jsonPath}`,
    ]);
  }
  console.log(`host-key approval check passed: ${reportPath}`);
  return result;
}

function nodeFromScanFile(scanFile) {
  const basename = path.basename(scanFile, ".known_hosts");
  const match = basename.match(/^(.+)-(\d+\.\d+\.\d+\.\d+)$/);
  if (!match) return null;
  return { role: match[1], host: match[2] };
}

function strictOutputSuggestsRepair(auditOut, role, host) {
  const strictPath = path.join(auditOut, `${role}-${host}.strict.out`);
  if (!fs.existsSync(strictPath)) return false;
  const body = fs.readFileSync(strictPath, "utf8");
  return body.includes("REMOTE HOST IDENTIFICATION HAS CHANGED") || body.includes("Host key verification failed");
}

function collectRepairApprovalNodes(auditOut, { blankFingerprints }) {
  if (!fs.existsSync(auditOut)) {
    fail(`missing host-key audit directory at ${auditOut}`, [
      "Run make host-key-audit or make host-key-repair-plan before generating host-key approval artifacts.",
    ]);
  }
  const nodes = [];
  for (const entry of fs.readdirSync(auditOut).sort()) {
    if (!entry.endsWith(".known_hosts")) continue;
    const scanFile = path.join(auditOut, entry);
    const node = nodeFromScanFile(scanFile);
    if (!node || !strictOutputSuggestsRepair(auditOut, node.role, node.host)) continue;
    const presented = fingerprintMap(scanFile);
    const fingerprints = {};
    for (const type of [...presented.keys()].sort()) fingerprints[type] = blankFingerprints ? "" : presented.get(type);
    nodes.push({
      role: node.role,
      host: node.host,
      scanFile: path.relative(repoRoot, scanFile),
      fingerprints,
    });
  }
  if (!nodes.length) {
    fail("no host-key mismatch scan files found for host-key approval artifacts", [
      "Run make host-key-audit and confirm there are strict SSH host-key mismatches first.",
    ]);
  }
  return nodes;
}

function writeApprovalTemplate({ auditOut, templatePath }) {
  const nodes = collectRepairApprovalNodes(auditOut, { blankFingerprints: true });

  const template = {
    instructions: [
      "Do not rename this template to .host-key-approvals.json until every fingerprint is independently confirmed through a trusted cloud-console or provider channel.",
      "Leave fingerprint values blank until confirmed out-of-band. Do not copy values from ssh-keyscan alone.",
      "After filling source, approvedAt, and every fingerprint, save as .host-key-approvals.json and run make host-key-approval-check.",
    ],
    source: "",
    approvedAt: "",
    nodes,
  };

  fs.mkdirSync(path.dirname(templatePath), { recursive: true });
  fs.writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`);
  console.log(`host-key approval template written: ${templatePath}`);
  console.log("template contains blank fingerprints only; it is not an approval file");
}

function writeApprovalRequest({ auditOut, requestPath, jsonPath, templatePath }) {
  const nodes = collectRepairApprovalNodes(auditOut, { blankFingerprints: false });
  const generatedAt = new Date().toISOString();
  const rows = [];
  for (const node of nodes) {
    for (const [type, fingerprint] of Object.entries(node.fingerprints)) {
      rows.push({
        role: node.role,
        host: node.host,
        keyType: type,
        presentedFingerprint: fingerprint,
        trustedFingerprint: "",
        status: "needs-out-of-band-confirmation",
      });
    }
  }

  const markdown = [
    "# Host Key Approval Request",
    "",
    `Generated at: ${generatedAt}`,
    `Audit directory: ${auditOut}`,
    `Approval template: ${templatePath}`,
    "",
    "This request is not a trusted approval. It only lists host-key fingerprints currently presented by SSH scanning so an operator can compare them with a trusted cloud-console or provider channel.",
    "",
    "Rules:",
    "",
    "- Do not copy these presented fingerprints into `.host-key-approvals.json` unless they independently match a trusted external source.",
    "- Leave `trustedFingerprint` blank in this request until the value is confirmed out-of-band.",
    "- After external confirmation, fill the ignored `.host-key-approvals.json` file from the blank template and run `make host-key-approval-check`.",
    "- Only after the approval check passes, run `make host-key-approved-repair-dry-run`, review the report, then run `make host-key-approved-repair`.",
    "",
    "| Role | Host | Key Type | Presented Fingerprint | Trusted Fingerprint | Status |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => [
      row.role,
      row.host,
      row.keyType,
      row.presentedFingerprint,
      row.trustedFingerprint,
      row.status,
    ].map((cell) => String(cell || "").replace(/\|/g, "\\|")).join(" | ")).map((row) => `| ${row} |`),
    "",
    "Next commands after trusted external confirmation:",
    "",
    "```bash",
    "make host-key-approval-check",
    "make host-key-approved-repair-dry-run",
    "make host-key-approved-repair",
    "make host-key-audit",
    "make remote-blocker-report",
    "make deploy-readiness-gate",
    "```",
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  fs.writeFileSync(requestPath, markdown);
  fs.writeFileSync(jsonPath, `${JSON.stringify({
    generatedAt,
    auditOut,
    templatePath,
    trustedApproval: false,
    instructions: "Compare presentedFingerprint values against a trusted external source before filling .host-key-approvals.json.",
    rows,
    nodes,
  }, null, 2)}\n`);
  console.log(`host-key approval request written: ${requestPath}`);
  console.log("request contains untrusted current-scan fingerprints only; it is not an approval file");
}

function timestampForPath() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function sshDefaultsForNode(role) {
  const primaryKey = process.env.PRIMARY_NODE_SSH_KEY || process.env.SSH_KEY_PATH || "/Users/huangjiahao/Downloads/Huang.pem";
  const defaults = {
    primary: {
      user: process.env.PRIMARY_NODE_USER || process.env.SERVER_USER || "ubuntu",
      key: primaryKey,
    },
    singapore: {
      user: process.env.SG_NODE_USER || "root",
      key: process.env.SG_NODE_SSH_KEY || primaryKey,
    },
    "silicon-valley": {
      user: process.env.SILICON_VALLEY_NODE_USER || "ubuntu",
      key: process.env.SILICON_VALLEY_NODE_SSH_KEY || "/Users/huangjiahao/Downloads/Huang2.pem",
    },
    seoul: {
      user: process.env.SEOUL_NODE_USER || "root",
      key: process.env.SEOUL_NODE_SSH_KEY || "/Users/huangjiahao/Downloads/Huang3.pem",
    },
  };
  return defaults[role] || { user: process.env.SERVER_USER || "ubuntu", key: primaryKey };
}

function repairApprovedKnownHosts({ approvalPath, auditOut, reportPath, jsonPath, knownHosts, repairReportPath, repairJsonPath, dryRun }) {
  const approvalResult = compareApprovals({ approvalPath, auditOut, reportPath, jsonPath });
  const actions = [];
  const nodes = approvalResult.approval.nodes || [];
  const backupPath = `${knownHosts}.bak.${timestampForPath()}`;

  if (!dryRun) {
    if (!fs.existsSync(knownHosts)) {
      fail(`known_hosts file does not exist: ${knownHosts}`, [
        "Create it or set KNOWN_HOSTS_FILE to the intended OpenSSH known_hosts path.",
      ]);
    }
    fs.copyFileSync(knownHosts, backupPath);
  }

  for (const node of nodes) {
    const role = String(node.role || "");
    const host = String(node.host || "");
    const scanFile = node.scanFile ? path.resolve(repoRoot, node.scanFile) : path.join(auditOut, `${role}-${host}.known_hosts`);
    const sshDefaults = sshDefaultsForNode(role);
    const login = `${sshDefaults.user}@${host}`;
    const action = {
      role,
      host,
      scanFile: path.relative(repoRoot, scanFile),
      knownHosts,
      backupPath,
      login,
      keyPath: sshDefaults.key,
      dryRun,
      removed: false,
      appended: false,
      strictVerified: false,
      ok: false,
      detail: "",
    };

    if (!role || !host) {
      action.detail = "node role and host are required";
      actions.push(action);
      continue;
    }
    if (!fs.existsSync(scanFile)) {
      action.detail = `scan file missing: ${action.scanFile}`;
      actions.push(action);
      continue;
    }

    if (dryRun) {
      action.detail = "dry-run: approval matches current scan; known_hosts would be backed up, host entry replaced, and strict SSH verified";
      action.ok = true;
      actions.push(action);
      continue;
    }

    const remove = run("ssh-keygen", ["-R", host, "-f", knownHosts]);
    action.removed = remove.status === 0;
    fs.appendFileSync(knownHosts, fs.readFileSync(scanFile, "utf8"));
    action.appended = true;

    const strict = run("ssh", [
      "-i", sshDefaults.key,
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", "ConnectTimeout=8",
      login,
      "hostname",
    ]);
    action.strictVerified = strict.status === 0;
    action.ok = action.removed && action.appended && action.strictVerified;
    action.detail = action.ok ? `strict SSH verified: ${strict.stdout.trim()}` : `${strict.stderr || strict.stdout}`.trim();
    actions.push(action);
  }

  const ok = actions.length > 0 && actions.every((action) => action.ok);
  const markdown = [
    "# Host Key Approved Repair",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Approval file: ${approvalPath}`,
    `Known hosts: ${knownHosts}`,
    `Backup path: ${dryRun ? "dry-run-not-created" : backupPath}`,
    `Mode: ${dryRun ? "dry-run" : "apply"}`,
    `Status: ${ok ? "ok" : "blocked"}`,
    "",
    "| Role | Host | Login | Scan File | Removed | Appended | Strict SSH | Status | Detail |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...actions.map((action) => [
      action.role,
      action.host,
      action.login,
      action.scanFile,
      action.removed ? "yes" : dryRun ? "dry-run" : "no",
      action.appended ? "yes" : dryRun ? "dry-run" : "no",
      action.strictVerified ? "yes" : dryRun ? "dry-run" : "no",
      action.ok ? "ok" : "blocked",
      action.detail,
    ].map((cell) => String(cell || "").replace(/\|/g, "\\|")).join(" | ")).map((row) => `| ${row} |`),
    "",
    dryRun
      ? "Dry-run only. No known_hosts changes were made."
      : "known_hosts was changed only after approval matched the current scan. Rerun host-key audit, remote blocker report, and deploy-readiness gate.",
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(repairReportPath), { recursive: true });
  fs.writeFileSync(repairReportPath, markdown);
  fs.writeFileSync(repairJsonPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    ok,
    dryRun,
    approvalPath,
    knownHosts,
    backupPath: dryRun ? "" : backupPath,
    actions,
  }, null, 2)}\n`);

  if (!ok) {
    fail("approved known_hosts repair did not complete", [
      `report: ${repairReportPath}`,
      `json: ${repairJsonPath}`,
      dryRun ? "dry-run did not modify known_hosts" : `known_hosts backup: ${backupPath}`,
    ]);
  }
  console.log(`host-key approved repair ${dryRun ? "dry-run" : "applied"}: ${repairReportPath}`);
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
  const strictPath = path.join(auditOut, "testnode-127.0.0.1.strict.out");
  fs.writeFileSync(strictPath, "Host key verification failed.\n");
  const templatePath = path.join(workDir, "template.json");
  writeApprovalTemplate({ auditOut, templatePath });
  const requestPath = path.join(workDir, "request.md");
  const requestJsonPath = path.join(workDir, "request.json");
  writeApprovalRequest({ auditOut, requestPath, jsonPath: requestJsonPath, templatePath });
  const request = JSON.parse(fs.readFileSync(requestJsonPath, "utf8"));
  assert.equal(request.trustedApproval, false);
  assert.equal(request.rows.length, 1);
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
  const dryRunRepair = run(process.execPath, [fileURLToPath(import.meta.url), "--repair-known-hosts", "--dry-run"], {
    env: {
      ...process.env,
      YNX_HOST_KEY_APPROVALS: approvalPath,
      YNX_HOST_KEY_AUDIT_OUT: auditOut,
      YNX_HOST_KEY_APPROVAL_REPORT: reportPath,
      YNX_HOST_KEY_APPROVAL_JSON: jsonPath,
      KNOWN_HOSTS_FILE: path.join(workDir, "known_hosts"),
      YNX_HOST_KEY_REPAIR_REPORT: path.join(workDir, "repair.md"),
      YNX_HOST_KEY_REPAIR_JSON: path.join(workDir, "repair.json"),
    },
  });
  assert.equal(dryRunRepair.status, 0, dryRunRepair.stderr || dryRunRepair.stdout);

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
} else if (process.argv.includes("--write-template")) {
  const auditOut = path.resolve(repoRoot, process.env.YNX_HOST_KEY_AUDIT_OUT || "tmp/host-key-audit");
  const templatePath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_TEMPLATE || "tmp/host-key-audit/host-key-approvals.template.json");
  writeApprovalTemplate({ auditOut, templatePath });
} else if (process.argv.includes("--write-approval-request")) {
  const auditOut = path.resolve(repoRoot, process.env.YNX_HOST_KEY_AUDIT_OUT || "tmp/host-key-audit");
  const requestPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_REQUEST || "tmp/host-key-audit/HOST_KEY_APPROVAL_REQUEST.md");
  const requestJsonPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_REQUEST_JSON || "tmp/host-key-audit/host-key-approval-request.json");
  const templatePath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_TEMPLATE || "tmp/host-key-audit/host-key-approvals.template.json");
  writeApprovalRequest({ auditOut, requestPath, jsonPath: requestJsonPath, templatePath });
} else if (process.argv.includes("--repair-known-hosts")) {
  const auditOut = path.resolve(repoRoot, process.env.YNX_HOST_KEY_AUDIT_OUT || "tmp/host-key-audit");
  const approvalPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVALS || ".host-key-approvals.json");
  const reportPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_REPORT || "tmp/host-key-audit/HOST_KEY_APPROVAL_STATUS.md");
  const jsonPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_JSON || "tmp/host-key-audit/host-key-approval-status.json");
  const knownHosts = path.resolve(process.env.KNOWN_HOSTS_FILE || path.join(os.homedir(), ".ssh/known_hosts"));
  const repairReportPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_REPAIR_REPORT || "tmp/host-key-audit/HOST_KEY_APPROVED_REPAIR.md");
  const repairJsonPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_REPAIR_JSON || "tmp/host-key-audit/host-key-approved-repair.json");
  repairApprovedKnownHosts({
    approvalPath,
    auditOut,
    reportPath,
    jsonPath,
    knownHosts,
    repairReportPath,
    repairJsonPath,
    dryRun: process.argv.includes("--dry-run"),
  });
} else {
  const auditOut = path.resolve(repoRoot, process.env.YNX_HOST_KEY_AUDIT_OUT || "tmp/host-key-audit");
  const approvalPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVALS || ".host-key-approvals.json");
  const reportPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_REPORT || "tmp/host-key-audit/HOST_KEY_APPROVAL_STATUS.md");
  const jsonPath = path.resolve(repoRoot, process.env.YNX_HOST_KEY_APPROVAL_JSON || "tmp/host-key-audit/host-key-approval-status.json");
  compareApprovals({ approvalPath, auditOut, reportPath, jsonPath });
}
