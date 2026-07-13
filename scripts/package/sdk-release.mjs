import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  SDK_CHAIN,
  SDK_RELEASE_SCHEMA,
  SDK_RELEASE_STATUS,
  canonicalJSON,
  createDeterministicTarGz,
  createDeterministicZip,
  readPythonProjectMetadata,
  sha256,
} from "../lib/sdk-release.mjs";

const JS_FILES = ["sdk/js/index.js", "sdk/js/package.json"];
const PYTHON_FILES = ["sdk/python/README.md", "sdk/python/pyproject.toml", "sdk/python/ynx_client.py"];

export function buildSDKRelease({rootDir, outputDir}) {
  const root = path.resolve(rootDir);
  const output = path.resolve(outputDir);
  if (output === root || root.startsWith(`${output}${path.sep}`)) throw new Error("SDK output directory may not contain the repository root");
  const allowedOutputs = [path.join(root, "tmp"), path.resolve(os.tmpdir())];
  if (!allowedOutputs.some((allowed) => output === allowed || output.startsWith(`${allowed}${path.sep}`))) {
    throw new Error("SDK output directory must be under repository tmp/ or the system temporary directory");
  }
  const jsMetadata = JSON.parse(fs.readFileSync(path.join(root, "sdk/js/package.json"), "utf8"));
  const pythonMetadata = readPythonProjectMetadata(fs.readFileSync(path.join(root, "sdk/python/pyproject.toml"), "utf8"));
  validatePackageMetadata(jsMetadata, pythonMetadata);

  const jsPackage = packageDefinition({
      id: "javascript",
      registry: "npm",
      name: jsMetadata.name,
      version: jsMetadata.version,
      artifact: `ynx-chain-sdk-js-${jsMetadata.version}.tgz`,
      archiveRoot: "package",
      sourceFiles: JS_FILES,
      root,
    });
  jsPackage.archiveFiles = jsPackage.sourceFiles.map((file) => ({
    archivePath: `${jsPackage.archiveRoot}/${path.basename(file.sourcePath)}`,
    bytes: file.bytes,
    sha256: file.sha256,
    sourcePath: file.sourcePath,
  }));
  const pythonPackage = packageDefinition({
      id: "python",
      registry: "pypi",
      name: pythonMetadata.name,
      version: pythonMetadata.version,
      artifact: `ynx_chain_sdk-${pythonMetadata.version}-py3-none-any.whl`,
      archiveRoot: "",
      sourceFiles: PYTHON_FILES,
      root,
    });
  pythonPackage.archiveFiles = pythonWheelFiles({root, name: pythonMetadata.name, version: pythonMetadata.version});
  const packages = [jsPackage, pythonPackage];

  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true, mode: 0o755});
  for (const packageEntry of packages) {
    const archiveEntries = packageEntry.archiveFiles.map((file) => ({
      path: file.archivePath,
      data: file.sourcePath ? fs.readFileSync(path.join(root, file.sourcePath)) : Buffer.from(file.generatedBody, "utf8"),
    }));
    const artifact = packageEntry.id === "python" ? createDeterministicZip(archiveEntries) : createDeterministicTarGz(archiveEntries);
    fs.writeFileSync(path.join(output, packageEntry.artifact.file), artifact, {mode: 0o644});
    for (const file of packageEntry.archiveFiles) delete file.generatedBody;
    packageEntry.artifact.bytes = artifact.length;
    packageEntry.artifact.sha256 = sha256(artifact);
  }

  const vectorBody = fs.readFileSync(path.join(root, "testdata/address-vectors.json"));
  const manifest = {
    chain: SDK_CHAIN,
    packages,
    schema: SDK_RELEASE_SCHEMA,
    signature: {
      algorithm: "Ed25519",
      ownerKeyGeneratedByTool: false,
      requiredForPublication: true,
      scope: "exact canonical manifest bytes",
    },
    source: {
      addressVectors: {
        bytes: vectorBody.length,
        path: "testdata/address-vectors.json",
        sha256: sha256(vectorBody),
      },
      gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim(),
    },
    status: SDK_RELEASE_STATUS,
  };
  const manifestBody = canonicalJSON(manifest);
  fs.writeFileSync(path.join(output, "sdk-release-manifest.json"), manifestBody, {mode: 0o644});
  return {manifest, manifestBody, outputDir: output};
}

