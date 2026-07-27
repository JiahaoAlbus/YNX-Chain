import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  canonicalJSON,
  createDeterministicTarGz,
  sha256,
} from "../lib/sdk-release.mjs";

export const ORACLE_RELEASE_SCHEMA = "ynx-oracle-artifact-release/v1";
export const ORACLE_PROVENANCE_SCHEMA = "ynx-oracle-provenance/v1";
export const ORACLE_RELEASE_STATUS = "local-candidate; not hosted; not production-signed; not released";

const TARGETS = Object.freeze([
  Object.freeze({goos: "darwin", goarch: "arm64", id: "darwin-arm64", coldStartEligible: true}),
  Object.freeze({goos: "linux", goarch: "arm64", id: "linux-arm64", coldStartEligible: false}),
]);

const SOURCE_PATHS = Object.freeze([
  "go.mod",
  "go.sum",
  "cmd/ynx-oracled/main.go",
  "cmd/ynx-oracle-cli/main.go",
  "sdk/oracle/go/client.go",
  "sdk/oracle/typescript/package.json",
  "sdk/oracle/typescript/README.md",
  "sdk/oracle/typescript/src/index.ts",
  "sdk/oracle/typescript/tsconfig.json",
  "integration/oracle/v1/consumer-test-vectors.json",
  "integration/oracle/v1/price.schema.json",
  "config/oracle/provider-candidates.json",
  "OPERATIONS.md",
  "THIRD_PARTY_NOTICES.md",
  "scripts/lib/sdk-release.mjs",
  "scripts/package/oracle-release.mjs",
  "scripts/verify/oracle-release-verify.mjs",
  "scripts/verify/oracle-release-integrity-check.mjs",
]);

export function buildOracleRelease({rootDir, outputDir, allowDirty = false}) {
  const root = path.resolve(rootDir);
  const output = path.resolve(outputDir);
  validateOutputPath(root, output);

  const sourceCommit = git(root, ["rev-parse", "HEAD"]);
  const dirty = git(root, ["status", "--porcelain", "--untracked-files=all"]).length > 0;
  if (dirty && !allowDirty) {
    throw new Error("Oracle artifacts require a clean worktree; commit or protect changes first");
  }
  const commitTime = canonicalTimestamp(git(root, ["show", "-s", "--format=%cI", sourceCommit]));
  const releaseRecord = readJSON(path.join(root, "release/product-release.json"));
  const version = validateVersion(releaseRecord.version);
  const tsc = resolveTypeScriptCompiler(root);
  const toolchain = {
    go: execFileSync("go", ["env", "GOVERSION"], {cwd: root, encoding: "utf8"}).trim(),
    node: process.version,
    typescript: execFileSync(tsc, ["--version"], {cwd: root, encoding: "utf8"}).trim(),
  };

  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true, mode: 0o755});
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-oracle-artifact-"));
  try {
    execFileSync(tsc, ["-p", "sdk/oracle/typescript/tsconfig.json"], {cwd: root, stdio: "pipe"});
    const artifacts = [];
    for (const target of TARGETS) {
      artifacts.push(buildPlatformArtifact({root, output, work, target, version, sourceCommit, commitTime, toolchain}));
    }
    artifacts.push(buildTypeScriptArtifact({root, output, version}));
    artifacts.push(buildGoSDKArtifact({root, output, version}));

    const sourceFiles = SOURCE_PATHS.map((sourcePath) => fileDescriptor(root, sourcePath));
    const sbom = buildSBOM({root, artifacts, version, sourceCommit, commitTime});
    const sbomBody = canonicalJSON(sbom);
    const sbomFile = "ynx-oracle-release.cdx.json";
    fs.writeFileSync(path.join(output, sbomFile), sbomBody, {mode: 0o644});
    const sbomDescriptor = descriptorFromBody(sbomFile, Buffer.from(sbomBody), "cyclonedx-sbom");

    const provenance = {
      artifacts: artifacts.map(({archiveFiles: _archiveFiles, ...artifact}) => artifact),
      build: {
        command: "node scripts/package/oracle-release.mjs --output <directory>",
        deterministicArchive: true,
        networkRequired: false,
        outputDirectoryRestricted: true,
        targets: TARGETS.map(({goos, goarch}) => ({goarch, goos})),
        toolchain,
      },
      schema: ORACLE_PROVENANCE_SCHEMA,
      signing: {
        algorithm: "Ed25519",
        detachedManifestSignatureRequiredForPublication: true,
        ownerKeyGeneratedByTool: false,
        signingClass: "unsigned-local-candidate",
      },
      source: {
        clean: !dirty,
        commitTime,
        files: sourceFiles,
        gitCommit: sourceCommit,
        repository: "github.com/JiahaoAlbus/YNX-Chain",
      },
      status: ORACLE_RELEASE_STATUS,
      subject: "YNX Oracle & Market Data",
      version,
    };
    const provenanceBody = canonicalJSON(provenance);
    const provenanceFile = "ynx-oracle-provenance.json";
    fs.writeFileSync(path.join(output, provenanceFile), provenanceBody, {mode: 0o644});
    const provenanceDescriptor = descriptorFromBody(provenanceFile, Buffer.from(provenanceBody), "provenance");

    const manifest = {
      artifacts,
      buildTime: commitTime,
      productId: "ynx-oracle-market-data",
      provenance: provenanceDescriptor,
      publication: {
        downloadHosted: false,
        productionSigned: false,
        registryPublished: false,
        released: false,
        storeReleased: false,
      },
      schema: ORACLE_RELEASE_SCHEMA,
      sbom: sbomDescriptor,
      signing: provenance.signing,
      source: provenance.source,
      status: ORACLE_RELEASE_STATUS,
      version,
    };
    const manifestBody = canonicalJSON(manifest);
    fs.writeFileSync(path.join(output, "oracle-release-manifest.json"), manifestBody, {mode: 0o644});
    return {artifacts, manifest, manifestBody, outputDir: output, provenance, sbom};
  } finally {
    fs.rmSync(work, {recursive: true, force: true});
  }
}

