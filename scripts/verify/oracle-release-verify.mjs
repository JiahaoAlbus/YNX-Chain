import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  canonicalJSON,
  readDeterministicTarGz,
  sha256,
} from "../lib/sdk-release.mjs";
import {
  ORACLE_PROVENANCE_SCHEMA,
  ORACLE_RELEASE_SCHEMA,
  ORACLE_RELEASE_STATUS,
} from "../package/oracle-release.mjs";

const REQUIRED_ARTIFACT_IDS = Object.freeze([
  "go-sdk",
  "platform-darwin-arm64",
  "platform-linux-arm64",
  "typescript-sdk",
]);
const MAX_ORACLE_ARCHIVE_OUTPUT_BYTES = 128 * 1024 * 1024;
const MAX_ORACLE_ARCHIVE_FILES = 64;

export function verifyOracleRelease({manifestPath, artifactDir, sourceRoot, expectedCommit = "", publicKeyPath = "", signaturePath = ""}) {
  const manifestFile = path.resolve(manifestPath);
  const directory = path.resolve(artifactDir ?? path.dirname(manifestFile));
  const manifestBytes = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifestBytes.toString("utf8"), canonicalJSON(manifest), "Oracle manifest is not canonical JSON");
  assert.equal(manifest.schema, ORACLE_RELEASE_SCHEMA, "Oracle release schema mismatch");
  assert.equal(manifest.productId, "ynx-oracle-market-data", "Oracle product ID mismatch");
  assert.equal(manifest.status, ORACLE_RELEASE_STATUS, "Oracle release status mismatch");
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Oracle version is invalid");
  assert.match(manifest.buildTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "Oracle build time must use UTC seconds");
  assert.equal(manifest.source?.gitCommit?.length, 40, "Oracle source commit is missing");
  assert.equal(typeof manifest.source?.clean, "boolean", "Oracle source clean state is missing");
  if (expectedCommit) assert.equal(manifest.source.gitCommit, expectedCommit, "Oracle source commit mismatch");
  assert.deepEqual(manifest.publication, {
    downloadHosted: false,
    productionSigned: false,
    registryPublished: false,
    released: false,
    storeReleased: false,
  }, "local Oracle manifest claims unsupported publication state");
  assert.deepEqual(manifest.signing, {
    algorithm: "Ed25519",
    detachedManifestSignatureRequiredForPublication: true,
    ownerKeyGeneratedByTool: false,
    signingClass: "unsigned-local-candidate",
  }, "Oracle signing boundary mismatch");

  assert(Array.isArray(manifest.artifacts), "Oracle artifacts must be an array");
  const ids = manifest.artifacts.map((artifact) => artifact.id).sort();
  assert.deepEqual(ids, REQUIRED_ARTIFACT_IDS, "Oracle artifact set mismatch");
  const expectedFiles = new Set([
    "oracle-release-manifest.json",
    manifest.provenance.file,
    manifest.sbom.file,
    ...manifest.artifacts.map((artifact) => artifact.file),
  ]);
  assert.deepEqual(fs.readdirSync(directory).sort(), [...expectedFiles].sort(), "Oracle output contains missing or unexpected files");

  const verifiedArtifacts = [];
  for (const artifact of manifest.artifacts) {
    validateArtifactDescriptor(artifact);
    const artifactPath = path.join(directory, artifact.file);
    const body = fs.readFileSync(artifactPath);
    assert.equal(body.length, artifact.bytes, `${artifact.id} byte size mismatch`);
    assert.equal(sha256(body), artifact.sha256, `${artifact.id} digest mismatch`);
    const expectedTarBytes = expectedTarOutputBytes(artifact.archiveFiles);
    const entries = readDeterministicTarGz(body, {maxOutputLength: expectedTarBytes});
    const archiveByPath = new Map(artifact.archiveFiles.map((entry) => [entry.path, entry]));
    assert.deepEqual(entries.map((entry) => entry.path).sort(), [...archiveByPath.keys()].sort(), `${artifact.id} archive entries differ`);
    for (const entry of entries) {
      const expected = archiveByPath.get(entry.path);
      assert(expected, `${artifact.id} contains unexpected archive entry ${entry.path}`);
      assert.equal(expected.archiveMode, "0644", `${artifact.id} archive mode declaration mismatch`);
      assert.match(expected.installMode, /^0(?:644|755)$/, `${artifact.id} install mode is invalid`);
      assert.equal(entry.data.length, expected.bytes, `${artifact.id}:${entry.path} byte size mismatch`);
      assert.equal(sha256(entry.data), expected.sha256, `${artifact.id}:${entry.path} digest mismatch`);
    }
    verifyArtifactContents(artifact, entries, manifest.version);
    verifiedArtifacts.push({file: artifact.file, id: artifact.id, sha256: artifact.sha256});
  }

  const sbom = verifyJSONDescriptor(directory, manifest.sbom, "CycloneDX SBOM");
  assert.equal(sbom.bomFormat, "CycloneDX", "Oracle SBOM format mismatch");
  assert.equal(sbom.specVersion, "1.6", "Oracle SBOM version mismatch");
  assert(Array.isArray(sbom.components) && sbom.components.length >= manifest.artifacts.length + 1, "Oracle SBOM components are incomplete");
  for (const artifact of manifest.artifacts) {
    const component = sbom.components.find((entry) => entry.name === artifact.file);
    assert(component, `Oracle SBOM missing ${artifact.file}`);
    assert.equal(component.hashes?.[0]?.alg, "SHA-256", `Oracle SBOM hash algorithm missing for ${artifact.file}`);
    assert.equal(component.hashes?.[0]?.content, artifact.sha256, `Oracle SBOM digest mismatch for ${artifact.file}`);
  }

  const provenance = verifyJSONDescriptor(directory, manifest.provenance, "Oracle provenance");
  assert.equal(provenance.schema, ORACLE_PROVENANCE_SCHEMA, "Oracle provenance schema mismatch");
  assert.equal(provenance.status, ORACLE_RELEASE_STATUS, "Oracle provenance status mismatch");
  assert.deepEqual(provenance.source, manifest.source, "Oracle manifest/provenance source mismatch");
  assert.deepEqual(provenance.signing, manifest.signing, "Oracle manifest/provenance signing mismatch");
  assert.equal(provenance.build?.deterministicArchive, true, "Oracle provenance does not require deterministic archives");
  assert.equal(provenance.build?.networkRequired, false, "Oracle provenance unexpectedly requires network access");
  assert.deepEqual(
    provenance.artifacts.map((artifact) => ({file: artifact.file, id: artifact.id, sha256: artifact.sha256})).sort(compareID),
    verifiedArtifacts.sort(compareID),
    "Oracle provenance artifact subjects mismatch",
  );

  if (sourceRoot) verifySourceBindings({manifest, sourceRoot: path.resolve(sourceRoot)});
  const signatureVerified = verifyOptionalSignature({manifestBytes, publicKeyPath, signaturePath});
  return {artifactCount: manifest.artifacts.length, manifest, signatureVerified};
}

