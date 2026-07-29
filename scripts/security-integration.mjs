#!/usr/bin/env node
/**
 * Security-platform integration verification.
 *
 * `render` validates deployment candidates without claiming installation.
 * `cluster` performs read-only checks against an explicitly selected namespace.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be --name value pairs");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function run(execFile, command, args) {
  return execFile(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function validateRenderedManifest({
  environment,
  manifest,
  backupMode = "suspended",
}) {
  const failures = [];
  const requiredPatterns = [
    ["default-deny network policy", /name:\s*default-deny-all\b/],
    ["strict mTLS", /mode:\s*STRICT\b/],
  ];

  for (const [name, pattern] of requiredPatterns) {
    if (!pattern.test(manifest)) failures.push(`${environment}: missing ${name}`);
  }

  const documents = manifest.split(/^---\s*$/m).filter((document) => document.trim());
  const workloads = documents.filter((document) => /^kind:\s*(?:Deployment|CronJob)\b/m.test(document));
  for (const document of workloads) {
    const kind = document.match(/^kind:\s*([^\s]+)/m)?.[1] ?? "Workload";
    const name = document.match(/\nmetadata:\n(?:[\s\S]*?\n)?\s*name:\s*([^\s]+)/)?.[1] ?? "unknown";
    const images = document.match(/\n\s*(?:-\s*)?image:\s*[^\s]+/g) ?? [];
    const escalationDenials = document.match(/\n\s*allowPrivilegeEscalation:\s*false\b/g) ?? [];
    const readOnlyRoots = document.match(/\n\s*readOnlyRootFilesystem:\s*true\b/g) ?? [];
    const capabilityDrops = document.match(/\n\s*drop:\s*\n\s*- ALL\b/g) ?? [];
    if (!/\n\s*runAsNonRoot:\s*true\b/.test(document)) failures.push(`${environment}: ${kind} ${name} is missing runAsNonRoot`);
    if (images.length !== escalationDenials.length) failures.push(`${environment}: ${kind} ${name} does not deny privilege escalation for every container`);
    if (images.length !== readOnlyRoots.length) failures.push(`${environment}: ${kind} ${name} does not use a read-only root filesystem for every container`);
    if (images.length !== capabilityDrops.length) failures.push(`${environment}: ${kind} ${name} does not drop all Linux capabilities for every container`);
  }
  if (/image:\s*[^\s]+:latest\b/i.test(manifest)) failures.push(`${environment}: mutable latest image tag is forbidden`);
  if (/\bstringData\s*:/i.test(manifest)) failures.push(`${environment}: inline Kubernetes stringData is forbidden`);
  if (/-----BEGIN [^-]+PRIVATE KEY-----/i.test(manifest)) failures.push(`${environment}: private key material is forbidden`);
  if (/\b(?:TOKEN|PASSWORD|PRIVATE_KEY|SEED|MNEMONIC)\b[\s\S]{0,120}\n\s*value:\s*["']?[^\n$<{]/i.test(manifest)) {
    failures.push(`${environment}: credential-like environment variable has a literal value`);
  }
  if (environment === "staging" && /host:\s*[^\s]*\.ynxweb4\.com\b/i.test(manifest)) {
    failures.push("staging: public production host is forbidden");
  }

  const cronJobs = manifest.split(/^---\s*$/m).filter((document) => /kind:\s*CronJob\b/.test(document));
  for (const document of cronJobs) {
    const name = document.match(/\n\s*name:\s*([^\s]+)/)?.[1] ?? "unknown";
    if (backupMode === "suspended" && !/\n\s*suspend:\s*true\b/.test(document)) {
      failures.push(`${environment}: backup CronJob ${name} must remain suspended until operator inputs are accepted`);
    }
    if (backupMode === "active" && /\n\s*suspend:\s*true\b/.test(document)) {
      failures.push(`${environment}: staging-release CronJob ${name} must be active`);
    }
  }
  if (!new Set(["suspended", "active"]).has(backupMode)) failures.push(`${environment}: invalid backup mode`);

  return {
    environment,
    pass: failures.length === 0,
    failures,
    documents: manifest.split(/^---\s*$/m).filter((document) => document.trim()).length,
    bytes: Buffer.byteLength(manifest),
    backupMode,
  };
}

export function verifyManifestCandidates({ execFile = execFileSync } = {}) {
  const overlays = [
    ["staging", "infra/k8s/overlays/staging"],
    ["production-candidate", "infra/k8s/overlays/production"],
  ];
  const results = [];

  for (const [environment, path] of overlays) {
    try {
      const manifest = run(execFile, "kubectl", ["kustomize", path]);
      results.push(validateRenderedManifest({ environment: environment === "production-candidate" ? "production" : environment, manifest }));
    } catch (error) {
      results.push({
        environment,
        pass: false,
        failures: [`render failed: ${(error.stderr || error.message).toString().trim()}`],
        documents: 0,
        bytes: 0,
      });
    }
  }

  return {
    schemaVersion: 1,
    mode: "render",
    source: "local kubectl kustomize",
    pass: results.every((result) => result.pass),
    installedLocal: false,
    deployedStaging: false,
    deployedPublic: false,
    results,
  };
}

function kubectlJson(execFile, args) {
  return JSON.parse(run(execFile, "kubectl", [...args, "-o", "json"]));
}

export function verifyClusterReadOnly({ namespace, expectedEnvironment, execFile = execFileSync }) {
  if (!namespace || !expectedEnvironment) throw new Error("cluster mode requires namespace and expectedEnvironment");
  const checks = [];

  try {
    const namespaceObject = kubectlJson(execFile, ["get", "namespace", namespace]);
    checks.push({
      id: "namespace-environment-binding",
      pass: namespaceObject.metadata?.labels?.environment === expectedEnvironment,
      detail: namespaceObject.metadata?.labels?.environment ?? "missing environment label",
    });
  } catch (error) {
    checks.push({ id: "namespace-environment-binding", pass: false, detail: (error.stderr || error.message).toString().trim() });
  }

  try {
    const policies = kubectlJson(execFile, ["get", "networkpolicy", "-n", namespace]);
    checks.push({
      id: "default-deny-network-policy",
      pass: policies.items?.some((item) => item.metadata?.name === "default-deny-all") === true,
      detail: `${policies.items?.length ?? 0} policies observed`,
    });
  } catch (error) {
    checks.push({ id: "default-deny-network-policy", pass: false, detail: (error.stderr || error.message).toString().trim() });
  }

  try {
    const pods = kubectlJson(execFile, ["get", "pods", "-n", namespace]);
    const total = pods.items?.length ?? 0;
    const ready = (pods.items ?? []).filter((pod) => pod.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True")).length;
    checks.push({ id: "pods-ready", pass: total > 0 && ready === total, detail: `${ready}/${total} pods ready` });
  } catch (error) {
    checks.push({ id: "pods-ready", pass: false, detail: (error.stderr || error.message).toString().trim() });
  }

  try {
    const cronJobs = kubectlJson(execFile, ["get", "cronjob", "-n", namespace]);
    const activeBackups = (cronJobs.items ?? []).filter((item) => item.metadata?.labels?.["security.ynx/workload"]?.startsWith("backup-") && item.spec?.suspend !== true);
    checks.push({
      id: "backup-activation",
      pass: activeBackups.length > 0,
      detail: activeBackups.length > 0 ? `${activeBackups.length} active backup schedules` : "no active backup schedule; deployment remains incomplete",
    });
  } catch (error) {
    checks.push({ id: "backup-activation", pass: false, detail: (error.stderr || error.message).toString().trim() });
  }

  return {
    schemaVersion: 1,
    mode: "cluster-read-only",
    namespace,
    expectedEnvironment,
    pass: checks.every((check) => check.pass),
    checks,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2] ?? "render";
    const args = parseArgs(process.argv.slice(3));
    const result = command === "render"
      ? verifyManifestCandidates()
      : command === "cluster"
        ? verifyClusterReadOnly({ namespace: args.namespace, expectedEnvironment: args.environment })
        : (() => { throw new Error("usage: security-integration.mjs render | cluster --namespace NAME --environment NAME"); })();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.pass) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
