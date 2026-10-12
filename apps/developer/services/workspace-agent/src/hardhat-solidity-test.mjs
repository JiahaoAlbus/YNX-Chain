import { copyFile, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { platform, arch } from "node:os";
import { createHash } from "node:crypto";
import { setMockCacheDir } from "@nomicfoundation/hardhat-utils/global-dir";

const toolchainRoot = process.argv[2];
if (!toolchainRoot?.startsWith("/") || !toolchainRoot.endsWith("/node_modules")) throw new Error("Reviewed Hardhat toolchain root is required.");
const workspace = process.cwd(),
  buildRoot = join(workspace, ".ynx-build", "hardhat"),
  cacheRoot = join(buildRoot, "global"),
  compilerRoot = join(cacheRoot, "compilers-v3", "wasm"),
  soljson = join(toolchainRoot, "solc", "soljson.js"),
  compilerName = "soljson-v0.8.24+commit.e11b9ed9.js",
  compilerTarget = join(compilerRoot, compilerName),
  compilerBytes = await readFile(soljson),
  sha256 = createHash("sha256").update(compilerBytes).digest("hex");

if (sha256 !== "fb59b825b7d57f9de89cd9de2415b12aab1fcc7eb2573fd2bf5c9b969eacf4d9") throw new Error("Pinned solc 0.8.24 artifact digest mismatch.");
const hardhatPackage = join(toolchainRoot, "hardhat", "package.json"),
  hardhatMetadata = JSON.parse(await readFile(hardhatPackage, "utf8"));
if (hardhatMetadata.version !== "3.9.0") throw new Error("Pinned Hardhat 3.9.0 runtime is required.");
await mkdir(compilerRoot, { recursive: true });
const copySources = async (source, target) => {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) await copySources(from, to);
    else if (entry.isFile() && entry.name.endsWith(".sol")) await copyFile(from, to);
    else if (entry.isSymbolicLink()) throw new Error("Solidity source symlinks are not allowed.");
  }
};
await copySources(join(workspace, "contracts"), join(buildRoot, "contracts"));
await symlink(toolchainRoot, join(buildRoot, "node_modules"), "dir").catch((error) => { if (error.code !== "EEXIST") throw error; });
await writeFile(join(buildRoot, "package.json"), '{"type":"module"}\n', { mode: 0o600 });
await writeFile(join(cacheRoot, "package.json"), '{"type":"commonjs"}\n', { mode: 0o600 });
await copyFile(soljson, compilerTarget);
await writeFile(join(compilerRoot, "list.json"), `${JSON.stringify({
  builds: [{ path: compilerName, version: "0.8.24", build: "commit.e11b9ed9", longVersion: "0.8.24+commit.e11b9ed9", keccak256: "0xf57f06d0aef995a5524f973e6b18f802e1d8719b96216dbeac4c0861fa6a6195", sha256: `0x${sha256}`, urls: [] }],
  releases: { "0.8.24": compilerName },
  latestRelease: "0.8.24",
}, null, 2)}\n`, { mode: 0o600 });
const nativePlatform = platform() === "darwin" ? "macosx-amd64" : platform() === "win32" ? "windows-amd64" : arch() === "arm64" ? "linux-arm64" : "linux-amd64",
  nativeRoot = join(cacheRoot, "compilers-v3", nativePlatform),
  nativePlaceholder = "ynx-prefer-wasm-0.8.24";
await mkdir(nativeRoot, { recursive: true });
await writeFile(join(nativeRoot, nativePlaceholder), "YNX Code uses the reviewed WASM compiler.\n", { mode: 0o500 });
await writeFile(join(nativeRoot, "list.json"), `${JSON.stringify({
  builds: [{ path: nativePlaceholder, url: "", version: "0.8.24", longVersion: "0.8.24+commit.e11b9ed9", sha256: "0x00" }],
  releases: { "0.8.24": nativePlaceholder },
  latestRelease: "0.8.24",
}, null, 2)}\n`, { mode: 0o600 });
const configPath = join(buildRoot, "hardhat.config.mjs");
await writeFile(configPath, `export default ${JSON.stringify({
  solidity: { version: "0.8.24", preferWasm: true, settings: { optimizer: { enabled: true, runs: 200 } } },
  paths: { sources: "./contracts", tests: "./test", artifacts: "./artifacts", cache: "./cache" },
  networks: { hardhatMainnet: { type: "edr-simulated", chainType: "l1" } },
})};\n`, { mode: 0o600 });
setMockCacheDir(cacheRoot);
const mainModule = join(dirname(hardhatPackage), "dist", "src", "internal", "cli", "main.js"),
  { main } = await import(pathToFileURL(mainModule));
await main(["--config", configPath, "test", "solidity"], { registerTsx: true, warnAboutUnusedPlugins: false });
if (process.exitCode && process.exitCode !== 0) throw new Error(`Hardhat Solidity tests failed with exit code ${process.exitCode}`);
