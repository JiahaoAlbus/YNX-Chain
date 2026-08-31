#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cs", ".dart", ".go", ".h", ".html", ".java", ".js", ".json", ".jsx", ".kt", ".kts", ".mjs", ".mm", ".rs", ".swift", ".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set([".git", "coverage", "docs", "evidence", "node_modules", "release", "test", "testdata", "tests", "vendor"]);
const LEGACY_NATIVE_CHAIN = ["ynx", "9102-1"].join("_");
const LEGACY_EVM_CHAIN = ["0x", "238e"].join("");

export function legacyChain9102Findings(relative, text) {
  const findings = [];
  for (const [identity, code] of [[LEGACY_NATIVE_CHAIN, "LEGACY_NATIVE_CHAIN_9102"], [LEGACY_EVM_CHAIN, "LEGACY_EVM_CHAIN_9102"]]) {
    let offset = 0;
    while ((offset = text.toLowerCase().indexOf(identity, offset)) !== -1) {
      findings.push(Object.freeze({ file: relative, line: lineAt(text, offset), code }));
      offset += identity.length;
    }
  }
  const decimal = /(?:chainId|chain_id|chain-id)["']?\s*[:=]\s*["']?9102\b/gi;
  for (let match; (match = decimal.exec(text)) !== null;) findings.push(Object.freeze({ file: relative, line: lineAt(text, match.index), code: "LEGACY_DECIMAL_CHAIN_9102" }));
  return Object.freeze(findings);
}

export async function verifyNoLegacyChain9102(root) {
  const findings = [];
  for (const top of ["apps", "internal", "packages"]) {
    const absolute = path.join(root, top);
    try {
      for (const relativeWithinTop of await sourceFiles(absolute)) {
        const relative = path.join(top, relativeWithinTop);
        findings.push(...legacyChain9102Findings(relative, await readFile(path.join(root, relative), "utf8")));
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return Object.freeze(findings);
}

async function sourceFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!excluded(next)) files.push(...await sourceFiles(root, next));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !excluded(next)) files.push(next);
  }
  return files;
}

function excluded(relative) { return relative.split(path.sep).some((segment) => EXCLUDED_SEGMENTS.has(segment)); }
function lineAt(text, offset) { return text.slice(0, offset).split("\n").length; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const findings = await verifyNoLegacyChain9102(root);
  if (findings.length) {
    for (const finding of findings) process.stderr.write(`${finding.file}:${finding.line} ${finding.code}\n`);
    process.stderr.write(`legacy YNX chain 9102 gate failed: ${findings.length} finding(s)\n`);
    process.exitCode = 1;
  } else process.stdout.write("legacy YNX chain 9102 gate passed\n");
}
