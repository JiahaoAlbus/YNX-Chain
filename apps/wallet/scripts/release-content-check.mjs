import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const walletRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = path.join(walletRoot, "src");

async function collectSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(absolute)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(?:ts|tsx|js|mjs|json)$/.test(entry.name)) continue;
    if (/\.test\.(?:ts|tsx|js|mjs)$/.test(entry.name)) continue;
    files.push(absolute);
  }
  return files;
}

const releaseFiles = [
  path.join(walletRoot, "App.tsx"),
  path.join(walletRoot, "index.ts"),
  path.join(walletRoot, "app.json"),
  path.join(walletRoot, "package.json"),
  path.join(walletRoot, "public-product-metadata.json"),
  path.join(walletRoot, "product-release.json"),
  ...(await collectSourceFiles(sourceRoot)),
];

const forbiddenContent = [
  ["TODO marker", /\bTODO\b/i],
  ["FIXME marker", /\bFIXME\b/i],
  ["coming-soon claim", /\bcoming\s+soon\b/i],
  ["example domain", /\bexample\.com\b/i],
  ["fake balance", /\bfake\s+balance\b/i],
  ["fake user", /\bfake\s+user\b/i],
  ["fake transaction", /\bfake\s+transaction\b/i],
  ["fake price", /\bfake\s+price\b/i],
  ["fake revenue", /\bfake\s+revenue\b/i],
  ["fake APY", /\bfake\s+apy\b/i],
  ["fake liquidity", /\bfake\s+liquidity\b/i],
  ["fake provider", /\bfake\s+provider\b/i],
  ["fake health", /\bfake\s+health\b/i],
  ["hard-coded success", /\bhard[- ]coded\s+success\b/i],
  ["test mnemonic", /\b(?:abandon\s+){11}about\b/i],
];

const secretPatterns = [
  ["PEM private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/],
  ["Stripe live secret", /\bsk_live_[0-9A-Za-z]{16,}\b/],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ["literal bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/],
  ["assigned private key", /\bprivate[_-]?key\s*[:=]\s*["'][0-9a-f]{64}["']/i],
  ["assigned seed", /\bseed\s*[:=]\s*["'][^"'\n]{24,}["']/i],
  ["assigned provider secret", /\b(?:api|provider)[_-]?secret\s*[:=]\s*["'][^"'\n$]{16,}["']/i],
];

const failures = [];
for (const absolute of releaseFiles) {
  const text = await readFile(absolute, "utf8");
  const relative = path.relative(walletRoot, absolute);
  for (const [label, pattern] of [...forbiddenContent, ...secretPatterns]) {
    const match = text.match(pattern);
    if (!match) continue;
    const line = text.slice(0, match.index).split("\n").length;
    failures.push(`${relative}:${line}: ${label}`);
  }
}

assert.deepEqual(
  failures,
  [],
  `Wallet release content/secret gate failed:\n${failures.join("\n")}`,
);

console.log(
  `wallet release content check passed: ${releaseFiles.length} runtime/config/metadata files contain no disallowed filler or literal secret signatures`,
);