function validateArtifactDescriptor(artifact) {
  assert.match(artifact.id, /^[a-z0-9-]+$/, "Oracle artifact ID is invalid");
  assert.match(artifact.file, /^[A-Za-z0-9._-]+$/, `${artifact.id} filename is invalid`);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/, `${artifact.id} checksum is invalid`);
  assert(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0, `${artifact.id} byte size is invalid`);
  assert.equal(artifact.hosted, false, `${artifact.id} falsely claims hosted status`);
  assert.equal(artifact.productionSigned, false, `${artifact.id} falsely claims production signing`);
  assert.equal(artifact.coldStartTested, false, `${artifact.id} build manifest must not claim post-build cold-start evidence`);
  assert(Array.isArray(artifact.archiveFiles) && artifact.archiveFiles.length > 0, `${artifact.id} archive file inventory missing`);
  assert(artifact.archiveFiles.length <= MAX_ORACLE_ARCHIVE_FILES, `${artifact.id} archive file inventory is too large`);
  for (const entry of artifact.archiveFiles) {
    assert.match(entry.path, /^[A-Za-z0-9._/-]+$/, `${artifact.id} archive path is invalid`);
    assert(!entry.path.startsWith("/") && !entry.path.split("/").includes(".."), `${artifact.id} archive path is unsafe`);
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0, `${artifact.id}:${entry.path} byte size is invalid`);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, `${artifact.id}:${entry.path} checksum is invalid`);
    assert.equal(entry.archiveMode, "0644", `${artifact.id}:${entry.path} archive mode declaration mismatch`);
    assert.match(entry.installMode, /^0(?:644|755)$/, `${artifact.id}:${entry.path} install mode is invalid`);
  }
  expectedTarOutputBytes(artifact.archiveFiles);
}

