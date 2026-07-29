#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const policyPath = "release/integration/security/npm-audit-policy.json";
const packagePath = "package.json";
const lockPath = "package-lock.json";
const expectedPolicyId = "YNX-INT-NPM-2026-001";

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
    timeout: options.timeout ?? 0,
    killSignal: "SIGTERM"
  });
  if (result.error) throw result.error;
  if (options.allowedExitCodes?.includes(result.status)) return result;
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed: ${String(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  }
  return result;
}

function runAudit(omitDevelopment) {
  const commandArgs = ["audit"];
  if (omitDevelopment) commandArgs.push("--omit=dev");
  commandArgs.push("--audit-level=high", "--json", "--fetch-timeout=15000", "--fetch-retries=0");
  const auditClass = omitDevelopment ? "production" : "full";
  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = run("npm", commandArgs, { allowedExitCodes: [0, 1], timeout: 45_000 });
      return JSON.parse(String(result.stdout ?? ""));
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /ETIMEDOUT|EAI_AGAIN|ECONNRESET|ECONNREFUSED|TLS handshake timeout|socket hang up/i.test(message);
      if (!transient || attempt === maxAttempts) {
        if (error instanceof SyntaxError) throw new Error(`${auditClass} npm audit returned invalid JSON: ${error.message}`);
        throw error;
      }
      console.error(`${auditClass} npm audit transient failure on attempt ${attempt}/${maxAttempts}; retrying`);
    }
  }
  throw lastError ?? new Error(`${auditClass} npm audit failed without an error`);
}

function git(args, options = {}) {
  return run("git", args, options);
}

function validSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function isReachableFromHead(value) {
  if (!validSha(value)) return false;
  const result = spawnSync("git", ["merge-base", "--is-ancestor", value, "HEAD"], { cwd: root, encoding: "utf8" });
  return !result.error && result.status === 0;
}

function normalizeVia(via) {
  if (!Array.isArray(via)) return [];
  return via.map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") return entry.url?.split("/").pop() ?? String(entry.source ?? entry.name ?? "");
    return "";
  }).filter(Boolean).sort();
}

function getLockedVersion(lock, packageName) {
  return lock?.packages?.[`node_modules/${packageName}`]?.version ?? null;
}

function trackedRuntimeImports(packageName) {
  const raw = git(["ls-files", "-z"]).stdout;
  const candidates = String(raw ?? "").split("\0").filter(Boolean).filter((relativePath) => {
    if (relativePath === packagePath || relativePath === lockPath || relativePath === policyPath) return false;
    if (relativePath.startsWith("docs/") || relativePath.startsWith("release/") || relativePath.startsWith("artifacts/")) return false;
    return /\.(?:c?js|mjs|ts|tsx|go)$/.test(relativePath);
  });
  const importPatterns = [
    new RegExp(`\\bfrom\\s*["']${packageName}(?:["'/])`),
    new RegExp(`\\brequire\\s*\\(\\s*["']${packageName}(?:["'/])`),
    new RegExp(`\\bimport\\s*\\(\\s*["']${packageName}(?:["'/])`)
  ];
  return candidates.filter((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    try {
      const contents = fs.readFileSync(absolutePath, "utf8");
      return importPatterns.some((importPattern) => importPattern.test(contents));
    } catch {
      return false;
    }
  });
}

