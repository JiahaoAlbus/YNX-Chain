import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export const YNX_CHAIN_IDENTITY = Object.freeze({
  decimal: 6423,
  eip1193: "0x1917",
  canonical: "ynx_6423-1",
});

const inspectedRoots = ["app.js", "index.html", "frontend/src", "scripts", "services"];
const ignoredDirectories = new Set(["node_modules", "vendor", "dist", "evidence", "release", ".ynx-developer-local", "test"]);

export function assertCanonicalChainLiteral(value, representation) {
  const expected = YNX_CHAIN_IDENTITY[representation];
  if (value !== expected) {
    throw new Error(`Developer chain ${representation} must be ${JSON.stringify(expected)}, received ${JSON.stringify(value)}.`);
  }
}

export function assertSourceHasOnlyCanonicalChainLiterals(source, label = "source") {
  for (const match of source.matchAll(/\bchain(?:[_-]?id|Id)\s*:\s*["']([^"']+)["']/g)) {
    const value = match[1];
    if (value !== YNX_CHAIN_IDENTITY.eip1193 && value !== YNX_CHAIN_IDENTITY.canonical) {
      throw new Error(`${label} contains a non-canonical string chain ID: ${value}.`);
    }
  }
  for (const match of source.matchAll(/\bchain(?:[_-]?id|Id)\s*:\s*(\d+)\b/g)) {
    if (Number(match[1]) !== YNX_CHAIN_IDENTITY.decimal) {
      throw new Error(`${label} contains a non-canonical numeric chain ID: ${match[1]}.`);
    }
  }
}

export async function assertCanonicalDeveloperChainIdentity(directory = root) {
  const files = [];
  for (const relative of inspectedRoots) await collect(join(directory, relative), files);
  let literalFiles = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\bchain(?:[_-]?id|Id)\s*:/u.test(source)) literalFiles += 1;
    assertSourceHasOnlyCanonicalChainLiterals(source, file);
  }
  if (literalFiles < 6) throw new Error("Developer chain identity gate inspected too few chain-bearing source files.");

  await expect(root, "frontend/src/wallet/safe-authorize-launcher.ts", YNX_CHAIN_IDENTITY.eip1193);
  await expect(root, "frontend/src/wallet/transport.ts", YNX_CHAIN_IDENTITY.canonical);
  await expect(root, "frontend/src/wallet/transport.ts", "chainId:6423");
  await expect(root, "services/chain-service/src/service.mjs", "!==6423");
  await expect(root, "services/wallet-readiness/src/service.mjs", "chainId !== 6423");
  await expect(root, "scripts/server.mjs", "chainId: 6423");
  return Object.freeze({ files: files.length, literalFiles, identity: YNX_CHAIN_IDENTITY });
}

async function expect(directory, relative, expected) {
  const source = await readFile(join(directory, relative), "utf8");
  if (!source.includes(expected)) throw new Error(`${relative} is missing canonical chain identity ${expected}.`);
}

async function collect(path, files) {
  let entry;
  try { entry = await readdir(path, { withFileTypes: true }); }
  catch { files.push(path); return; }
  for (const item of entry) {
    if (ignoredDirectories.has(item.name)) continue;
    const child = join(path, item.name);
    if (item.isDirectory()) await collect(child, files);
    else if (item.isFile() && /\.(?:[cm]?[jt]sx?|html)$/u.test(item.name)) files.push(child);
  }
}