function expectedTarOutputBytes(files) {
  let total = 1024;
  for (const entry of files) {
    const paddedBytes = Math.ceil(entry.bytes / 512) * 512;
    total += 512 + paddedBytes;
    assert(Number.isSafeInteger(total) && total <= MAX_ORACLE_ARCHIVE_OUTPUT_BYTES, "Oracle archive exceeds the verification size limit");
  }
  return total;
}

function verifyArtifactContents(artifact, entries, version) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry.data]));
  if (artifact.kind === "server-cli-bundle") {
    const required = ["INSTALL.sh", "README.md", "release-info.json", "bin/ynx-oracled", "bin/ynx-oracle-cli", "config/provider-candidates.json"];
    for (const entry of required) assert(byPath.has(entry), `${artifact.id} missing ${entry}`);
    const releaseInfo = JSON.parse(byPath.get("release-info.json").toString("utf8"));
    assert.equal(releaseInfo.artifactTarget, artifact.target, `${artifact.id} release target mismatch`);
    assert.equal(releaseInfo.authoritativePrices, false, `${artifact.id} falsely claims authoritative prices`);
    assert.equal(releaseInfo.status, ORACLE_RELEASE_STATUS, `${artifact.id} release status mismatch`);
    if (artifact.target === "darwin-arm64") {
      verifyMachOArm64(byPath.get("bin/ynx-oracled"), `${artifact.id}:ynx-oracled`);
      verifyMachOArm64(byPath.get("bin/ynx-oracle-cli"), `${artifact.id}:ynx-oracle-cli`);
    } else if (artifact.target === "linux-arm64") {
      verifyELFArm64(byPath.get("bin/ynx-oracled"), `${artifact.id}:ynx-oracled`);
      verifyELFArm64(byPath.get("bin/ynx-oracle-cli"), `${artifact.id}:ynx-oracle-cli`);
    } else {
      assert.fail(`unsupported platform artifact target ${artifact.target}`);
    }
    return;
  }
  if (artifact.id === "typescript-sdk") {
    assert.deepEqual([...byPath.keys()].sort(), ["package/README.md", "package/dist/index.d.ts", "package/dist/index.js", "package/package.json"], "TypeScript package entries mismatch");
    const packageJSON = JSON.parse(byPath.get("package/package.json").toString("utf8"));
    assert.equal(packageJSON.name, "@ynx/oracle-client", "TypeScript package name mismatch");
    assert.equal(packageJSON.version, version, "TypeScript package version mismatch");
    assert.equal(packageJSON.private, undefined, "TypeScript artifact must not carry private metadata");
    assert.equal(packageJSON.engines.node, ">=20", "TypeScript minimum Node runtime mismatch");
    return;
  }
  if (artifact.id === "go-sdk") {
    assert.deepEqual([...byPath.keys()].sort(), ["ynx-oracle-client-go/README.md", "ynx-oracle-client-go/client.go", "ynx-oracle-client-go/go.mod"], "Go SDK package entries mismatch");
    assert.match(byPath.get("ynx-oracle-client-go/go.mod").toString("utf8"), /^module github\.com\/JiahaoAlbus\/YNX-Chain\/sdk\/oracle\/go$/m, "Go SDK module path mismatch");
    return;
  }
  assert.fail(`unsupported Oracle artifact kind ${artifact.kind}`);
}

function verifyMachOArm64(body, name) {
  assert(body.length > 32, `${name} is too small`);
  assert.equal(body.readUInt32LE(0), 0xfeedfacf, `${name} is not a 64-bit Mach-O binary`);
  assert.equal(body.readUInt32LE(4), 0x0100000c, `${name} is not arm64 Mach-O`);
}

