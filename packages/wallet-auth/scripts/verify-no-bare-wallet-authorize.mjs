#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cs", ".dart", ".go", ".h", ".html", ".java", ".js", ".jsx", ".kt", ".kts", ".mjs", ".mm", ".rs", ".swift", ".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set([".git", "build", "coverage", "dist", "docs", "evidence", "node_modules", "release", "test", "testdata", "tests", "vendor"]);
const ROUTE = "ynxwallet://authorize";
const WEB_SOURCE_EXTENSIONS = new Set([".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const NATIVE_PATH_SEGMENTS = new Set(["android", "desktop", "ios", "macos", "mobile", "native", "windows"]);
const LEGACY_CALLBACK_PROPERTY = /\b(?:callback|callbackUrl|returnUrl|deepLink|targetUrl|uri|url|href|location)\b\s*(?::|=)\s*(["'`])(ynx(?:-[a-z0-9]+|[a-z0-9]+))\1/gi;
const LEGACY_CALLBACK_OPENER = /\b(?:Uri\.parse|new\s+URL|openURL|window\.open|open|launch|navigate|startActivity)\s*\(\s*(["'`])(ynx(?:-[a-z0-9]+|[a-z0-9]+))\1\s*\)/gi;
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

function lineAt(text, offset) { return text.slice(0, offset).split("\n").length; }
function isProtocolOwnerSource(relative) { return relative.startsWith(`packages${path.sep}wallet-auth${path.sep}`); }
function isWebProductSource(relative) {
  const segments = relative.split(path.sep);
  return segments[0] === "apps"
    && WEB_SOURCE_EXTENSIONS.has(path.extname(relative))
    && !segments.some((segment) => NATIVE_PATH_SEGMENTS.has(segment));
}

function isDocumentationPlaceholder(text, offset) {
  return text.slice(offset + ROUTE.length).startsWith("?request=<");
}

function firstLineMatching(text, expression) {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => expression.test(line));
  return index < 0 ? null : index + 1;
}

export function webAuthorizationBehaviorFindings(relative, text) {
  if (!isWebProductSource(relative)) return Object.freeze([]);
  const findings = [];
  const navigationLine = firstLineMatching(text, /(?:(?:window|document)\.)?location(?:\.href)?\s*=.*(?:wallet|authoriz)|location\.(?:assign|replace)\s*\([^\n]*(?:wallet|authoriz)/i);
  if (navigationLine !== null) findings.push(Object.freeze({ file: relative, line: navigationLine, code: "WEB_TOP_LEVEL_WALLET_AUTHORIZATION_NAVIGATION" }));
  if (
    text.includes(ROUTE)
    && /\b(?:btoa|base64url|base64URL|TextEncoder)\b/.test(text)
    && /\bproductClientId\b/.test(text)
    && /\bproductDeviceKey\b/.test(text)
    && !/\bencodeRequestDeepLink\s*\(/.test(text)
  ) {
    const encodingLine = firstLineMatching(text, /\b(?:btoa|base64url|base64URL|TextEncoder)\b/);
    findings.push(Object.freeze({ file: relative, line: encodingLine ?? 1, code: "HANDWRITTEN_AUTHORIZATION_REQUEST_ENCODING" }));
  }
  const gatedLine = firstLineMatching(text, /if\s*\([^\n]*(?:productSession|privateSession|gateway)[^\n]*\)\s*(?:return|throw)[^\n]*(?:connectStandardWallet|eth_requestAccounts)/i);
  if (gatedLine !== null) findings.push(Object.freeze({ file: relative, line: gatedLine, code: "PRODUCT_SESSION_BLOCKS_STANDARD_WALLET" }));
  return Object.freeze(findings);
}

export function webWalletCapabilityAudit(relative, text) {
  if (!isWebProductSource(relative)) return null;
  return Object.freeze({
    eip6963: /eip6963:(?:requestProvider|announceProvider)|EIP-6963/.test(text),
    eip1193: /EIP-1193|provider(?:Candidate)?\??\.provider|\.request\s*\(\s*\{\s*method/.test(text),
    ethRequestAccounts: /eth_requestAccounts/.test(text),
    switchChain0x1917: /wallet_switchEthereumChain/.test(text) && /0x1917/.test(text),
    addChain0x1917: /wallet_addEthereumChain/.test(text) && /0x1917/.test(text),
    officialWalletAction: /https:\/\/(?:www\.)?ynxweb4\.com\/(?:dapp\/download|downloads\/)/.test(text),
    officialMetaMaskAction: /https:\/\/(?:www\.)?metamask\.(?:io|app\.link)\//.test(text),
    safeLauncherV2Call: /\blaunchWebAuthorization\s*\(/.test(text),
    productSessionDegraded: /PRIVATE_SERVICE_DEGRADED|PRODUCT_SESSION_(?:UNAVAILABLE|GATEWAY_UNREACHABLE)/.test(text),
  });
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
        findings.push(Object.freeze({ file: relative, line: lineAt(text, offset), code: "BARE_WALLET_AUTHORIZE_URI" }));
      }
    }
    offset += ROUTE.length;
  }
  return Object.freeze(findings);
}

export function legacyCallbackShorthandFindings(relative, text) {
  if (isProtocolOwnerSource(relative)) return Object.freeze([]);
  const findings = [];
  for (const expression of [LEGACY_CALLBACK_PROPERTY, LEGACY_CALLBACK_OPENER]) {
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(text)) !== null) {
      findings.push(Object.freeze({ file: relative, line: lineAt(text, match.index), code: "LEGACY_CALLBACK_SCHEME_SHORTHAND" }));
    }
  }
  return Object.freeze(findings);
}

export function consumerAuthorizationFindings(relative, text) {
  const findings = [...bareAuthorizationFindings(relative, text), ...webAuthorizationBehaviorFindings(relative, text), ...legacyCallbackShorthandFindings(relative, text)];
  if (isProtocolOwnerSource(relative)) return Object.freeze(findings);
  let offset = 0;
  while ((offset = text.indexOf(ROUTE, offset)) !== -1) {
    if (isDocumentationPlaceholder(text, offset)) {
      offset += ROUTE.length;
      continue;
    }
    const alreadyBare = findings.some((finding) => finding.line === lineAt(text, offset) && finding.code === "BARE_WALLET_AUTHORIZE_URI");
    if (!alreadyBare) findings.push(Object.freeze({
      file: relative,
      line: lineAt(text, offset),
      code: isWebProductSource(relative) ? "WEB_CUSTOM_SCHEME_AUTHORIZE_URI" : "MANUAL_WALLET_AUTHORIZE_URI",
    }));
    offset += ROUTE.length;
  }
  return Object.freeze(findings);
}

async function verifyTree(root, finder, repositoryLayout) {
  const findings = [];
  const roots = repositoryLayout ? ["apps", "internal", "packages"] : [""];
  for (const top of roots) {
    const absolute = path.join(root, top);
    try {
      for (const relativeWithinTop of await sourceFiles(absolute)) {
        const relative = top ? path.join(top, relativeWithinTop) : relativeWithinTop;
        findings.push(...finder(relative, await readFile(path.join(root, relative), "utf8")));
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return Object.freeze(findings);
}

export async function verifyNoBareWalletAuthorize(root) {
  return verifyTree(root, bareAuthorizationFindings, true);
}

export async function verifyWalletAuthorizeConsumers(root, options = {}) {
  return verifyTree(root, consumerAuthorizationFindings, options.repositoryLayout !== false);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const consumerAudit = process.argv.includes("--consumer-audit") || process.argv.includes("--consumer-root");
  const consumerRootIndex = process.argv.indexOf("--consumer-root");
  const root = consumerRootIndex >= 0
    ? path.resolve(process.argv[consumerRootIndex + 1] ?? "")
    : path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const findings = consumerAudit
    ? await verifyWalletAuthorizeConsumers(root, { repositoryLayout: consumerRootIndex < 0 })
    : await verifyNoBareWalletAuthorize(root);
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify({ mode: consumerAudit ? "consumer-audit" : "no-bare", root, findings }, null, 2)}\n`);
  if (findings.length) {
    if (!process.argv.includes("--json")) for (const finding of findings) process.stderr.write(`${finding.file}:${finding.line} ${finding.code}\n`);
    process.stderr.write(`${consumerAudit ? "Wallet authorization consumer audit" : "bare YNX Wallet authorization URI gate"} failed: ${findings.length} finding(s)\n`);
    process.exitCode = 1;
  } else {
    if (!process.argv.includes("--json")) process.stdout.write(`${consumerAudit ? "Wallet authorization consumer audit" : "bare YNX Wallet authorization URI gate"} passed\n`);
  }
}