export function recordOracleReleaseEvidence({rootDir, outputDir, evidenceDir, manifest}) {
  const root = path.resolve(rootDir);
  const output = path.resolve(outputDir);
  const evidence = path.resolve(evidenceDir);
  const allowedBase = path.join(root, "release", "evidence");
  if (evidence !== allowedBase && !evidence.startsWith(`${allowedBase}${path.sep}`)) {
    throw new Error("Oracle evidence directory must be under release/evidence");
  }
  if (manifest.source?.gitCommit?.length !== 40) {
    throw new Error("Oracle evidence requires a full source commit");
  }
  fs.mkdirSync(evidence, {recursive: true, mode: 0o755});
  const shortCommit = manifest.source.gitCommit.slice(0, 12);
  const files = [
    ["oracle-release-manifest.json", `oracle-artifact-manifest-${shortCommit}.json`],
    [manifest.provenance.file, `oracle-artifact-provenance-${shortCommit}.json`],
    [manifest.sbom.file, `oracle-artifact-sbom-${shortCommit}.cdx.json`],
  ];
  return files.map(([sourceFile, evidenceFile]) => {
    const source = path.join(output, sourceFile);
    const destination = path.join(evidence, evidenceFile);
    fs.copyFileSync(source, destination);
    const body = fs.readFileSync(destination);
    return {
      bytes: body.length,
      path: path.relative(root, destination).split(path.sep).join("/"),
      sha256: sha256(body),
    };
  });
}

