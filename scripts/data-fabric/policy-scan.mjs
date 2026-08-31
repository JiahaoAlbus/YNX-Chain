#!/usr/bin/env node

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
const mode = process.argv[2];

const runtimePaths = [
  "cmd/ynx-data-fabricctl",
  "cmd/ynx-data-fabricd",
  "cmd/ynx-data-fabric-worker",
  "cmd/ynx-pay-data-fabric-bridge",
  "internal/datafabric",
  "internal/datafabricapi",
  "internal/datafabricbackup",
  "internal/datafabricconfig",
  "internal/datafabricnats",
  "internal/datafabricpay",
  "internal/datafabricpayledger",
  "internal/datafabricpostgres",
  "sdk/datafabric",
  "sdk/datafabric-typescript",
  "schemas/data-fabric",
  "configs/data-fabric.env.example",
  "configs/data-fabric-event-keys.example.json",
  "infra/data-fabric/systemd",
  "scripts/data-fabric/build-testnet-release.sh",
  "scripts/data-fabric/deploy-testnet.sh",
  "scripts/data-fabric/install-testnet-release.sh",
  "scripts/data-fabric/extract-public-testnet-release.mjs",
  "scripts/data-fabric/generate-cold-start-evidence.sh",
  "scripts/data-fabric/package-public-testnet-release.mjs",
  "scripts/data-fabric/package-public-testnet-release.sh",
  "scripts/data-fabric/promote-public-release.sh",
  "scripts/data-fabric/public-release-promotion-check.sh",
  "scripts/data-fabric/public-testnet-release-check.sh",
  "scripts/data-fabric/remote-install-testnet-release.sh",
  "scripts/data-fabric/testnet-release-check.sh",
  "scripts/data-fabric/testnet-deployment-check.sh",
  "scripts/data-fabric/testnet-remote-deploy-check.sh",
  "scripts/data-fabric/verify-testnet-deployment.sh",
  "scripts/data-fabric/verify-public-testnet-release.mjs",
  "scripts/data-fabric/verify-public-release.mjs",
  "scripts/data-fabric/write-public-release.mjs",
  "scripts/data-fabric/write-cold-start-evidence.mjs",
  "scripts/data-fabric/write-testnet-release-manifest.mjs",
  "scripts/data-fabric/write-testnet-provenance.mjs",
  "scripts/data-fabric/verify-testnet-release.mjs",
  "docs/data-fabric",
  "public-product-metadata.json",
  "product-release.json",
];

const secretPaths = [
  "configs",
  "schemas/data-fabric",
  "integration",
  "release/integration",
  "docs/integration",
  ".ai-bridge",
  "public-product-metadata.json",
  "product-release.json",
];

const publicPaths = ["public-product-metadata.json", "product-release.json"];
const textExtensions = new Set([
  ".c",
  ".css",
  ".go",
  ".h",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function isTextFile(file) {
  const base = path.basename(file);
  return textExtensions.has(path.extname(base).toLowerCase()) || !base.includes(".");
}

function collect(relativePath, output = []) {
  const absolutePath = path.join(root, relativePath);
  const stat = lstatSync(absolutePath);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "testdata") continue;
      collect(path.join(relativePath, entry.name), output);
    }
    return output;
  }
  if (stat.isFile() && isTextFile(relativePath)) output.push(relativePath);
  return output;
}

function uniqueFiles(paths) {
  return [...new Set(paths.flatMap((entry) => collect(entry)))].sort();
}

function scan({ paths, pattern, exclude }) {
  const matches = [];
  for (const relativePath of uniqueFiles(paths)) {
    if (exclude(relativePath)) continue;
    const lines = readFileSync(path.join(root, relativePath), "utf8").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (pattern.test(lines[index])) matches.push(`${relativePath}:${index + 1}:${lines[index]}`);
      pattern.lastIndex = 0;
    }
  }
  if (matches.length > 0) {
    process.stderr.write(`${matches.join("\n")}\n`);
    process.exit(1);
  }
}

try {
  if (mode === "runtime") {
    scan({
      paths: runtimePaths,
      pattern: /TODO|FIXME|placeholder|coming[\s-]+soon|example\.com|fake[\s-]+(?:balance|user|transaction|price|revenue|apy|liquidity|provider|health)|hard[\s-]*coded[\s-]+success|no[\s-]*op[\s-]+button|mock[\s-]+provider/iu,
      exclude: (file) => file.endsWith("_test.go"),
    });
  } else if (mode === "public") {
    scan({
      paths: publicPaths,
      pattern: /Codex|Worktree|codex\/|\/Users\/|localhost|127\.0\.0\.1|719e101|internal[\s-]+host/iu,
      exclude: () => false,
    });
  } else if (mode === "secret") {
    const beginMarker = ["-----", "BEGIN "].join("");
    const privateKeyMarker = ["PRIVATE", " KEY-----"].join("");
    const clientSecretMarker = ["client", "_secret"].join("");
    scan({
      paths: secretPaths,
      pattern: new RegExp(`${beginMarker}(?:RSA |EC |OPENSSH )?${privateKeyMarker}|${clientSecretMarker}\\s*[:=]\\s*[A-Za-z0-9+/=_-]{16,}`, "iu"),
      exclude: (file) => path.basename(file).includes(".example."),
    });
  } else {
    throw new Error("usage: policy-scan.mjs <runtime|public|secret>");
  }
  process.stdout.write(`${JSON.stringify({ status: "verified", mode })}\n`);
} catch (error) {
  process.stderr.write(`Data Fabric ${mode || "unknown"} policy scan failed: ${error.message}\n`);
  process.exit(2);
}