function verifyELFArm64(body, name) {
  assert(body.length > 64, `${name} is too small`);
  assert.equal(body.subarray(0, 4).toString("hex"), "7f454c46", `${name} is not ELF`);
  assert.equal(body[4], 2, `${name} is not 64-bit ELF`);
  assert.equal(body[5], 1, `${name} is not little-endian ELF`);
  assert.equal(body.readUInt16LE(18), 183, `${name} is not AArch64 ELF`);
}

function verifyJSONDescriptor(directory, descriptor, name) {
  assert.match(descriptor.file, /^[A-Za-z0-9._-]+$/, `${name} filename is invalid`);
  assert.match(descriptor.sha256, /^[a-f0-9]{64}$/, `${name} checksum is invalid`);
  const body = fs.readFileSync(path.join(directory, descriptor.file));
  assert.equal(body.length, descriptor.bytes, `${name} byte size mismatch`);
  assert.equal(sha256(body), descriptor.sha256, `${name} digest mismatch`);
  const value = JSON.parse(body.toString("utf8"));
  assert.equal(body.toString("utf8"), canonicalJSON(value), `${name} is not canonical JSON`);
  return value;
}

function verifySourceBindings({manifest, sourceRoot}) {
  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: sourceRoot, encoding: "utf8"}).trim();
  assert.equal(currentCommit, manifest.source.gitCommit, "Oracle source root commit mismatch");
  const releaseRecord = JSON.parse(fs.readFileSync(path.join(sourceRoot, "release/product-release.json"), "utf8"));
  assert.equal(releaseRecord.version, manifest.version, "Oracle release record version mismatch");
  for (const source of manifest.source.files) {
    assert.match(source.path, /^[A-Za-z0-9._/-]+$/, `unsafe Oracle source path ${source.path}`);
    assert(!source.path.startsWith("/") && !source.path.split("/").includes(".."), `unsafe Oracle source path ${source.path}`);
    const body = fs.readFileSync(path.join(sourceRoot, source.path));
    assert.equal(body.length, source.bytes, `Oracle source byte mismatch: ${source.path}`);
    assert.equal(sha256(body), source.sha256, `Oracle source digest mismatch: ${source.path}`);
  }
}

function verifyOptionalSignature({manifestBytes, publicKeyPath, signaturePath}) {
  if (!publicKeyPath && !signaturePath) return false;
  if (!publicKeyPath || !signaturePath) throw new Error("both Oracle public key and detached signature are required");
  const publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath));
  const signature = fs.readFileSync(signaturePath);
  if (!crypto.verify(null, manifestBytes, publicKey, signature)) throw new Error("Oracle detached signature is invalid");
  return true;
}

function compareID(left, right) {
  return left.id.localeCompare(right.id);
}

function parseArguments(argv) {
  const result = {artifactDir: "", expectedCommit: "", manifestPath: "", publicKeyPath: "", signaturePath: "", sourceRoot: ""};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error("usage: oracle-release-verify.mjs --manifest <file> [--artifacts <dir>] [--source-root <dir>] [--expected-commit <sha>] [--public-key <file> --signature <file>]");
    if (argument === "--manifest") result.manifestPath = value;
    else if (argument === "--artifacts") result.artifactDir = value;
    else if (argument === "--source-root") result.sourceRoot = value;
    else if (argument === "--expected-commit") result.expectedCommit = value;
    else if (argument === "--public-key") result.publicKeyPath = value;
    else if (argument === "--signature") result.signaturePath = value;
    else throw new Error(`unknown argument ${argument}`);
    index += 1;
  }
  if (!result.manifestPath) throw new Error("--manifest is required");
  if (!result.artifactDir) result.artifactDir = path.dirname(result.manifestPath);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = verifyOracleRelease(options);
  process.stdout.write(`oracle-release-verify passed: ${result.manifest.version} ${result.manifest.source.gitCommit} artifacts=${result.artifactCount} signature=${result.signatureVerified}\n`);
}
