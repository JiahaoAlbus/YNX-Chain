#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const args = parseArgs(process.argv.slice(2));
const sourceRoot = resolve(args.sourceRoot), outputRoot = resolve(args.output), runtimeRoot = resolve(args.runtimeRoot);
if (!/^[0-9a-f]{40}$/.test(args.sourceCommit)) fail("source commit must be a full lowercase Git SHA");
const exactHead = git(["rev-parse", "HEAD"], sourceRoot).trim();
if (exactHead !== args.sourceCommit) fail("source checkout HEAD does not match requested source commit");
if (git(["status", "--porcelain", "--untracked-files=no"], sourceRoot) !== "") fail("source checkout has tracked changes");

const short = args.sourceCommit.slice(0, 8), layout = `ynx-wallet-auth-${short}`;
const packagePrefix = "packages/wallet-auth/";
const packageJsonBytes = gitBytes(`${args.sourceCommit}:${packagePrefix}package.json`, sourceRoot);
const lockBytes = gitBytes(`${args.sourceCommit}:${packagePrefix}package-lock.json`, sourceRoot);
const packageJson = JSON.parse(packageJsonBytes), lock = JSON.parse(lockBytes);
if (packageJson.name !== "@ynx-chain/wallet-auth" || packageJson.version !== "1.1.0" || lock.lockfileVersion !== 3 || lock.packages?.[""]?.name !== packageJson.name || lock.packages?.[""]?.version !== packageJson.version) fail("Wallet/Auth package and lock identity mismatch");
const lockfileSha256 = sha256(lockBytes);
const sourceFiles = sourceEntries(sourceRoot, args.sourceCommit, packagePrefix, packageJson.files);
const sourceArchiveEntries = withDirectories(sourceFiles.map((entry) => ({ ...entry, path: `${layout}/source/${packagePrefix}${entry.relativePath}` })));
const sourceArchive = gzipTar(sourceArchiveEntries);
const sourceInventory = inventory("wallet-auth-deployable-source", args.sourceCommit, lockfileSha256, `${layout}/source`, sourceArchiveEntries);

const runtimeNodeModules = join(runtimeRoot, "node_modules");
validateRuntime(runtimeNodeModules, lock);
const runtimeFiles = filesystemEntries(runtimeNodeModules).map((entry) => ({ ...entry, path: `${layout}/source/${packagePrefix}node_modules/${entry.relativePath}` }));
const runtimeArchiveEntries = withDirectories(runtimeFiles);
const runtimeArchive = gzipTar(runtimeArchiveEntries);
const runtimeInventory = inventory("wallet-auth-offline-dependency-runtime", args.sourceCommit, lockfileSha256, `${layout}/source`, runtimeArchiveEntries);
const sbom = cyclonedx(lock, args.sourceCommit, lockfileSha256, commitTime(sourceRoot, args.sourceCommit));

mkdirSync(outputRoot, { recursive: true, mode: 0o755 });
const outputs = {
  sourceArchive: `wallet-auth-source-${short}.tar.gz`,
  sourceInventory: `wallet-auth-source-${short}.inventory.json`,
  runtimeArchive: `wallet-auth-runtime-dependencies-${short}.tar.gz`,
  runtimeInventory: `wallet-auth-runtime-dependencies-${short}.inventory.json`,
  sbom: `wallet-auth-runtime-${short}.cdx.json`,
};
writeFileSync(join(outputRoot, outputs.sourceArchive), sourceArchive);
writeFileSync(join(outputRoot, outputs.sourceInventory), `${canonical(sourceInventory)}\n`);
writeFileSync(join(outputRoot, outputs.runtimeArchive), runtimeArchive);
writeFileSync(join(outputRoot, outputs.runtimeInventory), `${canonical(runtimeInventory)}\n`);
writeFileSync(join(outputRoot, outputs.sbom), `${canonical(sbom)}\n`);
process.stdout.write(`${canonical({
  lockfileSha256,
  outputs: Object.fromEntries(Object.entries(outputs).map(([key, name]) => {
    const bytes = readFileSync(join(outputRoot, name));
    const inventoryValue = key === "sourceArchive" ? sourceInventory : key === "runtimeArchive" ? runtimeInventory : null;
    return [key, { bytes: bytes.length, entries: inventoryValue?.archiveEntryCount ?? null, fileEntries: inventoryValue?.fileEntryCount ?? null, name, sha256: sha256(bytes) }];
  })),
  schemaVersion: 1,
  sourceCommit: args.sourceCommit,
})}\n`);