function validateBundle({ policy, packageJson, lock, fullAudit, productionAudit, now = new Date() }) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };

  expect(policy?.schemaVersion === "1.0.0", "policy schemaVersion must be 1.0.0");
  expect(policy?.policyId === expectedPolicyId, `policyId must be ${expectedPolicyId}`);
  expect(policy?.owner === "29-integration", "policy owner must be 29-integration");
  expect(policy?.requiredReviewOwner === "30-security-sre", "policy review owner must be 30-security-sre");
  expect(policy?.decision === "noExceptionRequired", "policy must record the remediated dependency graph");
  expect(policy?.releaseEffect === "none", "remediated audit policy must not retain the expired release block");
  expect(validSha(policy?.sourceCommit), "policy sourceCommit must be an exact SHA");
  if (validSha(policy?.sourceCommit)) expect(isReachableFromHead(policy.sourceCommit), "policy sourceCommit must be reachable from HEAD");

  const createdAt = Date.parse(policy?.createdAt ?? "");
  const remediatedAt = Date.parse(policy?.remediatedAt ?? "");
  expect(Number.isFinite(createdAt), "policy createdAt is invalid");
  expect(Number.isFinite(remediatedAt), "policy remediatedAt is invalid");
  if (Number.isFinite(createdAt) && Number.isFinite(remediatedAt)) expect(remediatedAt >= createdAt, "policy remediatedAt must not precede createdAt");
  expect(!Object.hasOwn(policy ?? {}, "expiresAt"), "remediated policy must not retain an exception expiry");

  expect(packageJson?.private === true, "contract tooling package must remain private");
  expect(Object.keys(packageJson?.dependencies ?? {}).length === 0, "contract tooling must not add production npm dependencies");
  for (const directPackage of ["hardhat", "@nomicfoundation/hardhat-ethers"]) {
    expect(typeof packageJson?.devDependencies?.[directPackage] === "string", `${directPackage} must remain a development dependency`);
  }

  const advisory = policy?.advisory ?? {};
  expect(advisory.id === "GHSA-xcpc-8h2w-3j85", "unexpected remediated advisory ID");
  expect(advisory.source === 1123686, "unexpected remediated advisory source ID");
  expect(advisory.package === "adm-zip", "unexpected remediated advisory package");
  expect(advisory.severity === "high", "remediated advisory severity history must remain high");
  expect(advisory.fixAvailable === true, "policy must record that the dependency graph is fixed");
  expect(advisory.installedVersion === "0.6.0", "policy must bind the fixed adm-zip version");
  expect(policy?.scope?.productionDependenciesAllowed === false, "production dependency scope must remain prohibited");
  expect(policy?.scope?.runtimeImportAllowed === false, "runtime import scope must remain prohibited");
  expect(policy?.scope?.untrustedArchiveInputAllowed === false, "untrusted archive input must remain prohibited");
  expect(policy?.scope?.networkServiceExposure === false, "network service exposure must remain prohibited");

  for (const [packageName, expectedVersion] of Object.entries(policy?.lockedVersions ?? {})) {
    expect(getLockedVersion(lock, packageName) === expectedVersion, `${packageName} lock version drifted from ${expectedVersion}`);
  }
  expect(getLockedVersion(lock, "adm-zip") === advisory.installedVersion, "advisory installedVersion differs from package-lock.json");

  const productionCounts = productionAudit?.metadata?.vulnerabilities ?? {};
  expect((productionCounts.critical ?? -1) === 0, "production audit contains a critical vulnerability");
  expect((productionCounts.high ?? -1) === 0, "production audit contains a high vulnerability");
  expect((productionCounts.total ?? -1) === 0, "production audit contains a vulnerability");
  expect(Object.keys(productionAudit?.vulnerabilities ?? {}).length === 0, "production audit vulnerability map must be empty");

  const actualVulnerabilities = fullAudit?.vulnerabilities ?? {};
  const expectedVulnerabilities = Array.isArray(policy?.expectedAuditVulnerabilities) ? policy.expectedAuditVulnerabilities : [];
  const expectedNames = expectedVulnerabilities.map((entry) => entry.name).sort();
  const actualNames = Object.keys(actualVulnerabilities).sort();
  expect(JSON.stringify(actualNames) === JSON.stringify(expectedNames), `full audit graph changed: expected ${expectedNames.join(", ")}, got ${actualNames.join(", ")}`);
  const fullCounts = fullAudit?.metadata?.vulnerabilities ?? {};
  expect((fullCounts.critical ?? -1) === 0, "full audit contains a critical vulnerability");
  expect((fullCounts.high ?? -1) === expectedNames.length, "full audit high count differs from the exact policy graph");
  expect((fullCounts.total ?? -1) === expectedNames.length, "full audit contains an unapproved vulnerability severity");

  for (const expected of expectedVulnerabilities) {
    const actual = actualVulnerabilities[expected.name];
    expect(Boolean(actual), `missing expected audit node ${expected.name}`);
    if (!actual) continue;
    expect(actual.severity === expected.severity, `${expected.name} severity drifted`);
    expect(actual.isDirect === expected.direct, `${expected.name} direct dependency classification drifted`);
    expect(actual.fixAvailable === false, `${expected.name} unexpectedly changed fix availability`);
    expect(JSON.stringify(normalizeVia(actual.via)) === JSON.stringify([...expected.via].sort()), `${expected.name} advisory path drifted`);
  }

  const directImports = trackedRuntimeImports("adm-zip");
  expect(directImports.length === 0, `tracked runtime source imports adm-zip: ${directImports.join(", ")}`);
  const ignored = spawnSync("git", ["check-ignore", "-q", "artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json"], { cwd: root });
  expect(!ignored.error && ignored.status === 0, "generated Hardhat artifacts must remain ignored build outputs");
  expect(Array.isArray(policy?.mandatoryControls) && policy.mandatoryControls.length >= 8, "policy mandatoryControls are incomplete");
  expect(Array.isArray(policy?.remediationEvidence) && policy.remediationEvidence.length >= 4, "policy remediationEvidence is incomplete");

  return failures;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deterministicAuditFixture(policy, productionOnly) {
  const expected = productionOnly
    ? []
    : (Array.isArray(policy?.expectedAuditVulnerabilities) ? policy.expectedAuditVulnerabilities : []);
  const vulnerabilities = Object.fromEntries(expected.map((entry) => [entry.name, {
    severity: entry.severity,
    isDirect: entry.direct,
    fixAvailable: false,
    via: [...entry.via]
  }]));
  return {
    vulnerabilities,
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: expected.length,
        critical: 0,
        total: expected.length
      }
    }
  };
}

