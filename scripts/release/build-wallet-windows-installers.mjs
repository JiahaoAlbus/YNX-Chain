import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceCommit = process.argv[2];
const output = path.resolve(root, process.argv[3] ?? "release/wallet-cli/windows-installers");
if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) throw new Error("source commit required");
const sourceEpoch = Number(execFileSync("git", ["show", "-s", "--format=%ct", sourceCommit,], { cwd: root, encoding: "utf8" }).trim());
fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(output)) fs.rmSync(path.join(output, entry), { recursive: true, force: true });

const install = String.raw`param([string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'YNX Wallet CLI'))
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'ynx-wallet-cli.exe'
$manifest = Get-Content (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$actual = (Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $manifest.binarySha256) { throw 'installer payload hash mismatch' }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$target = Join-Path $InstallRoot 'ynx-wallet-cli.exe'
$temporary = Join-Path $InstallRoot 'ynx-wallet-cli.exe.new'
Copy-Item $source $temporary -Force
Move-Item $temporary $target -Force
Copy-Item (Join-Path $PSScriptRoot 'manifest.json') (Join-Path $InstallRoot 'manifest.json') -Force
Write-Output $target
`;
const uninstall = String.raw`param([string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'YNX Wallet CLI'))
$ErrorActionPreference = 'Stop'
$allowed = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'YNX Wallet CLI'))
$target = [IO.Path]::GetFullPath($InstallRoot)
if ($target -ne $allowed) { throw 'refusing to uninstall outside the canonical user directory' }
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
if (Test-Path $target) { throw 'uninstall failed' }
Write-Output $target
`;

const records = [];
for (const arch of ["amd64", "arm64"]) {
  const archive = path.join(root, `release/wallet-cli/artifacts/ynx-wallet-cli-windows-${arch}.exe.gz`);
  const binary = zlib.gunzipSync(fs.readFileSync(archive));
  const binarySha256 = hash(binary);
  const stage = path.join(output, `stage-${arch}`);
  fs.mkdirSync(stage);
  fs.writeFileSync(path.join(stage, "ynx-wallet-cli.exe"), binary);
  fs.writeFileSync(path.join(stage, "install.ps1"), install.replaceAll("\n", "\r\n"));
  fs.writeFileSync(path.join(stage, "uninstall.ps1"), uninstall.replaceAll("\n", "\r\n"));
  const inner = { schemaVersion: 1, sourceCommit, architecture: arch === "amd64" ? "x64" : "arm64", binarySha256, binaryBytes: binary.length, minimumOS: "Windows 10 or Windows Server 2016", signingClass: "unsigned_windows_user_installer_candidate", productionSigned: false };
  fs.writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(inner, null, 2)}\r\n`);
  for (const name of fs.readdirSync(stage)) fs.utimesSync(path.join(stage, name), sourceEpoch, sourceEpoch);
  const zip = path.join(output, `ynx-wallet-cli-windows-${inner.architecture}-installer.zip`);
  execFileSync("zip", ["-X", "-q", "-9", zip, "install.ps1", "manifest.json", "uninstall.ps1", "ynx-wallet-cli.exe"], { cwd: stage });
  fs.rmSync(stage, { recursive: true, force: true });
  const bytes = fs.readFileSync(zip);
  records.push({ path: path.relative(root, zip), format: "zip PowerShell user installer", architecture: inner.architecture, bytes: bytes.length, sha256: hash(bytes), binaryBytes: binary.length, binarySha256, minimumOS: inner.minimumOS, signingClass: inner.signingClass, runtimeTested: false, productionSigned: false });
}
const manifest = { schemaVersion: 1, sourceCommit, generatedAt: new Date(sourceEpoch * 1000).toISOString(), reproducibilityBoundary: "same host and Info-ZIP toolchain with stripped extra fields, stable order and source-commit timestamps", artifacts: records };
fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
