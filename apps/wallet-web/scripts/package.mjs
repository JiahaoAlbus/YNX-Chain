import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, readdir, rm, stat, utimes, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {requirePackageSourceCommit} from "../src/package-source-identity.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(root, "..", "..");
const dist = join(root, "dist"), artifacts = join(root, "artifacts");
const sourceCommit = requirePackageSourceCommit(process.env.YNX_WALLET_WEB_SOURCE_COMMIT);
try {
  execFileSync("git", ["cat-file", "-e", `${sourceCommit}^{commit}`], {cwd:repository, stdio:"ignore"});
} catch {
  const error = new Error(`PACKAGE_SOURCE_COMMIT_UNAVAILABLE: ${sourceCommit} is not a commit in this repository`);
  error.code = "PACKAGE_SOURCE_COMMIT_UNAVAILABLE";
  throw error;
}

const testFiles = (await readdir(join(root, "test")))
  .filter(name => name.endsWith(".test.js"))
  .sort()
  .map(name => `test/${name}`);
execFileSync(process.execPath, ["--test", ...testFiles], {cwd:root, stdio:"inherit"});
await import("./build.mjs");
await mkdir(artifacts, {recursive: true});
const reproducibleTime = new Date("2000-01-01T00:00:00.000Z");
async function normalizeMtime(path) {
  const info = await stat(path);
  if (info.isDirectory()) for (const entry of await readdir(path)) await normalizeMtime(join(path, entry));
  await utimes(path, reproducibleTime, reproducibleTime);
}
const entries = [
  ["ynx-wallet-web-pwa-0.1.0.zip", "pwa", "modern browser with Service Worker and Web Crypto support", "unsigned-web-bundle", ["PWA"]],
  ["ynx-wallet-chrome-edge-0.1.0.zip", "chromium", "Chrome 120 / Edge 120", "unsigned-unpacked-extension", ["Chrome", "Edge"]],
  ["ynx-wallet-firefox-0.1.0.zip", "firefox", "Firefox 128", "unsigned-unpacked-extension", ["Firefox"]],
];
const records = [];
for (const [name, folder, minimumOS, signingClass, browsers] of entries) {
  const output = join(artifacts, name);
  const identityPath = join(dist, folder, "build-identity.json");
  const identity = JSON.parse(await readFile(identityPath, "utf8"));
  if (identity.sourceCommit !== sourceCommit) {
    const error = new Error(`PACKAGE_BUILD_IDENTITY_MISMATCH: ${folder} declares ${identity.sourceCommit || "missing"}, expected ${sourceCommit}`);
    error.code = "PACKAGE_BUILD_IDENTITY_MISMATCH";
    throw error;
  }
  await normalizeMtime(join(dist, folder));
  await rm(output, {force:true});
  execFileSync("zip", ["-X", "-q", "-r", output, "."], {cwd: join(dist, folder)});
  const data = await readFile(output); const info = await stat(output);
  records.push({name, path:`artifacts/${name}`, bytes:info.size, sha256:createHash("sha256").update(data).digest("hex"), minimumOS, signingClass, browsers, installedLocal:false, productionSigned:false, storeReleased:false});
}
const manifest = {schemaVersion:1,productId:"wallet-web",version:"0.1.0-testnet-preview.1",sourceCommit,implementedLocal:true,testedLocal:true,installedLocal:false,integratedCentral:false,deployedStaging:false,deployedPublic:false,downloadHosted:false,productionSigned:false,storeReleased:false,artifacts:records};
await writeFile(join(root, "artifact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
execFileSync(process.execPath, ["scripts/verify-package.mjs"], {cwd:root, stdio:"inherit"});