function buildPlatformArtifact({root, output, work, target, version, sourceCommit, commitTime, toolchain}) {
  const stage = path.join(work, target.id);
  fs.mkdirSync(path.join(stage, "bin"), {recursive: true, mode: 0o755});
  const environment = {...process.env, CGO_ENABLED: "0", GOOS: target.goos, GOARCH: target.goarch};
  buildGoBinary({
    root,
    environment,
    output: path.join(stage, "bin/ynx-oracled"),
    packagePath: "./cmd/ynx-oracled",
    ldflags: `-s -w -buildid= -X github.com/JiahaoAlbus/YNX-Chain/internal/oracle.BuildCommit=${sourceCommit}`,
  });
  buildGoBinary({
    root,
    environment,
    output: path.join(stage, "bin/ynx-oracle-cli"),
    packagePath: "./cmd/ynx-oracle-cli",
    ldflags: "-s -w -buildid=",
  });

  const releaseInfo = canonicalJSON({
    artifactTarget: target.id,
    authoritativePrices: false,
    buildTime: commitTime,
    productId: "ynx-oracle-market-data",
    schema: ORACLE_RELEASE_SCHEMA,
    sourceCommit,
    status: ORACLE_RELEASE_STATUS,
    toolchain,
    version,
  });
  const install = platformInstallScript(target);
  const readme = platformReadme({target, version, sourceCommit});
  const entries = [
    {path: "bin/ynx-oracle-cli", data: fs.readFileSync(path.join(stage, "bin/ynx-oracle-cli")), installMode: "0755"},
    {path: "bin/ynx-oracled", data: fs.readFileSync(path.join(stage, "bin/ynx-oracled")), installMode: "0755"},
    {path: "config/provider-candidates.json", data: fs.readFileSync(path.join(root, "config/oracle/provider-candidates.json")), installMode: "0644"},
    {path: "docs/OPERATIONS.md", data: fs.readFileSync(path.join(root, "OPERATIONS.md")), installMode: "0644"},
    {path: "docs/THIRD_PARTY_NOTICES.md", data: fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md")), installMode: "0644"},
    {path: "INSTALL.sh", data: Buffer.from(install), installMode: "0755"},
    {path: "README.md", data: Buffer.from(readme), installMode: "0644"},
    {path: "release-info.json", data: Buffer.from(releaseInfo), installMode: "0644"},
  ];
  const artifactBody = createDeterministicTarGz(entries);
  const file = `ynx-oracle-${version}-${target.id}.tar.gz`;
  fs.writeFileSync(path.join(output, file), artifactBody, {mode: 0o644});
  return {
    archiveFiles: entries.map((entry) => ({
      archiveMode: "0644",
      bytes: entry.data.length,
      installMode: entry.installMode,
      path: entry.path,
      sha256: sha256(entry.data),
    })),
    bytes: artifactBody.length,
    coldStartTested: false,
    file,
    hosted: false,
    id: `platform-${target.id}`,
    kind: "server-cli-bundle",
    minimumRuntime: target.goos === "darwin" ? "macOS arm64" : "Linux arm64",
    productionSigned: false,
    sha256: sha256(artifactBody),
    target: target.id,
  };
}

function buildTypeScriptArtifact({root, output, version}) {
  const packageJSON = canonicalJSON({
    engines: {node: ">=20"},
    exports: {".": {import: "./dist/index.js", types: "./dist/index.d.ts"}},
    files: ["dist", "README.md"],
    main: "./dist/index.js",
    name: "@ynx/oracle-client",
    type: "module",
    types: "./dist/index.d.ts",
    version,
  });
  const entries = [
    {path: "package/README.md", data: fs.readFileSync(path.join(root, "sdk/oracle/typescript/README.md"))},
    {path: "package/dist/index.d.ts", data: fs.readFileSync(path.join(root, "sdk/oracle/typescript/dist/index.d.ts"))},
    {path: "package/dist/index.js", data: fs.readFileSync(path.join(root, "sdk/oracle/typescript/dist/index.js"))},
    {path: "package/package.json", data: Buffer.from(packageJSON)},
  ];
  const artifactBody = createDeterministicTarGz(entries);
  const file = `ynx-oracle-client-${version}.tgz`;
  fs.writeFileSync(path.join(output, file), artifactBody, {mode: 0o644});
  return {
    archiveFiles: entries.map((entry) => ({archiveMode: "0644", bytes: entry.data.length, installMode: "0644", path: entry.path, sha256: sha256(entry.data)})),
    bytes: artifactBody.length,
    coldStartTested: false,
    file,
    hosted: false,
    id: "typescript-sdk",
    kind: "npm-package-candidate",
    minimumRuntime: "Node.js 20",
    productionSigned: false,
    sha256: sha256(artifactBody),
    target: "any-node20",
  };
}

function buildGoSDKArtifact({root, output, version}) {
  const modulePath = "github.com/JiahaoAlbus/YNX-Chain/sdk/oracle/go";
  const goMod = `module ${modulePath}\n\ngo 1.25.12\n`;
  const readme = `# YNX Oracle Go consumer SDK\n\nVersion: ${version}\n\nThis dependency-free consumer validates canonical YNX Oracle responses and fails closed on schema, request, freshness, source, confidence, coverage, lineage, derivation, and transport violations.\n\nThe artifact is a local unsigned candidate and is not registry-hosted.\n`;
  const entries = [
    {path: "ynx-oracle-client-go/client.go", data: fs.readFileSync(path.join(root, "sdk/oracle/go/client.go"))},
    {path: "ynx-oracle-client-go/go.mod", data: Buffer.from(goMod)},
    {path: "ynx-oracle-client-go/README.md", data: Buffer.from(readme)},
  ];
  const artifactBody = createDeterministicTarGz(entries);
  const file = `ynx-oracle-client-go-${version}.tar.gz`;
  fs.writeFileSync(path.join(output, file), artifactBody, {mode: 0o644});
  return {
    archiveFiles: entries.map((entry) => ({archiveMode: "0644", bytes: entry.data.length, installMode: "0644", path: entry.path, sha256: sha256(entry.data)})),
    bytes: artifactBody.length,
    coldStartTested: false,
    file,
    hosted: false,
    id: "go-sdk",
    kind: "go-module-source-candidate",
    minimumRuntime: "Go 1.25.12",
    productionSigned: false,
    sha256: sha256(artifactBody),
    target: "any-go1.25.12",
  };
}

function buildSBOM({root, artifacts, version, sourceCommit, commitTime}) {
  const modules = execFileSync("go", [
    "list", "-m", "-f={{.Path}}\t{{.Version}}\t{{if .Main}}main{{end}}\t{{if .Replace}}{{.Replace.Path}}\t{{.Replace.Version}}{{end}}", "all",
  ], {cwd: root, encoding: "utf8"})
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [modulePath, moduleVersion, main, replacementPath, replacementVersion] = line.split("\t");
      return {main: main === "main", modulePath, moduleVersion, replacementPath, replacementVersion};
    })
    .filter((module) => !module.main)
    .map((module) => {
      const resolvedPath = module.replacementPath || module.modulePath;
      const componentVersion = module.replacementVersion || module.moduleVersion || "unknown";
      const purl = `pkg:golang/${resolvedPath}@${componentVersion}`;
      return {"bom-ref": purl, name: resolvedPath, purl, type: "library", version: componentVersion};
    });
  modules.push({
    "bom-ref": `pkg:npm/%40ynx%2Foracle-client@${version}`,
    name: "@ynx/oracle-client",
    purl: `pkg:npm/%40ynx%2Foracle-client@${version}`,
    type: "library",
    version,
  });
  for (const artifact of artifacts) {
    modules.push({
      "bom-ref": `urn:ynx:oracle-artifact:${artifact.id}:${artifact.sha256}`,
      hashes: [{alg: "SHA-256", content: artifact.sha256}],
      name: artifact.file,
      properties: [
        {name: "ynx:artifact-kind", value: artifact.kind},
        {name: "ynx:target", value: artifact.target},
        {name: "ynx:signing-class", value: "unsigned-local-candidate"},
      ],
      type: "application",
      version,
    });
  }
  modules.sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
  return {
    bomFormat: "CycloneDX",
    components: modules,
    metadata: {
      component: {name: "YNX Oracle & Market Data", type: "application", version},
      properties: [
        {name: "ynx:source-commit", value: sourceCommit},
        {name: "ynx:release-status", value: ORACLE_RELEASE_STATUS},
      ],
      timestamp: commitTime,
      tools: {components: [{name: "scripts/package/oracle-release.mjs", type: "application", version: "1"}]},
    },
    serialNumber: deterministicURN(`${sourceCommit}:${version}:oracle-release`),
    specVersion: "1.6",
    version: 1,
  };
}

