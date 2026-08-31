import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceCommit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) throw new Error("usage: build-wallet-cli.mjs <40-char source commit>");
execFileSync("git", ["cat-file", "-e", `${sourceCommit}^{commit}`], { cwd: root });
const output = path.join(root, "release/wallet-cli/artifacts");
fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(output)) fs.rmSync(path.join(output, entry), { recursive: true, force: true });
const goVersion = execFileSync("go", ["version"], { encoding: "utf8" }).trim();
const targets = [
  ["darwin", "arm64", "macOS 12 Monterey", true], ["darwin", "amd64", "macOS 12 Monterey", false],
  ["linux", "arm64", "Linux kernel 3.2", false], ["linux", "amd64", "Linux kernel 3.2", false],
  ["windows", "arm64", "Windows 10 or Windows Server 2016", false], ["windows", "amd64", "Windows 10 or Windows Server 2016", false],
];
const artifacts = [];
for (const [goos, goarch, minimumOS, runtimeTested] of targets) {
  const extension = goos === "windows" ? ".exe" : "";
  const binaryName = `ynx-wallet-cli-${goos}-${goarch}${extension}`;
  const binaryPath = path.join(output, binaryName);
  execFileSync("go", ["build", "-trimpath", "-buildvcs=false", `-ldflags=-buildid= -X main.version=${sourceCommit}`, "-o", binaryPath, "./cmd/ynx-wallet-cli"], { cwd: root, env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0" }, stdio: "inherit" });
  fs.chmodSync(binaryPath, 0o755);
  const binary = fs.readFileSync(binaryPath);
  const archiveName = `${binaryName}.gz`;
  const archivePath = path.join(output, archiveName);
  fs.writeFileSync(archivePath, zlib.gzipSync(binary, { level: 9, mtime: 0 }));
  fs.rmSync(binaryPath);
  const archive = fs.readFileSync(archivePath);
  const signingClass = goos === "darwin"
    ? (runtimeTested ? "ad_hoc_linker_signed_local_testnet_cli_candidate" : "ad_hoc_linker_signed_cross_arch_static_candidate")
    : "unsigned_local_testnet_cli_candidate";
  const minimumOSBasis = goos === "darwin"
    ? "Go 1.25 official minimum requirements; Mach-O LC_BUILD_VERSION records 12.0"
    : `Go 1.25 official ${goos} minimum requirements`;
  artifacts.push({
    artifactId: `ynx-wallet-cli-${goos}-${goarch}`,
    path: `release/wallet-cli/artifacts/${archiveName}`,
    format: goos === "windows" ? "gzip-compressed PE executable" : `gzip-compressed ${goos === "darwin" ? "Mach-O" : "ELF"} executable`,
    target: { goos, goarch }, minimumOS,
    minimumOSReference: "https://go.dev/wiki/MinimumRequirements",
    minimumOSBasis,
    signingClass,
    bytes: archive.length, sha256: crypto.createHash("sha256").update(archive).digest("hex"),
    binaryBytes: binary.length, binarySha256: crypto.createHash("sha256").update(binary).digest("hex"),
    runtimeTested, productionSigned: false, immutableDownloadURL: null,
  });
}
const manifest = { schemaVersion: 1, sourceCommit, generatedAt: execFileSync("git", ["show", "-s", "--format=%cI", sourceCommit], { cwd: root, encoding: "utf8" }).trim(), toolchain: goVersion, build: { cgoEnabled: false, trimpath: true, buildVCS: false, buildID: "empty", compression: "gzip-level-9-mtime-0" }, artifacts };
fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
