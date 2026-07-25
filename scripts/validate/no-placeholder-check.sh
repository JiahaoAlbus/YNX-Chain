#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const targets = ["Makefile", "README.md", "configs", "internal", "cmd", "contracts", "chain-metadata", "scripts", "docs"];
const excluded = new Set([
  "tools/scaffold-ynx-chain.mjs",
  "scripts/validate/no-placeholder-check.sh",
  "scripts/deploy/lib.sh",
  "docs/architecture/ZERO_PLACEHOLDER_POLICY.md",
]);
const forbidden = /example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|NYXT/i;
const findings = [];

function scan(entry) {
  const normalized = entry.split(path.sep).join("/");
  if (normalized === ".git" || normalized.startsWith(".git/") || excluded.has(normalized)) return;
  const stat = fs.lstatSync(entry);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entry).sort()) scan(path.join(entry, child));
    return;
  }
  if (!stat.isFile()) return;
  const bytes = fs.readFileSync(entry);
  if (bytes.includes(0)) return;
  const lines = bytes.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (forbidden.test(line)) findings.push(`${normalized}:${index + 1}:${line.trim()}`);
  });
}

for (const target of targets) if (fs.existsSync(target)) scan(target);
if (findings.length) {
  console.error(findings.join("\n"));
  console.error("disallowed deployment filler or fake claim found");
  process.exit(1);
}
console.log("no disallowed deployment filler found in runtime, docs, or scripts");
NODE
