#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifests = [
  ".ai-bridge/full-goal-coverage.json",
  "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json",
  "release/release-record.json",
  "product-release.json",
];

const pathFields = new Set([
  "artifact",
  "artifacts",
  "coverage",
  "crossProductVectors",
  "dependencyAcceptance",
  "evidence",
  "handoff",
  "integrationContract",
  "publicProof",
  "schema",
  "tests",
]);

const commandPrefixes = ["go ", "bash ", "node ", "jq ", "npm ", "pnpm ", "yarn ", "make "];

function looksLikeRepositoryPath(value) {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (!candidate || candidate.startsWith("http://") || candidate.startsWith("https://")) return false;
  if (commandPrefixes.some((prefix) => candidate.startsWith(prefix))) return false;
  if (candidate.includes(" ") || candidate.includes("*") || candidate.includes("${")) return false;
  return candidate.includes("/") || candidate.startsWith(".");
}

function inspect(value, location, activeField, missing) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, `${location}[${index}]`, activeField, missing));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      inspect(item, `${location}.${key}`, pathFields.has(key) ? key : activeField, missing);
    }
    return;
  }
  if (!activeField || !looksLikeRepositoryPath(value)) return;
  const absolute = path.resolve(root, value);
  if (!absolute.startsWith(`${root}${path.sep}`) && absolute !== root) {
    missing.push({ location, value, reason: "outside-workspace" });
    return;
  }
  if (!fs.existsSync(absolute)) missing.push({ location, value, reason: "missing" });
}

const missing = [];
for (const manifest of manifests) {
  const absolute = path.resolve(root, manifest);
  if (!fs.existsSync(absolute)) {
    missing.push({ location: manifest, value: manifest, reason: "manifest-missing" });
    continue;
  }
  const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  inspect(parsed, manifest, null, missing);
}

if (missing.length > 0) {
  console.error("Evidence path validation failed:");
  for (const item of missing) console.error(`- ${item.location}: ${item.value} (${item.reason})`);
  process.exit(1);
}

console.log(`Evidence path validation passed for ${manifests.length} manifests.`);