function sourceEntries(root, commit, prefix, declaredFiles) {
  if (!Array.isArray(declaredFiles) || declaredFiles.some((value) => typeof value !== "string" || value.includes("..") || value.startsWith("/"))) fail("package files allowlist is invalid");
  const allowed = new Set(["package.json", "package-lock.json"]), directoryPrefixes = [];
  for (const item of declaredFiles) item.includes(".") ? allowed.add(item) : directoryPrefixes.push(`${item}/`);
  const lines = git(["ls-tree", "-r", commit, "--", prefix], root).trim().split("\n").filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const match = /^(100644|100755|120000) blob [0-9a-f]+\t(.+)$/.exec(line);
    if (!match) fail("unsupported source tree entry");
    const relativePath = match[2].slice(prefix.length);
    if (!allowed.has(relativePath) && !directoryPrefixes.some((item) => relativePath.startsWith(item))) continue;
    const data = gitBytes(`${commit}:${match[2]}`, root);
    entries.push(match[1] === "120000" ? { relativePath, type: "symlink", linkname: data.toString("utf8"), mode: 0o777, data: Buffer.alloc(0) } : { relativePath, type: "file", mode: match[1] === "100755" ? 0o755 : 0o644, data });
  }
  if (!entries.some((entry) => entry.relativePath === "package-lock.json")) fail("source archive omits package-lock.json");
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function filesystemEntries(root) {
  const entries = [];
  walk(root, "");
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  function walk(absolute, prefix) {
    for (const name of readdirSync(absolute).sort()) {
      const path = join(absolute, name), relativePath = prefix ? `${prefix}/${name}` : name, info = lstatSync(path);
      if (info.isDirectory() && !info.isSymbolicLink()) walk(path, relativePath);
      else if (info.isSymbolicLink()) entries.push({ relativePath, type: "symlink", linkname: readlinkSync(path), mode: 0o777, data: Buffer.alloc(0) });
      else if (info.isFile()) entries.push({ relativePath, type: "file", mode: info.mode & 0o111 ? 0o755 : 0o644, data: readFileSync(path) });
      else fail("runtime contains unsupported filesystem entry");
    }
  }
}

function validateRuntime(nodeModules, lock) {
  const installedLock = JSON.parse(readFileSync(join(nodeModules, ".package-lock.json")));
  if (installedLock.lockfileVersion !== lock.lockfileVersion) fail("installed runtime lock version mismatch");
  const expected = Object.entries(lock.packages).filter(([path]) => path.startsWith("node_modules/")).map(([path, value]) => [path, value.version, value.integrity]).sort();
  const actual = Object.entries(installedLock.packages).filter(([path]) => path.startsWith("node_modules/")).map(([path, value]) => [path, value.version, value.integrity]).sort();
  if (canonical(actual) !== canonical(expected)) fail("installed runtime dependency graph differs from package-lock.json");
}

function inventory(kind, sourceCommit, lockfileSha256, extractionRoot, entries) {
  return {
    archiveEntryCount: entries.length,
    entries: entries.map((entry) => ({ bytes: entry.data.length, mode: entry.mode.toString(8).padStart(4, "0"), path: entry.path, sha256: entry.type === "file" ? sha256(entry.data) : null, target: entry.linkname ?? null, type: entry.type })),
    extractionRoot,
    fileEntryCount: entries.filter((entry) => entry.type !== "directory").length,
    kind,
    lockfileSha256,
    schemaVersion: 1,
    sourceCommit,
  };
}

