#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const SOURCE_EXTENSIONS = new Set([".cs", ".html", ".java", ".js", ".jsx", ".mjs", ".swift", ".ts", ".tsx"]);
const SKIP_SEGMENTS = new Set([".git", "build", "coverage", "dist", "evidence", "node_modules", "Pods", "test", "tests"]);
const SDK_BUILDER_PATH = "packages/wallet-auth/src/deep-link.js";

const FORBIDDEN = Object.freeze([
  Object.freeze({ code: "LEGACY_SCHEME", expression: /ynx-wallet:\/\//g }),
  Object.freeze({ code: "LEGACY_SIGN_APP_SESSION", expression: /ynxwallet:\/\/sign-app-session(?:[/?#]|$)/g }),
  Object.freeze({ code: "LEGACY_WALLET_BINDING", expression: /ynx-wallet:\/\/com\.ynxweb4\.wallet/g })
]);
const CANONICAL_LITERAL = /ynxwallet:\/\/authorize\?request=/g;
const SDK_CALL = /\bencodeRequestDeepLink\s*\(/;
const SDK_IMPORT = /(?:from\s*["'](?:@ynx-chain\/wallet-auth|[^"']*wallet-auth\/src\/index\.js)["']|require\s*\(\s*["']@ynx-chain\/wallet-auth["']\s*\))/;
const SDK_DEFINITION = /\b(?:declare\s+)?function\s+encodeRequestDeepLink\s*\(/;

function isVendoredSdkBuilder(relativePath) {
  return /\/vendor\/wallet-auth\/src\/deep-link\.js$/.test(`/${relativePath}`);
}

function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

export function scanWalletCallerText(relativePath, text) {
  const findings = [];
  for (const rule of FORBIDDEN) {
    rule.expression.lastIndex = 0;
    for (const match of text.matchAll(rule.expression)) {
      findings.push({ path: relativePath, line: lineAt(text, match.index), code: rule.code });
    }
  }

  CANONICAL_LITERAL.lastIndex = 0;
  const literalMatches = [...text.matchAll(CANONICAL_LITERAL)];
  const isSdkBuilder = relativePath === SDK_BUILDER_PATH || isVendoredSdkBuilder(relativePath);
  if (literalMatches.length > 0 && !isSdkBuilder) {
    for (const match of literalMatches) {
      findings.push({ path: relativePath, line: lineAt(text, match.index), code: "MANUAL_AUTHORIZE_URI" });
    }
  }

  if (SDK_CALL.test(text) && !isSdkBuilder && !SDK_IMPORT.test(text) && !SDK_DEFINITION.test(text)) {
    findings.push({ path: relativePath, line: 1, code: "UNBOUND_SDK_BUILDER" });
  }
  return findings;
}

async function sourceFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_SEGMENTS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await sourceFiles(absolute));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) results.push(absolute);
  }
  return results;
}

export async function scanRepository(repositoryRoot = REPOSITORY_ROOT) {
  const roots = [path.join(repositoryRoot, "apps"), path.join(repositoryRoot, "packages", "wallet-auth", "src")];
  const files = (await Promise.all(roots.map(sourceFiles))).flat().sort();
  const findings = [];
  for (const absolute of files) {
    const relative = path.relative(repositoryRoot, absolute).split(path.sep).join("/");
    findings.push(...scanWalletCallerText(relative, await readFile(absolute, "utf8")));
  }
  return findings.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.code.localeCompare(right.code));
}

async function main() {
  const reportOnly = process.argv.includes("--report-only");
  const findings = await scanRepository();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    contract: "ynx-wallet-auth-android-launcher-v1",
    canonicalBuilder: "@ynx-chain/wallet-auth encodeRequestDeepLink",
    passed: findings.length === 0,
    findingCount: findings.length,
    findings
  }, null, 2)}\n`);
  if (!reportOnly && findings.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
