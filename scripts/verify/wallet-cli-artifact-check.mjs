import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "release/wallet-cli/artifacts/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath));
assert.equal(manifest.artifacts.length, 6);
for (const artifact of manifest.artifacts) {
  const archive = fs.readFileSync(path.join(root, artifact.path));
  assert.equal(archive.length, artifact.bytes);
  assert.equal(hash(archive), artifact.sha256);
  const binary = zlib.gunzipSync(archive);
  assert.equal(binary.length, artifact.binaryBytes);
  assert.equal(hash(binary), artifact.binarySha256);
  if (artifact.target.goos === "darwin") assert.equal(binary.subarray(0, 4).toString("hex"), "cffaedfe");
  if (artifact.target.goos === "linux") assert.equal(binary.subarray(0, 4).toString("hex"), "7f454c46");
  if (artifact.target.goos === "windows") assert.equal(binary.subarray(0, 2).toString(), "MZ");
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-wallet-cli-install-"));
const installBin = path.join(temporary, "bin");
const installed = path.join(installBin, "ynx-wallet-cli");
let evidence;
try {
  fs.mkdirSync(installBin, { recursive: true, mode: 0o755 });
  execFileSync("go", ["build", "-trimpath", "-buildvcs=false", "-ldflags=-buildid= -X main.version=preflight", "-o", installed, "./cmd/ynx-wallet-cli"], { cwd: root, env: { ...process.env, GOOS: "darwin", GOARCH: "arm64", CGO_ENABLED: "0" } });
  fs.chmodSync(installed, 0o755);
  const coldStartBeforeUpgrade = runJSON(installed, ["version"]);
  assert.equal(coldStartBeforeUpgrade.version, "preflight");

  const native = manifest.artifacts.find((item) => item.target.goos === "darwin" && item.target.goarch === "arm64");
  fs.writeFileSync(installed, zlib.gunzipSync(fs.readFileSync(path.join(root, native.path))), { mode: 0o755 });
  fs.chmodSync(installed, 0o755);
  assert.equal(hash(fs.readFileSync(installed)), native.binarySha256);
  const coldStart = runJSON(installed, ["version"]);
  const secondStart = runJSON(installed, ["version"]);
  assert.equal(coldStart.version, manifest.sourceCommit);
  assert.deepEqual(secondStart, coldStart);
  const vector = runJSON(installed, ["verify-vector"]);
  const config = runJSON(installed, ["validate-config"]);
  assert.equal(vector.verified, true);
  assert.deepEqual({nativeChainId: config.nativeChainId, chainId: config.chainId, evmChainId: config.evmChainId, nativeCurrency: config.nativeCurrency}, {nativeChainId: "ynx_6423-1", chainId: 6423, evmChainId: "0x1917", nativeCurrency: "YNXT"});
  const help = execFileSync(installed, ["help"], {cwd: root, encoding: "utf8", timeout: 20000});
  assert.match(help, /ynx_6423-1 \/ 6423 \/ 0x1917 \/ YNXT/);
  const legacy = spawnSync(installed, ["chain-status", "--chain-id", "9102"], {cwd: root, encoding: "utf8", timeout: 20000});
  assert.equal(legacy.status, 78);
  assert.equal(legacy.stdout, "");
  const legacyDiagnostic = JSON.parse(legacy.stderr);
  assert.equal(legacyDiagnostic.error.code, "WRONG_CHAIN");
  assert.equal(legacyDiagnostic.error.remediation, "USE_YNX_TESTNET_6423");
  const signature = spawnSync("codesign", ["-dv", "--verbose=4", installed], {encoding: "utf8", timeout: 20000});
  assert.equal(signature.status, 0);
  assert.match(signature.stderr, /Signature=adhoc/);
  assert.match(signature.stderr, /TeamIdentifier=not set/);
  execFileSync("codesign", ["--verify", "--strict", installed], {stdio: "pipe", timeout: 20000});
  const loadCommands = execFileSync("otool", ["-l", installed], {encoding: "utf8", timeout: 20000});
  assert.match(loadCommands, /minos 12\.0/);
  fs.rmSync(installed);
  assert.equal(fs.existsSync(installed), false);
  assert.deepEqual(fs.readdirSync(installBin), []);
  evidence = {
    schemaVersion: 1, evidenceClass: "local-wallet-cli-artifact", sourceCommit: manifest.sourceCommit,
    generatedAt: new Date().toISOString(), host: { os: os.platform(), arch: os.arch(), release: os.release() },
    artifactManifest: "release/wallet-cli/artifacts/manifest.json", artifacts: manifest.artifacts,
    installation: { target: "darwin/arm64", transientUserPrefix: true, executableMode: "0755", installed: true, coldStart: true, secondStart: true, upgradeFromVersion: "preflight", upgradedToVersion: manifest.sourceCommit, uninstallVerified: true, installBinEmptyAfterUninstall: true, temporaryRootRemoved: false },
    protocol: { frozenVectorVerified: vector.verified, signingSelfTestRun: false, accountRequested: false, signed: false, transactionCreated: false },
    testnet: { configValidated: true, nativeChainId: config.nativeChainId, chainId: config.chainId, evmChainId: config.evmChainId, nativeCurrency: config.nativeCurrency, remoteProbeRun: false, connected: false, legacy9102Rejected: true, legacyExitCode: legacy.status, legacyRemediation: legacyDiagnostic.error.remediation },
    platform: { minimumOS: "macOS 12 Monterey", minimumOSLoadCommand: "12.0", signingClass: "ad_hoc_linker_signed_local_testnet_cli_candidate", codesignVerify: true, teamIdentifierPresent: false, productionSigned: false, notarized: false },
    releaseState: { implementedLocal: true, testedLocal: true, installedLocal: true, integratedCentral: false, deployedStaging: false, deployedPublic: false, downloadHosted: false, productionSigned: false, storeReleased: false },
  };
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
assert.equal(fs.existsSync(temporary), false);
evidence.installation.temporaryRootRemoved = true;
fs.writeFileSync(path.join(root, "release/wallet-cli/local-install-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wallet CLI artifacts verified: source=${manifest.sourceCommit} artifacts=6 installedLocal=true config=6423 remoteProbe=false productionSigned=false`);

function runJSON(command, args) { return JSON.parse(execFileSync(command, args, { cwd: root, encoding: "utf8", timeout: 20000 })); }
function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
