import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {execFileSync, spawn, spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {buildOracleRelease, recordOracleReleaseEvidence} from "../package/oracle-release.mjs";
import {readDeterministicTarGz, sha256} from "../lib/sdk-release.mjs";
import {verifyOracleRelease} from "./oracle-release-verify.mjs";

const root = process.cwd();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-oracle-release-check-"));

try {
  const first = path.join(work, "first");
  const second = path.join(work, "second");
  buildOracleRelease({rootDir: root, outputDir: first, allowDirty: true});
  buildOracleRelease({rootDir: root, outputDir: second, allowDirty: true});
  assert.deepEqual(directoryDigests(first), directoryDigests(second), "clean-equivalent Oracle builds differ");

  const manifestPath = path.join(first, "oracle-release-manifest.json");
  const verified = verifyOracleRelease({manifestPath, artifactDir: first, sourceRoot: root});
  assert.equal(verified.artifactCount, 4);
  assert.equal(verified.signatureVerified, false);

  verifySignaturePath({manifestPath, artifactDir: first});
  verifyTamperFailure({sourceDir: first});
  verifyEvidenceRecording({artifactDir: first, manifest: verified.manifest});
  await verifyPlatformInstallAndColdStart({artifactDir: first, manifest: verified.manifest});
  verifyTypeScriptConsumer({artifactDir: first, manifest: verified.manifest});
  verifyGoConsumer({artifactDir: first, manifest: verified.manifest});

  process.stdout.write("oracle-release-integrity-check passed: deterministic double build, archive/target validation, SBOM/provenance, detached signature path, tamper rejection, install, cold start, and clean SDK consumers verified\n");
} finally {
  fs.rmSync(work, {recursive: true, force: true});
}

function verifySignaturePath({manifestPath, artifactDir}) {
  const manifestBytes = fs.readFileSync(manifestPath);
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  const publicKeyPath = path.join(work, "ephemeral-oracle-public.pem");
  const signaturePath = path.join(work, "ephemeral-oracle-manifest.sig");
  fs.writeFileSync(publicKeyPath, publicKey.export({type: "spki", format: "pem"}));
  fs.writeFileSync(signaturePath, crypto.sign(null, manifestBytes, privateKey));
  const result = verifyOracleRelease({manifestPath, artifactDir, sourceRoot: root, publicKeyPath, signaturePath});
  assert.equal(result.signatureVerified, true);

  const tampered = fs.readFileSync(signaturePath);
  tampered[0] ^= 0xff;
  const badSignaturePath = path.join(work, "bad-oracle-manifest.sig");
  fs.writeFileSync(badSignaturePath, tampered);
  assert.throws(
    () => verifyOracleRelease({manifestPath, artifactDir, publicKeyPath, signaturePath: badSignaturePath}),
    /detached signature is invalid/,
  );
}

function verifyTamperFailure({sourceDir}) {
  const target = path.join(work, "tamper");
  fs.cpSync(sourceDir, target, {recursive: true});
  const manifest = JSON.parse(fs.readFileSync(path.join(target, "oracle-release-manifest.json"), "utf8"));
  const artifact = manifest.artifacts.find((entry) => entry.id === "typescript-sdk");
  fs.appendFileSync(path.join(target, artifact.file), "tamper");
  assert.throws(
    () => verifyOracleRelease({manifestPath: path.join(target, "oracle-release-manifest.json"), artifactDir: target}),
    /byte size mismatch|digest mismatch/,
  );
}

function verifyEvidenceRecording({artifactDir, manifest}) {
  const evidenceRoot = path.join(work, "evidence-root");
  const evidenceDir = path.join(evidenceRoot, "release", "evidence");
  const recorded = recordOracleReleaseEvidence({rootDir: evidenceRoot, outputDir: artifactDir, evidenceDir, manifest});
  assert.equal(recorded.length, 3, "Oracle evidence file count mismatch");
  for (const descriptor of recorded) {
    assert.match(descriptor.path, /^release\/evidence\/oracle-artifact-(?:manifest|provenance|sbom)-[a-f0-9]{12}(?:\.cdx)?\.json$/, "Oracle evidence filename mismatch");
    const body = fs.readFileSync(path.join(evidenceRoot, descriptor.path));
    assert.equal(body.length, descriptor.bytes, "Oracle evidence byte size mismatch");
    assert.equal(sha256(body), descriptor.sha256, "Oracle evidence digest mismatch");
  }
  assert.throws(
    () => recordOracleReleaseEvidence({rootDir: evidenceRoot, outputDir: artifactDir, evidenceDir: path.join(work, "outside"), manifest}),
    /must be under release\/evidence/,
  );
}

async function verifyPlatformInstallAndColdStart({artifactDir, manifest}) {
  if (process.platform !== "darwin" || process.arch !== "arm64") return;
  const artifact = manifest.artifacts.find((entry) => entry.id === "platform-darwin-arm64");
  const extracted = path.join(work, "platform-extracted");
  extractArtifact({artifactDir, artifact, target: extracted});
  const prefix = path.join(work, "platform-installed");
  execFileSync("sh", ["INSTALL.sh"], {cwd: extracted, env: {...process.env, PREFIX: prefix}, stdio: "pipe"});
  const server = path.join(prefix, "bin/ynx-oracled");
  const cli = path.join(prefix, "bin/ynx-oracle-cli");
  assert.equal(fs.statSync(server).mode & 0o777, 0o755, "installed Oracle server mode mismatch");
  assert.equal(fs.statSync(cli).mode & 0o777, 0o755, "installed Oracle CLI mode mismatch");

  const stateDir = path.join(work, "cold-start-state");
  fs.mkdirSync(stateDir, {recursive: true});
  const providers = path.join(extracted, "config/provider-candidates.json");
  const state = path.join(stateDir, "state.json");
  const runtimeEnvironment = {...process.env, YNX_ORACLE_STATE_HMAC_KEY_HEX: "11".repeat(32)};
  execFileSync(server, ["--providers", providers, "--state", state, "--check-config"], {
    env: runtimeEnvironment,
    stdio: "pipe",
  });
  await verifyServerColdStart({server, providers, state, environment: runtimeEnvironment, expectedCommit: manifest.source.gitCommit});

  const rejected = spawnSync(cli, [
    "--url", "http://192.0.2.1",
    "--market", "YNXT/YUSD_TEST",
  ], {encoding: "utf8"});
  assert.equal(rejected.status, 1, "Oracle CLI accepted forbidden remote plain HTTP");
  assert.match(rejected.stderr, /plain HTTP is restricted to loopback/, "Oracle CLI fail-closed diagnostic missing");
}

async function verifyServerColdStart({server, providers, state, environment, expectedCommit}) {
  const port = await reserveLoopbackPort();
  const child = spawn(server, [
    "--listen", `127.0.0.1:${port}`,
    "--metrics-listen", "",
    "--providers", providers,
    "--state", state,
  ], {env: environment, stdio: ["ignore", "pipe", "pipe"]});
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({code, signal})));
  let version;
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/version`, {signal: AbortSignal.timeout(500)});
        if (response.status === 200) {
          version = await response.json();
          break;
        }
      } catch {
        // The process may still be binding its loopback listener.
      }
      await delay(50);
    }
    assert(version, `Oracle server did not cold start; stdout=${stdout.slice(-2000)} stderr=${stderr.slice(-2000)}`);
    assert.equal(version.productId, "ynx-oracle-market-data", "cold-start product ID mismatch");
    assert.equal(version.schema, "ynx.oracle.v1", "cold-start schema mismatch");
    assert.equal(version.commit, expectedCommit, "cold-start source commit mismatch");
    assert.equal(version.storageStatus, "ready", "cold-start storage status mismatch");
    assert.equal(version.degraded, true, "limited-source cold start must remain degraded");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  let exit = await Promise.race([exited, delay(5000).then(() => null)]);
  if (!exit) {
    child.kill("SIGKILL");
    exit = await exited;
  }
  assert.equal(exit.code, 0, `Oracle server did not shut down cleanly; signal=${exit.signal} stdout=${stdout.slice(-2000)} stderr=${stderr.slice(-2000)}`);
}

async function reserveLoopbackPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  assert(address && typeof address === "object", "failed to reserve loopback port");
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function verifyTypeScriptConsumer({artifactDir, manifest}) {
  const artifact = manifest.artifacts.find((entry) => entry.id === "typescript-sdk");
  const consumer = path.join(work, "typescript-consumer");
  fs.mkdirSync(consumer, {recursive: true});
  execFileSync("npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--offline",
    "--cache", path.join(work, "npm-cache"), path.join(artifactDir, artifact.file),
  ], {cwd: consumer, stdio: "pipe"});
  const testBody = `
