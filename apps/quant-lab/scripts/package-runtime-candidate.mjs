import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const args = parseArgs(process.argv.slice(2));
if (!/^[0-9a-f]{40}$/.test(args.commit) || !args.output) {
  throw new Error("usage: package-runtime-candidate.mjs --commit <exact-source-commit> --output <archive>");
}
if (git(["rev-parse", "HEAD"]) !== args.commit) {
  throw new Error("runtime package must be built from the requested exact source commit");
}

const sourceTree = git(["rev-parse", `${args.commit}^{tree}`]);
const sourceTime = git(["show", "-s", "--format=%aI", args.commit]);
const release = `ynx-quant-lab-${args.commit.slice(0, 12)}`;
const work = await mkdtemp(path.join(tmpdir(), "ynx-quant-runtime-"));
const binary = path.join(work, "ynx-quantd");
const walletBundle = path.join(work, "wallet-auth.js");
run("go", ["build", "-trimpath", "-buildvcs=false", "-ldflags", `-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=${args.commit}`, "-o", binary, "./apps/quant-lab/server"]);
run(path.join(root, "apps/quant-lab/node_modules/esbuild/bin/esbuild"), ["web/wallet-auth-entry.js", "--bundle", "--minify", "--platform=browser", "--target=es2022", `--outfile=${walletBundle}`], path.join(root, "apps/quant-lab"));

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const files = [];
async function add(absolute, relative, mode) {
  const info = await stat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`required regular file missing: ${relative}`);
  files.push({ relative, data: await readFile(absolute), mode });
}
await add(binary, `${release}/ynx-quantd`, 0o755);
for (const relative of await regularFiles(path.join(root, "apps/quant-lab/web"))) {
  if (relative === "wallet-auth.js") {
    await add(walletBundle, `${release}/apps/quant-lab/web/${relative}`, 0o644);
  } else {
    await add(path.join(root, "apps/quant-lab/web", relative), `${release}/apps/quant-lab/web/${relative}`, 0o644);
  }
}
files.sort((a, b) => a.relative.localeCompare(b.relative));
const inventory = files.map((file) => ({ path: file.relative, bytes: file.data.length, sha256: sha256(file.data), mode: file.mode.toString(8) }));
files.push({ relative: `${release}/BUNDLE_MANIFEST.json`, mode: 0o644, data: Buffer.from(`${JSON.stringify({ schemaVersion: 1, productId: "ynx-quant-lab", sourceCommit: args.commit, sourceTree, release, build: { goos: "linux", goarch: "amd64", cgoEnabled: false, trimpath: true, buildVCS: false, buildTime: sourceTime }, entries: inventory }, null, 2)}\n`) });
files.sort((a, b) => a.relative.localeCompare(b.relative));
files.push({ relative: `${release}/SHA256SUMS`, mode: 0o644, data: Buffer.from(files.map((file) => `${sha256(file.data)}  ${file.relative.slice(release.length + 1)}\n`).join("")) });
files.sort((a, b) => a.relative.localeCompare(b.relative));
const archive = gzipTar(files);
await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
await writeFile(args.output, archive, { mode: 0o644 });
process.stdout.write(`${JSON.stringify({ release, sourceCommit: args.commit, sourceTree, archive: { path: args.output, bytes: archive.length, sha256: sha256(archive) }, entries: files.map((file) => ({ path: file.relative, bytes: file.data.length, sha256: sha256(file.data), mode: file.mode.toString(8) })) }, null, 2)}\n`);

function parseArgs(argv) { const result = { commit: null, output: null }; for (let index = 0; index < argv.length; index += 2) { const key = argv[index], value = argv[index + 1]; if ((key !== "--commit" && key !== "--output") || !value || result[key.slice(2)] !== null) throw new Error("usage: package-runtime-candidate.mjs --commit <exact-source-commit> --output <archive>"); result[key.slice(2)] = value; } return result; }
function git(argv) { return execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim(); }
function run(command, argv, cwd = root) { execFileSync(command, argv, { cwd, stdio: "inherit" }); }
async function regularFiles(directory, prefix = "") { const entries = await readdir(directory, { withFileTypes: true }); const result = []; for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) { const relative = path.join(prefix, entry.name); if (entry.isDirectory()) result.push(...await regularFiles(path.join(directory, entry.name), relative)); else if (entry.isFile() && !entry.isSymbolicLink()) result.push(relative); else throw new Error(`unsupported web entry: ${relative}`); } return result; }
function gzipTar(entries) { const blocks = []; for (const entry of entries) { const header = Buffer.alloc(512); writeString(header, 0, 100, entry.relative); writeOctal(header, 100, 8, entry.mode); writeOctal(header, 108, 8, 0); writeOctal(header, 116, 8, 0); writeOctal(header, 124, 12, entry.data.length); writeOctal(header, 136, 12, 0); header.fill(0x20, 148, 156); header[156] = "0".charCodeAt(0); writeString(header, 257, 6, "ustar"); writeString(header, 263, 2, "00"); let checksum = 0; for (const byte of header) checksum += byte; writeOctal(header, 148, 8, checksum); blocks.push(header, entry.data, Buffer.alloc((512 - entry.data.length % 512) % 512)); } blocks.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 }); }
function writeString(buffer, offset, length, value) { const data = Buffer.from(value); if (data.length > length) throw new Error(`tar path too long: ${value}`); data.copy(buffer, offset); }
function writeOctal(buffer, offset, length, value) { writeString(buffer, offset, length, value.toString(8).padStart(length - 1, "0") + "\0"); }
