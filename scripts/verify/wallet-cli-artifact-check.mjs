import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
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
  const signing = runJSON(installed, ["sign-self-test"]);
  const chain = runJSON(installed, ["chain-status", "-timeout", "12s"]);
  assert.equal(vector.verified, true); assert.equal(signing.verified, true); assert.equal(signing.privateKeyPersisted, false);
  assert.equal(chain.connected, true); assert.equal(chain.chainId, "0x1917");
  fs.rmSync(installed);
  assert.equal(fs.existsSync(installed), false);
  const evidence = {
    schemaVersion: 1, evidenceClass: "local-wallet-cli-artifact", sourceCommit: manifest.sourceCommit,
    generatedAt: new Date().toISOString(), host: { os: os.platform(), arch: os.arch(), release: os.release() },
    artifactManifest: "release/wallet-cli/artifacts/manifest.json", artifacts: manifest.artifacts,
    installation: { target: "darwin/arm64", transientUserPrefix: true, executableMode: "0755", installed: true, coldStart: true, secondStart: true, upgradeFromVersion: "preflight", upgradedToVersion: manifest.sourceCommit, uninstallVerified: true },
    protocol: { frozenVectorVerified: vector.verified, signingSelfTestVerified: signing.verified, privateKeyPersisted: signing.privateKeyPersisted },
    testnet: chain,
    releaseState: { implementedLocal: true, testedLocal: true, installedLocal: true, integratedCentral: false, deployedStaging: false, deployedPublic: false, downloadHosted: false, productionSigned: false, storeReleased: false },
  };
  fs.writeFileSync(path.join(root, "release/wallet-cli/local-install-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wallet CLI artifacts verified: source=${manifest.sourceCommit} artifacts=6 installedLocal=true chainId=${chain.chainId} productionSigned=false`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }

function runJSON(command, args) { return JSON.parse(execFileSync(command, args, { cwd: root, encoding: "utf8", timeout: 20000 })); }
function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