import assert from "node:assert/strict";
import {OracleClient, SCHEMA_VERSION} from "@ynx/oracle-client";
assert.equal(SCHEMA_VERSION, "ynx.oracle.v1");
assert.throws(() => new OracleClient("http://192.0.2.1"), /plain HTTP is restricted to loopback/);
const local = new OracleClient("http://127.0.0.1:6470");
assert(local);
`;
  const testPath = path.join(consumer, "consumer.mjs");
  fs.writeFileSync(testPath, testBody);
  execFileSync("node", [testPath], {cwd: consumer, stdio: "pipe"});
}

function verifyGoConsumer({artifactDir, manifest}) {
  const artifact = manifest.artifacts.find((entry) => entry.id === "go-sdk");
  const extracted = path.join(work, "go-sdk-extracted");
  extractArtifact({artifactDir, artifact, target: extracted});
  const moduleRoot = path.join(extracted, "ynx-oracle-client-go");
  const testBody = `package oracleclient\n\nimport \"testing\"\n\nfunc TestArtifactConstants(t *testing.T) {\n\tif SchemaVersion != \"ynx.oracle.v1\" { t.Fatalf(\"schema=%s\", SchemaVersion) }\n\tif _, err := New(\"http://192.0.2.1\", nil); err == nil { t.Fatal(\"remote plain HTTP accepted\") }\n}\n`;
  fs.writeFileSync(path.join(moduleRoot, "artifact_test.go"), testBody);
  execFileSync("go", ["test", "./..."], {cwd: moduleRoot, env: {...process.env, GOWORK: "off"}, stdio: "pipe"});
}

function extractArtifact({artifactDir, artifact, target}) {
  fs.mkdirSync(target, {recursive: true});
  const modes = new Map(artifact.archiveFiles.map((entry) => [entry.path, Number.parseInt(entry.installMode, 8)]));
  const maxOutputLength = artifact.archiveFiles.reduce(
    (total, entry) => total + 512 + Math.ceil(entry.bytes / 512) * 512,
    1024,
  );
  const entries = readDeterministicTarGz(fs.readFileSync(path.join(artifactDir, artifact.file)), {maxOutputLength});
  for (const entry of entries) {
    const destination = path.join(target, entry.path);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, entry.data, {mode: modes.get(entry.path) ?? 0o644});
    fs.chmodSync(destination, modes.get(entry.path) ?? 0o644);
  }
}

function directoryDigests(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((file) => {
    const body = fs.readFileSync(path.join(directory, file));
    return [file, {bytes: body.length, sha256: sha256(body)}];
  }));
}
