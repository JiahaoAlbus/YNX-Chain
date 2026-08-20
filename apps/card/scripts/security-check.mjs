import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import process from "node:process";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const scanRoots = [
  resolve(repositoryRoot, "apps/card"),
  resolve(repositoryRoot, "internal/cardproduct"),
  resolve(repositoryRoot, "docs/handoffs/card.md"),
  resolve(repositoryRoot, "docs/evidence/pay-card-index.md"),
  resolve(repositoryRoot, "docs/integration/pay-card-wallet-registry.json"),
  resolve(repositoryRoot, "docs/integration/INTEGRATION_HANDOFF.md"),
  resolve(repositoryRoot, "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"),
  resolve(repositoryRoot, "docs/integration/DEPENDENCY_ACCEPTANCE.md"),
  resolve(repositoryRoot, "release/integration/ynx-card-contract.json"),
  resolve(repositoryRoot, ".ai-bridge/full-goal-coverage.json"),
];
const ignoredDirectories = new Set(["node_modules", "dist", "build", ".gradle", ".expo"]);
const binaryExtensions = new Set([".png", ".webp", ".jpg", ".jpeg", ".jar", ".tgz"]);
const forbiddenSigningExtensions = new Set([".keystore", ".jks", ".p12", ".pfx", ".pem", ".key"]);
const contentPatterns = [
  ["private key block", /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["hard-coded Gradle store password", /\bstorePassword\s+['"][^'"]+['"]/],
  ["hard-coded Gradle key password", /\bkeyPassword\s+['"][^'"]+['"]/],
];

const findings = [];

async function collect(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (entries === null) {
    return [path];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function luhn(value) {
  let sum = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

for (const root of scanRoots) {
  for (const path of await collect(root)) {
    const displayPath = relative(repositoryRoot, path);
    const extension = extname(path).toLowerCase();
    if (forbiddenSigningExtensions.has(extension) || path.endsWith("debug.keystore")) {
      findings.push(`${displayPath}: signing/private material filename is forbidden`);
      continue;
    }
    if (binaryExtensions.has(extension)) continue;
    const content = await readFile(path, "utf8").catch(() => null);
    if (content === null) continue;
    for (const [label, pattern] of contentPatterns) {
      if (pattern.test(content)) findings.push(`${displayPath}: ${label}`);
    }
    for (const match of content.matchAll(/(?<![A-Za-z0-9])\d{13,19}(?![A-Za-z0-9])/g)) {
      if (luhn(match[0])) findings.push(`${displayPath}: Luhn-valid PAN-like literal`);
    }
  }
}

if (findings.length > 0) {
  console.error("YNX Card security check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("YNX Card security check passed: no signing material, private-key pattern, provider secret, or PAN-like literal found.");
