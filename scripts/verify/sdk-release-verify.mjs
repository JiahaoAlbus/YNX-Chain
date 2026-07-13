import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  SDK_CHAIN,
  SDK_RELEASE_SCHEMA,
  SDK_RELEASE_STATUS,
  canonicalJSON,
  readDeterministicTarGz,
  readDeterministicZip,
  readPythonProjectMetadata,
  sha256,
} from "../lib/sdk-release.mjs";

const TOP_LEVEL_KEYS = ["chain", "packages", "schema", "signature", "source", "status"];

export function verifySDKRelease({manifestPath, artifactDir, sourceRoot, publicKeyPath, signaturePath}) {
  if (fs.statSync(manifestPath).size > 1024 * 1024) throw new Error("SDK manifest exceeds the verification size limit");
  const manifestBytes = fs.readFileSync(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes);
  } catch (error) {
    throw new Error(`SDK manifest is not valid JSON: ${error.message}`);
  }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") throw new Error("SDK manifest must be an object");
  if (!manifestBytes.equals(Buffer.from(canonicalJSON(manifest)))) throw new Error("SDK manifest is not canonical JSON");
  assertExactKeys(manifest, TOP_LEVEL_KEYS, "manifest");
  if (manifest.schema !== SDK_RELEASE_SCHEMA) throw new Error("SDK manifest schema is unsupported");
  if (manifest.status !== SDK_RELEASE_STATUS) throw new Error("SDK manifest status must remain local and unpublished");
  if (canonicalJSON(manifest.chain) !== canonicalJSON(SDK_CHAIN)) throw new Error("SDK manifest chain metadata mismatch");
  validateSignaturePolicy(manifest.signature);
  validateSource(manifest.source, sourceRoot);
  validatePackages(manifest.packages, artifactDir, sourceRoot);
  const signatureVerified = verifyDetachedSignature({manifestBytes, publicKeyPath, signaturePath});
  return {manifest, signatureVerified};
}

function validateSource(source, sourceRoot) {
  assertExactKeys(source, ["addressVectors", "gitCommit"], "source");
  if (!/^[0-9a-f]{40}$/.test(source.gitCommit)) throw new Error("SDK source commit is not a full Git hash");
  assertExactKeys(source.addressVectors, ["bytes", "path", "sha256"], "addressVectors");
  if (source.addressVectors.path !== "testdata/address-vectors.json") throw new Error("SDK address vector path mismatch");
  validateDigestRecord(source.addressVectors, "address vectors");
  if (sourceRoot) {
    const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: sourceRoot, encoding: "utf8"}).trim();
    if (currentCommit !== source.gitCommit) throw new Error("SDK source commit differs from the verification checkout");
    const body = fs.readFileSync(path.join(sourceRoot, source.addressVectors.path));
    matchBody(body, source.addressVectors, "address vectors");
  }
}

function validatePackages(packages, artifactDir, sourceRoot) {
  if (!Array.isArray(packages) || packages.length !== 2) throw new Error("SDK manifest must contain exactly two packages");
  const byID = new Map(packages.map((entry) => [entry.id, entry]));
  if (byID.size !== packages.length || !byID.has("javascript") || !byID.has("python")) {
    throw new Error("SDK manifest package IDs must be unique JavaScript and Python entries");
  }
  validatePackage(byID.get("javascript"), {
    archiveRoot: "package",
    name: "@ynx-chain/sdk",
    registry: "npm",
    sourcePaths: ["sdk/js/index.js", "sdk/js/package.json"],
  }, artifactDir, sourceRoot);
  validatePackage(byID.get("python"), {
    archiveRoot: "",
    name: "ynx-chain-sdk",
    registry: "pypi",
    sourcePaths: ["sdk/python/README.md", "sdk/python/pyproject.toml", "sdk/python/ynx_client.py"],
  }, artifactDir, sourceRoot);
  if (byID.get("javascript").version !== byID.get("python").version) throw new Error("SDK package versions differ");
  if (!/^\d+\.\d+\.\d+$/.test(byID.get("javascript").version)) throw new Error("SDK package version is not semantic x.y.z");
  if (sourceRoot) validatePackageMetadata(byID, sourceRoot);
}

