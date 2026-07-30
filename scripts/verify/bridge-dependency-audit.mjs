#!/usr/bin/env node
import fs from "node:fs";

const [output = ""] = process.argv.slice(2);
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
if (lock.lockfileVersion !== 3 || typeof lock.packages !== "object") {
  throw new Error("Bridge contract tooling requires a package-lock v3 package tree");
}

const requested = {};
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path || !metadata?.version || !path.includes("node_modules/")) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  if (!name || name.includes("/node_modules/")) continue;
  (requested[name] ??= new Set()).add(metadata.version);
}
const body = Object.fromEntries(Object.entries(requested).map(([name, versions]) => [name, [...versions].sort()]));
if (Object.keys(body).length === 0) {
  throw new Error("package-lock contains no auditable packages");
}

const endpoint = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let response;
let text = "";
let lastError;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "ynx-bridge-dependency-audit/1"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    text = await response.text();
    if (response.ok) break;
    const retryable = response.status === 429 || response.status >= 500;
    lastError = new Error(`npm bulk advisory request failed ${response.status}: ${text.slice(0, 500)}`);
    if (!retryable || attempt === 3) throw lastError;
  } catch (error) {
    lastError = error;
    if (attempt === 3) throw new Error(`npm bulk advisory request failed after 3 attempts: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
  await delay(attempt * 1000);
}
if (!response?.ok) throw lastError ?? new Error("npm bulk advisory request did not return a response");
const payload = JSON.parse(text);
const advisories = [];
for (const [packageName, records] of Object.entries(payload)) {
  for (const record of records ?? []) {
    advisories.push({
      package: packageName,
      id: String(record.id ?? record.github_advisory_id ?? "unknown"),
      title: record.title ?? "untitled advisory",
      severity: record.severity ?? "unknown",
      vulnerableVersions: record.vulnerable_versions ?? null,
      url: record.url ?? null,
      cwe: record.cwe ?? [],
      cvss: record.cvss ?? null
    });
  }
}
advisories.sort((a, b) => a.package.localeCompare(b.package) || a.id.localeCompare(b.id));
const counts = advisories.reduce((acc, advisory) => {
  acc[advisory.severity] = (acc[advisory.severity] ?? 0) + 1;
  return acc;
}, {});
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
  lockfileVersion: lock.lockfileVersion,
  auditedPackages: Object.keys(body).length,
  advisoryCount: advisories.length,
  counts,
  advisories
};
if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
else console.log(JSON.stringify(report, null, 2));

const blocking = advisories.filter(({severity}) => severity === "critical" || severity === "high");
if (blocking.length) {
  console.error(`bridge dependency audit blocked: ${blocking.length} critical/high advisories`);
  process.exit(1);
}
console.log(`bridge dependency audit passed: packages=${report.auditedPackages} advisories=${report.advisoryCount}`);