function buildGoBinary({root, environment, output, packagePath, ldflags}) {
  execFileSync("go", ["build", "-trimpath", "-buildvcs=false", `-ldflags=${ldflags}`, "-o", output, packagePath], {
    cwd: root,
    env: environment,
    stdio: "pipe",
  });
}

function platformInstallScript(target) {
  return `#!/bin/sh\nset -eu\nexpected_os=${target.goos}\nexpected_arch=${target.goarch}\nactual_os=$(uname -s | tr '[:upper:]' '[:lower:]')\nactual_arch=$(uname -m)\n[ "$actual_arch" = "aarch64" ] && actual_arch=arm64\nif [ "$actual_os" != "$expected_os" ] || [ "$actual_arch" != "$expected_arch" ]; then\n  echo "target mismatch: expected $expected_os/$expected_arch, got $actual_os/$actual_arch" >&2\n  exit 1\nfi\nprefix=${"${PREFIX:-/usr/local}"}\ninstall -d "$prefix/bin"\ninstall -m 0755 bin/ynx-oracled "$prefix/bin/ynx-oracled"\ninstall -m 0755 bin/ynx-oracle-cli "$prefix/bin/ynx-oracle-cli"\necho "installed unsigned local candidate to $prefix/bin"\n`;
}

function platformReadme({target, version, sourceCommit}) {
  return `# YNX Oracle & Market Data ${target.id}\n\nVersion: ${version}\nSource commit: ${sourceCommit}\nStatus: ${ORACLE_RELEASE_STATUS}\n\nThis archive contains ynx-oracled, ynx-oracle-cli, the inactive provider-candidate registry, operations guidance, and third-party notices. It contains no provider credentials, reporter keys, HMAC keys, or production activation material.\n\nInstall with: PREFIX=/desired/prefix sh INSTALL.sh\n\nThe included candidate registry must remain fail closed. Do not describe this archive as hosted, production-signed, authoritative, or released.\n`;
}