function main() {
  const policy = readJson(policyPath);
  const packageJson = readJson(packagePath);
  const lock = readJson(lockPath);
  const selfTest = args.has("--self-test");
  const fullAudit = selfTest ? deterministicAuditFixture(policy, false) : runAudit(false);
  const productionAudit = selfTest ? deterministicAuditFixture(policy, true) : runAudit(true);
  const failures = validateBundle({ policy, packageJson, lock, fullAudit, productionAudit });
  if (failures.length > 0) return failures;

  if (args.has("--self-test")) {
    const staleExceptionPolicy = clone(policy);
    staleExceptionPolicy.decision = "timeBoundDevelopmentToolingException";
    const staleExceptionFailures = validateBundle({ policy: staleExceptionPolicy, packageJson, lock, fullAudit, productionAudit });
    if (!staleExceptionFailures.some((failure) => failure.includes("remediated dependency graph"))) return ["self-test failed to reject a stale exception"];

    const widenedPolicy = clone(policy);
    widenedPolicy.expectedAuditVulnerabilities.push({
      name: "unexpected-package",
      severity: "high",
      direct: false,
      via: ["unexpected-advisory"]
    });
    const widenedFailures = validateBundle({ policy: widenedPolicy, packageJson, lock, fullAudit, productionAudit });
    if (!widenedFailures.some((failure) => failure.includes("full audit graph changed"))) return ["self-test failed to reject an audit graph mismatch"];

    const runtimePackage = clone(packageJson);
    runtimePackage.dependencies = { hardhat: "3.9.0" };
    const runtimeFailures = validateBundle({ policy, packageJson: runtimePackage, lock, fullAudit, productionAudit });
    if (!runtimeFailures.some((failure) => failure.includes("production npm dependencies"))) return ["self-test failed to reject production dependency exposure"];
  }
  return [];
}

try {
  const failures = main();
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(`npm audit policy check failed with ${failures.length} finding(s)`);
    process.exit(1);
  }
  console.log(args.has("--self-test") ? "npm audit policy self-test passed" : "npm audit policy check passed");
} catch (error) {
  console.error(`npm audit policy check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