function packageDefinition({id, registry, name, version, artifact, archiveRoot, sourceFiles, root}) {
  const mappedSourceFiles = sourceFiles.map((sourcePath) => {
    const body = fs.readFileSync(path.join(root, sourcePath));
    return {
      bytes: body.length,
      sha256: sha256(body),
      sourcePath,
    };
  });
  return {
    archiveRoot,
    archiveFiles: [],
    artifact: {bytes: 0, file: artifact, sha256: ""},
    buildCommand: "node scripts/package/sdk-release.mjs --output <directory>",
    id,
    name,
    registry,
    registryPublished: false,
    sourceFiles: mappedSourceFiles,
    version,
  };
}

function pythonWheelFiles({root, name, version}) {
  const distInfo = `ynx_chain_sdk-${version}.dist-info`;
  const sourceBody = fs.readFileSync(path.join(root, "sdk/python/ynx_client.py"));
  const metadata = [
    "Metadata-Version: 2.1",
    `Name: ${name}`,
    `Version: ${version}`,
    "Summary: Dependency-free Python client for YNX Chain status, EVM JSON-RPC, and ynx1 addresses",
    "Requires-Python: >=3.9",
    "",
  ].join("\n");
  const wheel = [
    "Wheel-Version: 1.0",
    "Generator: ynx-chain-sdk deterministic builder",
    "Root-Is-Purelib: true",
    "Tag: py3-none-any",
    "",
  ].join("\n");
  const files = [
    generatedWheelFile(`${distInfo}/METADATA`, metadata),
    generatedWheelFile(`${distInfo}/WHEEL`, wheel),
    generatedWheelFile(`${distInfo}/top_level.txt`, "ynx_client\n"),
    {archivePath: "ynx_client.py", bytes: sourceBody.length, sha256: sha256(sourceBody), sourcePath: "sdk/python/ynx_client.py"},
  ];
  const recordPath = `${distInfo}/RECORD`;
  const record = [...files]
    .sort((left, right) => left.archivePath.localeCompare(right.archivePath))
    .map((file) => `${file.archivePath},sha256=${digestBase64(file)},${file.bytes}`)
    .concat(`${recordPath},,`)
    .join("\n") + "\n";
  files.push(generatedWheelFile(recordPath, record));
  return files.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

function generatedWheelFile(archivePath, generatedBody) {
  const body = Buffer.from(generatedBody, "utf8");
  return {archivePath, bytes: body.length, generatedBody, sha256: sha256(body), sourcePath: null};
}

function digestBase64(file) {
  return Buffer.from(file.sha256, "hex").toString("base64url");
}

function validatePackageMetadata(jsMetadata, pythonMetadata) {
  if (jsMetadata.name !== "@ynx-chain/sdk") throw new Error("unexpected JavaScript SDK package name");
  if (pythonMetadata.name !== "ynx-chain-sdk") throw new Error("unexpected Python SDK package name");
  if (typeof jsMetadata.version !== "string" || !/^\d+\.\d+\.\d+$/.test(jsMetadata.version)) {
    throw new Error("JavaScript SDK version is not semantic x.y.z");
  }
  if (pythonMetadata.version !== jsMetadata.version) throw new Error("JavaScript and Python SDK versions differ");
}

function parseArguments(argv) {
  let outputDir = "tmp/sdk-release";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--output" || !argv[index + 1]) throw new Error("usage: sdk-release.mjs [--output <directory>]");
    outputDir = argv[index + 1];
    index += 1;
  }
  return {outputDir};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {outputDir} = parseArguments(process.argv.slice(2));
  const result = buildSDKRelease({rootDir: process.cwd(), outputDir});
  process.stdout.write(`${result.manifestBody}`);
  process.stderr.write(`SDK release artifacts generated at ${result.outputDir}\n`);
}