function validatePackage(entry, expected, artifactDir, sourceRoot) {
  assertExactKeys(entry, ["archiveFiles", "archiveRoot", "artifact", "buildCommand", "id", "name", "registry", "registryPublished", "sourceFiles", "version"], `${entry.id} package`);
  if (entry.archiveRoot !== expected.archiveRoot || entry.name !== expected.name || entry.registry !== expected.registry) {
    throw new Error(`${entry.id} package metadata mismatch`);
  }
  if (entry.registryPublished !== false) throw new Error(`${entry.id} package must not claim registry publication`);
  if (entry.buildCommand !== "node scripts/package/sdk-release.mjs --output <directory>") throw new Error(`${entry.id} build command mismatch`);
  assertExactKeys(entry.artifact, ["bytes", "file", "sha256"], `${entry.id} artifact`);
  validateDigestRecord(entry.artifact, `${entry.id} artifact`);
  if (path.basename(entry.artifact.file) !== entry.artifact.file) throw new Error(`${entry.id} artifact filename is unsafe`);
  const expectedArtifact = entry.id === "javascript"
    ? `ynx-chain-sdk-js-${entry.version}.tgz`
    : `ynx_chain_sdk-${entry.version}-py3-none-any.whl`;
  if (entry.artifact.file !== expectedArtifact) throw new Error(`${entry.id} artifact filename mismatch`);
  const artifact = fs.readFileSync(path.join(artifactDir, entry.artifact.file));
  matchBody(artifact, entry.artifact, `${entry.id} artifact`);

  if (!Array.isArray(entry.sourceFiles) || entry.sourceFiles.length !== expected.sourcePaths.length) throw new Error(`${entry.id} package source file count mismatch`);
  const filesBySource = new Map(entry.sourceFiles.map((file) => [file.sourcePath, file]));
  if (filesBySource.size !== entry.sourceFiles.length || expected.sourcePaths.some((file) => !filesBySource.has(file))) {
    throw new Error(`${entry.id} package source file set mismatch`);
  }
  for (const sourcePath of expected.sourcePaths) {
    const file = filesBySource.get(sourcePath);
    assertExactKeys(file, ["bytes", "sha256", "sourcePath"], `${entry.id} source file`);
    validateDigestRecord(file, `${entry.id} file ${sourcePath}`);
    if (sourceRoot) matchBody(fs.readFileSync(path.join(sourceRoot, sourcePath)), file, `${entry.id} source ${sourcePath}`);
  }
  if (!Array.isArray(entry.archiveFiles) || entry.archiveFiles.length === 0) throw new Error(`${entry.id} archive file list is empty`);
  for (const file of entry.archiveFiles) {
    assertExactKeys(file, ["archivePath", "bytes", "sha256", "sourcePath"], `${entry.id} archive file`);
    validateDigestRecord(file, `${entry.id} archive file ${file.archivePath}`);
    if (file.sourcePath !== null && !filesBySource.has(file.sourcePath)) throw new Error(`${entry.id} archive source path is not bound`);
    if (file.sourcePath !== null) {
      const source = filesBySource.get(file.sourcePath);
      if (source.bytes !== file.bytes || source.sha256 !== file.sha256) throw new Error(`${entry.id} source/archive digest mismatch`);
    }
  }
  validateExpectedArchiveFiles(entry);
  const archiveEntries = entry.id === "python" ? readDeterministicZip(artifact) : readDeterministicTarGz(artifact);
  const archivedByPath = new Map(archiveEntries.map((item) => [item.path, item.data]));
  if (archivedByPath.size !== entry.archiveFiles.length || entry.archiveFiles.some((file) => !archivedByPath.has(file.archivePath))) {
    throw new Error(`${entry.id} archive entries differ from the bounded manifest`);
  }
  for (const file of entry.archiveFiles) matchBody(archivedByPath.get(file.archivePath), file, `${entry.id} archived ${file.archivePath}`);
}

