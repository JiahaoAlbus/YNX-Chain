import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {execFileSync} from "node:child_process";
import {buildSDKRelease} from "../package/sdk-release.mjs";
import {canonicalJSON, createDeterministicTarGz, sha256} from "../lib/sdk-release.mjs";
import {verifySDKRelease} from "./sdk-release-verify.mjs";

const root = process.cwd();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-sdk-release-check-"));

try {
  const first = path.join(work, "first");
  const second = path.join(work, "second");
  buildSDKRelease({rootDir: root, outputDir: first});
  buildSDKRelease({rootDir: root, outputDir: second});
  assert.deepEqual(directoryDigests(first), directoryDigests(second), "clean SDK builds differ");
  const manifestPath = path.join(first, "sdk-release-manifest.json");
  const manifestBytes = fs.readFileSync(manifestPath);
  const verified = verifySDKRelease({manifestPath, artifactDir: first, sourceRoot: root});
  assert.equal(verified.signatureVerified, false);

  verifySignaturePath({manifestPath, manifestBytes, artifactDir: first});
  verifyTamperFailures({sourceDir: first});
  verifyCleanJavaScriptConsumer({artifactDir: first});
  verifyCleanPythonConsumer({artifactDir: first});
  process.stdout.write("sdk-release-integrity-check passed: deterministic artifacts, canonical manifest, tamper/signature boundaries, and clean consumers verified\n");
} finally {
  fs.rmSync(work, {recursive: true, force: true});
}

function verifySignaturePath({manifestPath, manifestBytes, artifactDir}) {
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  const publicKeyPath = path.join(work, "ephemeral-test-public.pem");
  const signaturePath = path.join(work, "ephemeral-test-manifest.sig");
  fs.writeFileSync(publicKeyPath, publicKey.export({type: "spki", format: "pem"}));
  const signature = crypto.sign(null, manifestBytes, privateKey);
  fs.writeFileSync(signaturePath, signature);
  assert.equal(verifySDKRelease({manifestPath, artifactDir, sourceRoot: root, publicKeyPath, signaturePath}).signatureVerified, true);
  const badSignaturePath = path.join(work, "bad.sig");
  signature[0] ^= 0xff;
  fs.writeFileSync(badSignaturePath, signature);
  expectFailure(
    () => verifySDKRelease({manifestPath, artifactDir, sourceRoot: root, publicKeyPath, signaturePath: badSignaturePath}),
    /detached signature is invalid/,
  );
}

function verifyTamperFailures({sourceDir}) {
  const artifactCase = copyCase(sourceDir, "artifact-tamper");
  const artifactManifest = readManifest(artifactCase);
  const jsArtifact = artifactManifest.packages.find((entry) => entry.id === "javascript").artifact.file;
  fs.appendFileSync(path.join(artifactCase, jsArtifact), "tamper");
  expectCaseFailure(artifactCase, /artifact digest mismatch/);

  const metadataCase = copyCase(sourceDir, "metadata-tamper");
  const metadataManifest = readManifest(metadataCase);
  metadataManifest.chain.nativeCurrency = "FAKE";
  writeManifest(metadataCase, metadataManifest);
  expectCaseFailure(metadataCase, /chain metadata mismatch/);

  const vectorCase = copyCase(sourceDir, "vector-binding-tamper");
  const vectorManifest = readManifest(vectorCase);
  vectorManifest.source.addressVectors.sha256 = "0".repeat(64);
  writeManifest(vectorCase, vectorManifest);
  expectCaseFailure(vectorCase, /address vectors digest mismatch/);

  const extraCase = copyCase(sourceDir, "unexpected-file");
  replaceJavaScriptArtifact(extraCase, (entries) => [...entries, {path: "package/unexpected.js", data: "export default false;\n"}]);
  expectCaseFailure(extraCase, /archive entries differ/);

  const traversalCase = copyCase(sourceDir, "path-traversal");
  mutateJavaScriptTar(traversalCase, (tar) => {
    tar.fill(0, 0, 100);
    tar.write("../escape.js", 0, "utf8");
    refreshTarChecksum(tar.subarray(0, 512));
  });
  expectCaseFailure(traversalCase, /unsafe archive path/);

  const symlinkCase = copyCase(sourceDir, "symlink-entry");
  mutateJavaScriptTar(symlinkCase, (tar) => {
    tar[156] = "2".charCodeAt(0);
    refreshTarChecksum(tar.subarray(0, 512));
  });
  expectCaseFailure(symlinkCase, /not a regular file/);
}

function verifyCleanJavaScriptConsumer({artifactDir}) {
  const consumer = path.join(work, "js-consumer");
  fs.mkdirSync(consumer);
  const manifest = readManifest(artifactDir);
  const artifact = path.join(artifactDir, manifest.packages.find((entry) => entry.id === "javascript").artifact.file);
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--offline", "--cache", path.join(work, "npm-cache"), artifact], {cwd: consumer, stdio: "pipe"});
  const vectors = fs.readFileSync(path.join(root, "testdata/address-vectors.json"), "utf8").trim();
  const testBody = `
import assert from "node:assert/strict";
import {YNXSDKError, getYNXStatus, toEVMAddress, toYNXAddress, ynxTestnet} from "@ynx-chain/sdk";
const vectors = ${vectors};
assert.equal(ynxTestnet.chainId, "0x1917");
assert.equal(ynxTestnet.chainIdDecimal, 6423);
assert.equal(ynxTestnet.nativeCurrency.symbol, "YNXT");
for (const vector of vectors) {
  assert.equal(toYNXAddress(vector.hex), vector.bech32);
  assert.equal(toEVMAddress(vector.bech32), vector.hex);
}
const failureFetch = async () => ({ok: false, status: 429, statusText: "quota", text: async () => JSON.stringify({message: "quota"})});
await assert.rejects(getYNXStatus("https://consumer.invalid", {fetchImpl: failureFetch}), (error) => error instanceof YNXSDKError && error.status === 429);
const timeoutFetch = (_url, {signal}) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  reject(error);
}, {once: true}));
await assert.rejects(getYNXStatus("https://consumer.invalid", {fetchImpl: timeoutFetch, timeoutMs: 5}), /timed out/);
`;
  const testPath = path.join(consumer, "consumer.mjs");
  fs.writeFileSync(testPath, testBody);
  execFileSync("node", [testPath], {cwd: consumer, stdio: "pipe"});
}