function fileDescriptor(root, sourcePath) {
  const body = fs.readFileSync(path.join(root, sourcePath));
  return {bytes: body.length, path: sourcePath, sha256: sha256(body)};
}

function descriptorFromBody(file, body, kind) {
  return {bytes: body.length, file, kind, sha256: sha256(body)};
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function git(root, args) {
  return execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();
}

function validateVersion(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Oracle release version is not semantic");
  }
  return version;
}

function validateOutputPath(root, output) {
  if (output === root || root.startsWith(`${output}${path.sep}`)) {
    throw new Error("Oracle output directory may not contain the repository root");
  }
  const allowed = [path.join(root, "tmp"), path.resolve(os.tmpdir())];
  if (!allowed.some((base) => output === base || output.startsWith(`${base}${path.sep}`))) {
    throw new Error("Oracle output directory must be under repository tmp/ or the system temporary directory");
  }
}

function resolveTypeScriptCompiler(root) {
  const configured = process.env.YNX_ORACLE_TSC;
  const candidate = configured ? path.resolve(configured) : path.join(root, "apps/oracle/node_modules/.bin/tsc");
  if (!fs.existsSync(candidate)) {
    throw new Error("TypeScript compiler is unavailable; install the locked Oracle Web dependencies first");
  }
  return candidate;
}

function canonicalTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("source commit timestamp is invalid");
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function deterministicURN(seed) {
  const digest = sha256(Buffer.from(seed));
  const value = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((Number.parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
  return `urn:uuid:${value}`;
}

function parseArguments(argv) {
  let outputDir = "tmp/oracle-release";
  let evidenceDir = "";
  let allowDirty = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-dirty") {
      allowDirty = true;
      continue;
    }
    if (argument === "--output" && argv[index + 1]) {
      outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--evidence-dir" && argv[index + 1]) {
      evidenceDir = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error("usage: oracle-release.mjs [--output <directory>] [--evidence-dir <release/evidence directory>] [--allow-dirty]");
  }
  return {allowDirty, evidenceDir, outputDir};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {allowDirty, evidenceDir, outputDir} = parseArguments(process.argv.slice(2));
  const rootDir = process.cwd();
  const result = buildOracleRelease({rootDir, outputDir, allowDirty});
  if (evidenceDir) {
    const evidence = recordOracleReleaseEvidence({rootDir, outputDir: result.outputDir, evidenceDir, manifest: result.manifest});
    process.stderr.write(`Oracle release evidence recorded: ${evidence.map((entry) => entry.path).join(", ")}\n`);
  }
  process.stdout.write(result.manifestBody);
  process.stderr.write(`Oracle release artifacts generated at ${result.outputDir}\n`);
}
