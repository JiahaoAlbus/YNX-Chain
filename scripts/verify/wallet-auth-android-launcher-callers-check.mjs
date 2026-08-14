#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const expectBlocked = process.argv.includes("--expect-blocked");
const extensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".java", ".swift", ".cs"]);
const skippedDirectories = new Set(["node_modules", "dist", "build", "coverage", "proof", "evidence"]);
const compiledOrVendored = [/^apps\/[^/]+\/web\/wallet-auth\.js$/, /^apps\/[^/]+\/(?:mobile\/)?vendor\/wallet-auth\//];
const requiredLegacy = new Map([
  ["apps/monitor/src/App.tsx", "ynx-wallet://authorize?challenge="],
  ["apps/trust-center/mobile/android/app/src/main/java/com/ynxweb4/trust/MainActivity.java", "ynxwallet://sign-app-session"],
  ["apps/mobile/src/api/mobileSession.ts", "ynx-wallet://com.ynxweb4.wallet"]
]);

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return extensions.has(extname(entry.name)) ? [path] : [];
  });
}

const legacy = [];
const manualCanonical = [];
for (const path of files("apps")) {
  const normalized = relative(".", path).replaceAll("\\", "/");
  const source = readFileSync(path, "utf8");
  if (/ynx-wallet:\/\//.test(source)) legacy.push({ path: normalized, kind: "legacy-scheme" });
  if (/ynxwallet:\/\/sign-app-session/.test(source)) legacy.push({ path: normalized, kind: "legacy-sign-session-route" });
  if (source.includes("ynxwallet://authorize?request=") && !source.includes("encodeRequestDeepLink") && !compiledOrVendored.some((allowed) => allowed.test(normalized))) {
    manualCanonical.push({ path: normalized, kind: "manual-canonical-uri-construction" });
  }
}

const missingRequiredLegacy = [...requiredLegacy].filter(([path, text]) => {
  try { return !readFileSync(path, "utf8").includes(text); } catch { return true; }
}).map(([path]) => path);
const result = {
  schemaVersion: 1,
  contract: "release/integration/wallet-auth-android-launcher-contract.json",
  canonicalBuilder: "@ynx-chain/wallet-auth encodeRequestDeepLink",
  legacy,
  manualCanonical,
  missingRequiredLegacy,
  accepted: legacy.length === 0 && manualCanonical.length === 0
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (expectBlocked) {
  if (missingRequiredLegacy.length || legacy.length < requiredLegacy.size || result.accepted) process.exit(1);
  process.stdout.write(`PASS launcher caller migration remains blocked: ${legacy.length} legacy and ${manualCanonical.length} manual canonical callers\n`);
  process.exit(0);
}
if (!result.accepted) {
  process.stderr.write(`FAIL launcher caller migration: ${legacy.length} legacy and ${manualCanonical.length} manual canonical callers remain\n`);
  process.exit(1);
}
process.stdout.write("PASS all release app callers use the canonical shared launcher builder\n");
