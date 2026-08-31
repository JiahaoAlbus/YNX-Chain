#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {execFileSync, spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const image = "ubuntu:24.04";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "release/wallet-cli/artifacts/manifest.json")));
const artifact = manifest.artifacts.find((item) => item.target.goos === "linux" && item.target.goarch === "arm64");
assert.ok(artifact);
const imageID = execFileSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], {encoding: "utf8", timeout: 20000}).trim();
assert.match(imageID, /^sha256:[0-9a-f]{64}$/);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-wallet-cli-linux-arm64-"));
const installBin = path.join(temporary, "bin");
const installed = path.join(installBin, "ynx-wallet-cli");
let evidence;
try {
  fs.mkdirSync(installBin, {recursive: true, mode: 0o755});
  execFileSync("go", ["build", "-trimpath", "-buildvcs=false", "-ldflags=-buildid= -X main.version=preflight", "-o", installed, "./cmd/ynx-wallet-cli"], {cwd: root, env: {...process.env, GOOS: "linux", GOARCH: "arm64", CGO_ENABLED: "0"}, timeout: 30000});
  fs.chmodSync(installed, 0o755);
  assert.equal(runJSON(installed, ["version"]).version, "preflight");

  const archive = fs.readFileSync(path.join(root, artifact.path));
  assert.equal(hash(archive), artifact.sha256);
  const binary = zlib.gunzipSync(archive);
  assert.equal(binary.length, artifact.binaryBytes);
  assert.equal(hash(binary), artifact.binarySha256);
  fs.writeFileSync(installed, binary, {mode: 0o755});
  fs.chmodSync(installed, 0o755);

  const cold = runJSON(installed, ["version"]);
  const second = runJSON(installed, ["version"]);
  assert.equal(cold.version, manifest.sourceCommit);
  assert.deepEqual(second, cold);
  const config = runJSON(installed, ["validate-config"]);
  assert.deepEqual({nativeChainId: config.nativeChainId, chainId: config.chainId, evmChainId: config.evmChainId, nativeCurrency: config.nativeCurrency}, {nativeChainId: "ynx_6423-1", chainId: 6423, evmChainId: "0x1917", nativeCurrency: "YNXT"});
  const legacy = run(installed, ["chain-status", "--chain-id", "9102"]);
  assert.equal(legacy.status, 78);
  assert.equal(legacy.stdout, "");
  const diagnostic = JSON.parse(legacy.stderr);
  assert.equal(diagnostic.error.code, "WRONG_CHAIN");
  assert.equal(diagnostic.error.remediation, "USE_YNX_TESTNET_6423");
  const kernel = docker(["uname", "-r"]);

  fs.rmSync(installed);
  assert.equal(fs.existsSync(installed), false);
  assert.deepEqual(fs.readdirSync(installBin), []);
  evidence = {
    schemaVersion: 1,
    evidenceClass: "local-container-wallet-cli-artifact",
    sourceCommit: manifest.sourceCommit,
    host: {os: os.platform(), arch: os.arch(), release: os.release()},
    container: {runtime: "docker", server: execFileSync("docker", ["info", "--format", "{{.ServerVersion}} {{.OSType}} {{.Architecture}}"], {encoding: "utf8", timeout: 20000}).trim(), image, imageID, networkMode: "none", readOnlyRoot: true, capDrop: "ALL", noNewPrivileges: true, kernel: kernel.trim()},
    artifact: {...artifact, runtimeTestedByThisEvidence: true},
    installation: {target: "linux/arm64", transientBindPrefix: true, installed: true, coldStart: true, secondStart: true, upgradeFromVersion: "preflight", upgradedToVersion: manifest.sourceCommit, uninstallVerified: true, installBinEmptyAfterUninstall: true, temporaryRootRemoved: false},
    testnet: {configValidated: true, nativeChainId: config.nativeChainId, chainId: config.chainId, evmChainId: config.evmChainId, nativeCurrency: config.nativeCurrency, remoteProbeRun: false, connected: false, legacy9102Rejected: true, legacyExitCode: legacy.status, legacyRemediation: diagnostic.error.remediation},
    signing: {signingClass: artifact.signingClass, productionSigned: false},
    releaseState: {installedLocalContainer: true, nativeHostInstalled: false, downloadHosted: false, deployedPublic: false, productionSigned: false}
  };
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
assert.equal(fs.existsSync(temporary), false);
evidence.installation.temporaryRootRemoved = true;
fs.writeFileSync(path.join(root, "release/wallet-cli/linux-arm64-local-container-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wallet CLI Linux arm64 lifecycle verified: source=${manifest.sourceCommit} image=${imageID} network=none remoteProbe=false`);

function docker(command) {
  return execFileSync("docker", ["run", "--rm", "--network", "none", "--platform", "linux/arm64", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "-v", `${temporary}:/ynx-install:ro`, image, ...command], {encoding: "utf8", timeout: 30000});
}

function run(command, args) {
  return spawnSync("docker", ["run", "--rm", "--network", "none", "--platform", "linux/arm64", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "-v", `${temporary}:/ynx-install:ro`, image, `/ynx-install/bin/${path.basename(command)}`, ...args], {encoding: "utf8", timeout: 30000});
}

function runJSON(command, args) {
  const result = run(command, args);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