function cyclonedx(lock, sourceCommit, lockfileSha256, timestamp) {
  const packages = Object.entries(lock.packages);
  const components = packages.map(([path, value]) => {
    const name = path === "" ? lock.name : path.replace(/^node_modules\//, ""), type = path === "" ? "application" : "library";
    const component = { "bom-ref": `pkg:npm/${encodePurl(name)}@${value.version}`, name, purl: `pkg:npm/${encodePurl(name)}@${value.version}`, type, version: value.version };
    if (value.license) component.licenses = [{ license: { id: value.license } }];
    if (value.integrity?.startsWith("sha512-")) component.hashes = [{ alg: "SHA-512", content: Buffer.from(value.integrity.slice(7), "base64").toString("hex") }];
    component.properties = [{ name: "ynx:lockfile-path", value: path || "." }];
    return component;
  }).sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
  const ref = (name, version) => `pkg:npm/${encodePurl(name)}@${version}`;
  const dependencies = packages.map(([path, value]) => ({ ref: ref(path === "" ? lock.name : path.replace(/^node_modules\//, ""), value.version), dependsOn: Object.entries(value.dependencies ?? {}).map(([name, version]) => ref(name, version)).sort() })).sort((a, b) => a.ref.localeCompare(b.ref));
  return { bomFormat: "CycloneDX", components, dependencies, metadata: { component: components.find((item) => item.type === "application"), properties: [{ name: "ynx:source-commit", value: sourceCommit }, { name: "ynx:package-lock-sha256", value: lockfileSha256 }, { name: "ynx:network-install-required-at-deploy", value: "false" }], timestamp, tools: { components: [{ name: "wallet-auth-offline-release.mjs", type: "application", version: "1" }] } }, serialNumber: uuidUrn(sha256(`wallet-auth-sbom\n${sourceCommit}\n${lockfileSha256}`)), specVersion: "1.5", version: 1 };
}

function withDirectories(files) {
  const directories = new Set();
  for (const entry of files) {
    let current = dirname(entry.path);
    while (current !== ".") { directories.add(`${current}/`); current = dirname(current); }
  }
  return [...[...directories].map((path) => ({ path, type: "directory", mode: 0o755, data: Buffer.alloc(0) })), ...files].sort((a, b) => a.path.localeCompare(b.path));
}

function gzipTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    blocks.push(tarHeader(entry));
    if (entry.type === "file") { blocks.push(entry.data); const padding = (512 - entry.data.length % 512) % 512; if (padding) blocks.push(Buffer.alloc(padding)); }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
}

function tarHeader(entry) {
  const header = Buffer.alloc(512), split = splitTarPath(entry.path);
  field(header, 0, 100, split.name); octal(header, 100, 8, entry.mode); octal(header, 108, 8, 0); octal(header, 116, 8, 0);
  octal(header, 124, 12, entry.type === "file" ? entry.data.length : 0); octal(header, 136, 12, 0); header.fill(0x20, 148, 156);
  field(header, 156, 1, entry.type === "directory" ? "5" : entry.type === "symlink" ? "2" : "0"); field(header, 157, 100, entry.linkname ?? "");
  field(header, 257, 6, "ustar\0"); field(header, 263, 2, "00"); field(header, 265, 32, "root"); field(header, 297, 32, "root"); field(header, 345, 155, split.prefix);
  const sum = header.reduce((total, value) => total + value, 0), checksum = sum.toString(8).padStart(6, "0"); field(header, 148, 8, `${checksum}\0 `);
  return header;
}

function splitTarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index), name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  fail(`archive path exceeds ustar limits: ${path}`);
}

function field(buffer, offset, length, value) { const bytes = Buffer.from(value); if (bytes.length > length) fail("tar field overflow"); bytes.copy(buffer, offset); }
function octal(buffer, offset, length, value) { field(buffer, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`); }
function git(args, cwd) { return execFileSync("git", args, { cwd, encoding: "utf8" }); }
function gitBytes(spec, cwd) { return execFileSync("git", ["show", spec], { cwd, encoding: "buffer", maxBuffer: 128 * 1024 * 1024 }); }
function commitTime(root, commit) { return new Date(git(["show", "-s", "--format=%cI", commit], root).trim()).toISOString(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function encodePurl(name) { if (!name.startsWith("@")) return encodeURIComponent(name); const [scope, packageName] = name.split("/"); return `${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`; }
function uuidUrn(hex) { const chars = hex.slice(0, 32).split(""); chars[12] = "5"; chars[16] = ["8", "9", "a", "b"][parseInt(chars[16], 16) % 4]; const value = chars.join(""); return `urn:uuid:${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`; }
function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
function parseArgs(values) { const map = new Map([["--output", "output"], ["--runtime-root", "runtimeRoot"], ["--source-commit", "sourceCommit"], ["--source-root", "sourceRoot"]]), result = {}; if (values.length !== 8) fail("exact --source-root --source-commit --runtime-root --output arguments are required"); for (let index = 0; index < values.length; index += 2) { const key = map.get(values[index]); if (!key || result[key] || !values[index + 1]) fail("release arguments are invalid"); result[key] = values[index + 1]; } return result; }
function fail(message) { throw new Error(message); }