function verifyCleanPythonConsumer({artifactDir}) {
  const consumer = path.join(work, "python-consumer");
  const venv = path.join(consumer, "venv");
  fs.mkdirSync(consumer);
  execFileSync(process.env.PYTHON || "python3", ["-m", "venv", venv], {stdio: "pipe"});
  const python = path.join(venv, "bin", "python");
  const manifest = readManifest(artifactDir);
  const artifact = path.join(artifactDir, manifest.packages.find((entry) => entry.id === "python").artifact.file);
  execFileSync(python, ["-m", "pip", "install", "--disable-pip-version-check", "--no-deps", "--no-index", artifact], {cwd: consumer, stdio: "pipe"});
  const vectors = fs.readFileSync(path.join(root, "testdata/address-vectors.json"), "utf8").trim();
  const testBody = `
import io
import json
import urllib.error
from unittest import mock
from ynx_client import YNXSDKError, YNX_TESTNET, get_status, to_evm_address, to_ynx_address

vectors = json.loads(${JSON.stringify(vectors)})
assert YNX_TESTNET["chainId"] == "0x1917"
assert YNX_TESTNET["chainIdDecimal"] == 6423
assert YNX_TESTNET["nativeCurrency"]["symbol"] == "YNXT"
for vector in vectors:
    assert to_ynx_address(vector["hex"]) == vector["bech32"]
    assert to_evm_address(vector["bech32"]) == vector["hex"]

http_error = urllib.error.HTTPError("https://consumer.invalid", 429, "quota", {}, io.BytesIO(b'{"message":"quota"}'))
with mock.patch("urllib.request.urlopen", side_effect=http_error):
    try:
        get_status("https://consumer.invalid")
        raise AssertionError("HTTP failure was accepted")
    except YNXSDKError as error:
        assert error.status == 429

with mock.patch("urllib.request.urlopen", side_effect=TimeoutError("timed out")):
    try:
        get_status("https://consumer.invalid", timeout=0.01)
        raise AssertionError("timeout was accepted")
    except YNXSDKError as error:
        assert "request failed" in str(error)
`;
  const testPath = path.join(consumer, "consumer.py");
  fs.writeFileSync(testPath, testBody);
  execFileSync(python, ["-I", testPath], {cwd: consumer, stdio: "pipe"});
}

function directoryDigests(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((file) => [file, sha256(fs.readFileSync(path.join(directory, file)))]));
}

function copyCase(sourceDir, name) {
  const target = path.join(work, name);
  fs.cpSync(sourceDir, target, {recursive: true});
  return target;
}

function readManifest(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, "sdk-release-manifest.json"), "utf8"));
}

function writeManifest(directory, manifest) {
  fs.writeFileSync(path.join(directory, "sdk-release-manifest.json"), canonicalJSON(manifest));
}

function expectCaseFailure(directory, pattern) {
  expectFailure(() => verifySDKRelease({manifestPath: path.join(directory, "sdk-release-manifest.json"), artifactDir: directory, sourceRoot: root}), pattern);
}

function replaceJavaScriptArtifact(directory, transform) {
  const manifest = readManifest(directory);
  const packageEntry = manifest.packages.find((entry) => entry.id === "javascript");
  const entries = packageEntry.archiveFiles.map((file) => ({path: file.archivePath, data: fs.readFileSync(path.join(root, file.sourcePath))}));
  const artifact = createDeterministicTarGz(transform(entries));
  writeArtifactAndManifest(directory, manifest, packageEntry, artifact);
}

function mutateJavaScriptTar(directory, mutate) {
  const manifest = readManifest(directory);
  const packageEntry = manifest.packages.find((entry) => entry.id === "javascript");
  const artifactPath = path.join(directory, packageEntry.artifact.file);
  const tar = zlib.gunzipSync(fs.readFileSync(artifactPath));
  mutate(tar);
  const artifact = zlib.gzipSync(tar, {level: 9, mtime: 0, strategy: zlib.constants.Z_FIXED});
  artifact[9] = 255;
  writeArtifactAndManifest(directory, manifest, packageEntry, artifact);
}

function writeArtifactAndManifest(directory, manifest, packageEntry, artifact) {
  fs.writeFileSync(path.join(directory, packageEntry.artifact.file), artifact);
  packageEntry.artifact.bytes = artifact.length;
  packageEntry.artifact.sha256 = sha256(artifact);
  writeManifest(directory, manifest);
}

function refreshTarChecksum(header) {
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0");
  header.write(checksum, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
}

function expectFailure(operation, pattern) {
  assert.throws(operation, pattern);
}
