#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cs", ".dart", ".go", ".h", ".html", ".java", ".js", ".jsx", ".kt", ".kts", ".mjs", ".mm", ".rs", ".swift", ".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set([".git", "build", "coverage", "dist", "docs", "evidence", "node_modules", "release", "test", "testdata", "tests", "vendor"]);
const ROUTE = "ynxwallet://authorize";
const ROUTE_BASE_ALLOWLIST = new Map([
  ["packages/wallet-auth/scripts/verify-no-bare-wallet-authorize.mjs", "release gate owns the route token it scans"],
  ["packages/wallet-auth/src/deep-link.js", "canonical builder owns the route base constant"],
  ["packages/wallet-auth/src/index.d.ts", "public type declaration exposes the route base constant"],
  ["packages/wallet-auth/src/product-session-registry.js", "central registry validates the route base but never opens it"],
]);

function hasExcludedSegment(relative) {
  return relative.split(path.sep).some((segment) => EXCLUDED_SEGMENTS.has(segment));
}
async function sourceFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!hasExcludedSegment(next)) files.push(...await sourceFiles(root, next));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !hasExcludedSegment(next)) {
      files.push(next);
    }
  }
  return files;
}

export function bareAuthorizationFindings(relative, text) {
  const findings = [];
  let offset = 0;
  while ((offset = text.indexOf(ROUTE, offset)) !== -1) {
    const suffix = text.slice(offset + ROUTE.length);
    const payloadSuffix = suffix.startsWith("?request=") ? suffix.slice("?request=".length) : "";
    const validPayload = /^(?:\$\{|\\\(|[<{A-Za-z0-9_%])/.test(payloadSuffix) || /^["']\s*\+\s*\S/.test(payloadSuffix);
    if (!validPayload) {
      const allowedRouteBase = ROUTE_BASE_ALLOWLIST.has(relative) && /^['"`]/.test(suffix);
      if (!allowedRouteBase) {
        const line = text.slice(0, offset).split("\n").length;
        findings.push(Object.freeze({ file: relative, line, code: "BARE_WALLET_AUTHORIZE_URI" }));
      }
    }
    offset += ROUTE.length;
  }
  return Object.freeze(findings);
}

export async function verifyNoBareWalletAuthorize(root) {
  const findings = [];
  for (const top of ["apps", "internal", "packages"]) {
    const absolute = path.join(root, top);
    try {
      for (const relativeWithinTop of await sourceFiles(absolute)) {
        const relative = path.join(top, relativeWithinTop);
        findings.push(...bareAuthorizationFindings(relative, await readFile(path.join(root, relative), "utf8")));
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return Object.freeze(findings);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const findings = await verifyNoBareWalletAuthorize(root);
  if (findings.length) {
    for (const finding of findings) process.stderr.write(`${finding.file}:${finding.line} ${finding.code}\n`);
    process.stderr.write(`bare YNX Wallet authorization URI gate failed: ${findings.length} finding(s)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("bare YNX Wallet authorization URI gate passed\n");
  }
}