function validateExpectedArchiveFiles(entry) {
  const actual = entry.archiveFiles.map((file) => file.archivePath).sort();
  let expected;
  if (entry.id === "javascript") {
    expected = ["package/index.js", "package/package.json"];
  } else {
    const distInfo = `ynx_chain_sdk-${entry.version}.dist-info`;
    expected = [`${distInfo}/METADATA`, `${distInfo}/RECORD`, `${distInfo}/WHEEL`, `${distInfo}/top_level.txt`, "ynx_client.py"].sort();
  }
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${entry.id} archive file set mismatch`);
  }
}

function validatePackageMetadata(byID, sourceRoot) {
  const js = JSON.parse(fs.readFileSync(path.join(sourceRoot, "sdk/js/package.json"), "utf8"));
  const python = readPythonProjectMetadata(fs.readFileSync(path.join(sourceRoot, "sdk/python/pyproject.toml"), "utf8"));
  if (js.name !== byID.get("javascript").name || js.version !== byID.get("javascript").version) {
    throw new Error("JavaScript package definition differs from SDK manifest");
  }
  if (python.name !== byID.get("python").name || python.version !== byID.get("python").version) {
    throw new Error("Python package definition differs from SDK manifest");
  }
}

function validateSignaturePolicy(policy) {
  assertExactKeys(policy, ["algorithm", "ownerKeyGeneratedByTool", "requiredForPublication", "scope"], "signature policy");
  if (policy.algorithm !== "Ed25519" || policy.ownerKeyGeneratedByTool !== false || policy.requiredForPublication !== true || policy.scope !== "exact canonical manifest bytes") {
    throw new Error("SDK detached-signature policy mismatch");
  }
}

function verifyDetachedSignature({manifestBytes, publicKeyPath, signaturePath}) {
  if (Boolean(publicKeyPath) !== Boolean(signaturePath)) throw new Error("public key and detached signature must be supplied together");
  if (!publicKeyPath) return false;
  const publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath));
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("SDK manifest public key must be Ed25519");
  const signature = fs.readFileSync(signaturePath);
  if (signature.length !== 64 || !crypto.verify(null, manifestBytes, publicKey, signature)) {
    throw new Error("SDK manifest detached signature is invalid");
  }
  return true;
}

function validateDigestRecord(record, name) {
  if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > 16 * 1024 * 1024) throw new Error(`${name} byte count is invalid`);
  if (!/^[0-9a-f]{64}$/.test(record.sha256)) throw new Error(`${name} SHA-256 is invalid`);
}

function matchBody(body, record, name) {
  if (!Buffer.isBuffer(body)) throw new Error(`${name} is missing`);
  if (body.length !== record.bytes || sha256(body) !== record.sha256) throw new Error(`${name} digest mismatch`);
}

function assertExactKeys(value, keys, name) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${name} fields mismatch: expected ${expected.join(",")}`);
  }
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error("SDK verifier arguments require values");
    if (key === "--manifest") result.manifestPath = value;
    else if (key === "--artifacts") result.artifactDir = value;
    else if (key === "--source-root") result.sourceRoot = value;
    else if (key === "--public-key") result.publicKeyPath = value;
    else if (key === "--signature") result.signaturePath = value;
    else throw new Error(`unknown SDK verifier argument: ${key}`);
  }
  if (!result.manifestPath || !result.artifactDir) throw new Error("usage: sdk-release-verify.mjs --manifest <file> --artifacts <dir> [--source-root <dir>] [--public-key <pem> --signature <file>]");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifySDKRelease(parseArguments(process.argv.slice(2)));
  process.stdout.write(`SDK release verified: packages=2 signature=${result.signatureVerified ? "verified" : "not-supplied"} registryPublished=false\n`);
}
