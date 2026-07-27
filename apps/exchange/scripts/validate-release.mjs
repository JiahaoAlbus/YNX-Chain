#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../../..');
const textSuffixes = new Set([
  '.c', '.css', '.go', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.sh',
  '.ts', '.tsx', '.yaml', '.yml',
]);
const ignoredDirectories = new Set(['node_modules', '.git', 'dist', 'coverage']);
const runtimeRoots = [
  path.join(root, 'apps', 'exchange'),
  path.join(root, 'internal', 'exchangeproduct'),
];
const productFiles = [
  'EVIDENCE_INDEX.md',
  'FEATURE_COMPLETION_EVIDENCE.md',
  'MIGRATION_COMPATIBILITY.md',
  'OBSERVABILITY.md',
  'OPERATIONS.md',
  'QUANT_EXECUTION_ADAPTER.md',
  'RECOVERY_AUDIT.md',
  'SLO_CAPACITY_PLAN.md',
  'THIRD_PARTY_NOTICES.md',
  'THREAT_MODEL.md',
  'UNIT_ECONOMICS.md',
].map((name) => path.join(root, name));
const runtimeFillers = [
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bcoming\s+soon\b/i,
  /\bexample\.com\b/i,
  /\byour[_ -]?key(?:[_ -]?here)?\b/i,
  /\bchangeme\b/i,
];
const documentFillers = [
  /\bexample\.com\b/i,
  /\byour[_ -]?key(?:[_ -]?here)?\b/i,
  /\bchangeme\b/i,
];
const secretPatterns = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
];

function collectTextFiles(directory, output) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collectTextFiles(path.join(directory, entry.name), output);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const file = path.join(directory, entry.name);
    if (textSuffixes.has(path.extname(file).toLowerCase())) output.add(file);
  }
}

function scan(file, patterns, label, findings) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    findings.push(`${path.relative(root, file)}: unreadable text file: ${error.message}`);
    return;
  }
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const pattern of patterns) {
      if (pattern.test(lines[index])) {
        findings.push(`${path.relative(root, file)}:${index + 1}: ${label}: ${pattern.source}`);
      }
    }
  }
}

const runtimeFiles = new Set();
for (const directory of runtimeRoots) collectTextFiles(directory, runtimeFiles);
const findings = [];
for (const file of [...runtimeFiles].sort()) {
  if (path.basename(file).startsWith('validate-release')) continue;
  scan(file, secretPatterns, 'possible secret', findings);
  if (!file.endsWith('_test.go')) scan(file, runtimeFillers, 'release filler', findings);
}
for (const file of productFiles) {
  if (!fs.existsSync(file)) continue;
  scan(file, secretPatterns, 'possible secret', findings);
  scan(file, documentFillers, 'release filler', findings);
}

if (findings.length > 0) {
  console.error('Exchange release validation failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(
  `Exchange release validation passed: ${runtimeFiles.size} runtime files and ` +
  `${productFiles.filter((file) => fs.existsSync(file)).length} product documents scanned`,
);
