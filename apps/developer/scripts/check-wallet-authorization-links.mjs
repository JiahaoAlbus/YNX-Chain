import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const scanRoots = ["frontend/src", "desktop", "../../packages/developer-client/src"];
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx", ".m", ".mm"]);
const authorizationTarget = /ynxwallet:\/\/authorize(?:\?[^\s"'`)]*)?/g;

export function assertNoBareWalletAuthorization(source, label = "source") {
  for (const match of source.matchAll(authorizationTarget)) {
    const target = match[0];
    throw new Error(`BARE_WALLET_AUTHORIZE_URI:${label}:${target}`);
  }
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) files.push(path);
  }
  return files;
}

export async function assertNoBareWalletAuthorizationInReleaseSources() {
  const files = (await Promise.all(scanRoots.map((path) => sourceFiles(join(root, path))))).flat();
  files.push(join(root, "app.js"));
  for (const file of files) assertNoBareWalletAuthorization(await readFile(file, "utf8"), relative(root, file));
  return Object.freeze({ files: files.length, roots: Object.freeze([...scanRoots]) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await assertNoBareWalletAuthorizationInReleaseSources();
  console.log(`Wallet authorization link gate passed across ${result.files} release source files.`);
}
