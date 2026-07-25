#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const excluded = new Set([
  "tools/scaffold-ynx-chain.mjs",
  "scripts/validate/secret-scan.sh",
]);
const patterns = [
  {name: "private-key-pem", regex: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/},
  {name: "openai-style-secret", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/},
  {name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/},
  {name: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/},
];
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
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return;
  const bytes = fs.readFileSync(entry);
  if (bytes.includes(0)) return;
  const lines = bytes.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) findings.push(`${normalized}:${index + 1}:${pattern.name}`);
    }
  });
}

scan(".");
if (findings.length) {
  console.error(findings.join("\n"));
  console.error("possible secret found");
  process.exit(1);
}
console.log("secret scan passed");
NODE
