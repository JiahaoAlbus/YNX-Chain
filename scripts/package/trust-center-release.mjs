#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
let root = process.cwd();
root = exec("git", ["rev-parse", "--show-toplevel"]);
process.chdir(root);

const dirty = exec("git", ["status", "--porcelain"]);
if (dirty && !options.allowDirty) {
  throw new Error("Trust release builds require a clean worktree; commit or protect changes before building");
}

const sourceCommit = exec("git", ["rev-parse", "HEAD"]);
const sourceBranch = exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const commitTime = exec("git", ["show", "-s", "--format=%cI", sourceCommit]);
const commitEpoch = Number(exec("git", ["show", "-s", "--format=%ct", sourceCommit]));
const shortCommit = sourceCommit.slice(0, 12);
const goRoot = exec("go", ["env", "GOROOT"]);
const goCommand = path.join(goRoot, "bin", "go");
if (!fs.existsSync(goCommand) || !fs.statSync(goCommand).isFile()) {
  throw new Error(`resolved Go toolchain binary is unavailable: ${goCommand}`);
}
const goos = options.goos || exec(goCommand, ["env", "GOOS"]);
const goarch = options.goarch || exec(goCommand, ["env", "GOARCH"]);
const hostGOOS = exec(goCommand, ["env", "GOHOSTOS"]);
const hostGOARCH = exec(goCommand, ["env", "GOHOSTARCH"]);
const release = options.release || `ynx-trust-center-${shortCommit}`;
const outDir = path.resolve(options.out || path.join("dist", "trust-center-release", shortCommit, `${goos}-${goarch}`));
const buildA = path.join(outDir, ".build-a");
const buildB = path.join(outDir, ".build-b");
const bundleDir = path.join(outDir, "bundle");
const installDir = path.join(outDir, "install");
const evidenceDir = options.evidence ? path.resolve(options.evidence) : null;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(buildA, { recursive: true, mode: 0o700 });
fs.mkdirSync(buildB, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(bundleDir, "bin"), { recursive: true, mode: 0o755 });

const binarySpecs = [
  {
    name: "ynx-trust-center",
    package: "./apps/trust-center",
    linkerPackage: "main"
  },
  {
    name: "ynx-trust-backup",
    package: "./cmd/ynx-trust-backup",
    linkerPackage: "main"
  }
];

const buildEnvironment = {
  ...process.env,
  PATH: `${path.dirname(goCommand)}${path.delimiter}${process.env.PATH || ""}`,
  GOTOOLCHAIN: "local",
  CGO_ENABLED: "0",
  GOOS: goos,
  GOARCH: goarch,
  GOPROXY: "off",
  GOSUMDB: "off",
  SOURCE_DATE_EPOCH: String(commitEpoch)
};

const moduleVerificationEnvironment = {
  ...process.env,
  PATH: `${path.dirname(goCommand)}${path.delimiter}${process.env.PATH || ""}`,
  GOTOOLCHAIN: "local",
  GOPROXY: process.env.GOPROXY && process.env.GOPROXY !== "off"
    ? process.env.GOPROXY
    : "https://proxy.golang.org,direct",
  GOSUMDB: process.env.GOSUMDB && process.env.GOSUMDB !== "off"
    ? process.env.GOSUMDB
    : "sum.golang.org"
};

for (const spec of binarySpecs) {
  buildBinary(spec, path.join(buildA, spec.name));
  buildBinary(spec, path.join(buildB, spec.name));
}

const binaries = [];
for (const spec of binarySpecs) {
  const first = path.join(buildA, spec.name);
  const second = path.join(buildB, spec.name);
  const firstHash = sha256File(first);
  const secondHash = sha256File(second);
  if (firstHash !== secondHash) {
    throw new Error(`${spec.name} is not reproducible: ${firstHash} != ${secondHash}`);
  }
  const target = path.join(bundleDir, "bin", spec.name);
  fs.copyFileSync(first, target);
  fs.chmodSync(target, 0o755);
  binaries.push({
    name: spec.name,
    package: spec.package,
    path: `bin/${spec.name}`,
    sha256: firstHash,
    bytes: fs.statSync(first).size,
    signingClass: detectSigningClass(first, goos),
    goVersionMetadata: goVersionMetadata(first)
  });
}

execFileSync(goCommand, ["mod", "verify"], {
  cwd: root,
  env: moduleVerificationEnvironment,
  stdio: "pipe"
});

const linkedModules = linkedDependencyModules(binaries);
const moduleMetadata = linkedModules.length > 0 ? goModuleMetadata() : new Map();
const licenseReview = collectLicenseReview(linkedModules, moduleMetadata, bundleDir);
if (!licenseReview.complete) {
  throw new Error(`linked dependency license review is incomplete: ${licenseReview.missing.join(", ")}`);
}
const goToolchainLicense = collectGoToolchainLicense(bundleDir);

const sbom = buildCycloneDX({
  sourceCommit,
  commitTime,
  release,
  goos,
  goarch,
  binaries,
  modules: linkedModules,
  licenses: licenseReview.modules,
  goToolchainLicense
});
const sbomPath = path.join(bundleDir, "bom.cdx.json");
writeJSON(sbomPath, sbom);

const notices = buildThirdPartyNotices(linkedModules, licenseReview.modules, goToolchainLicense);
const noticesPath = path.join(bundleDir, "THIRD_PARTY_NOTICES.txt");
fs.writeFileSync(noticesPath, notices, { encoding: "utf8", mode: 0o644 });

const scanResults = runFocusedScans();
const vulnerabilityDatabaseScan = commandExists("govulncheck")
  ? runGovulncheck()
  : { result: "notRun", reason: "govulncheck is not installed in the verified build environment" };
if (vulnerabilityDatabaseScan.result === "fail") {
  throw new Error(`govulncheck failed with exit code ${vulnerabilityDatabaseScan.exitCode}`);
}
const installResults = await verifyInstalledArtifacts({
  sourceCommit,
  release,
  commitTime,
  goos,
  goarch,
  hostGOOS,
  hostGOARCH,
  bundleDir,
  installDir
});

const archiveName = `ynx-trust-center-${shortCommit}-${goos}-${goarch}.tar.gz`;
const archivePath = path.join(outDir, archiveName);
const archiveBytesA = deterministicTarGzip(bundleDir, commitEpoch);
const archiveBytesB = deterministicTarGzip(bundleDir, commitEpoch);
if (!archiveBytesA.equals(archiveBytesB)) {
  throw new Error("Trust release archive generation is not deterministic");
}
fs.writeFileSync(archivePath, archiveBytesA, { mode: 0o644 });

const artifactSubjects = [
  ...binaries.map(({ name, path: artifactPath, sha256, bytes, signingClass }) => ({
    name,
    path: artifactPath,
    sha256,
    bytes,
    signingClass
  })),
  {
    name: archiveName,
    path: archiveName,
    sha256: sha256Buffer(archiveBytesA),
    bytes: archiveBytesA.length,
    signingClass: "unsigned-local"
  }
];

const materials = ["go.mod", "go.sum", "Makefile", "scripts/package/trust-center-release.mjs", ...trackedRuntimeInputs()].map((file) => ({
  path: file,
  sha256: sha256File(file),
  bytes: fs.statSync(file).size
}));

const verification = {
  schemaVersion: "ynx-trust-center-release-verification/v1",
  sourceCommit,
  sourceBranch,
  release,
  target: { goos, goarch },
  worktreeCleanAtBuildStart: dirty === "",
  reproducibleBuild: {
    result: "pass",
    passes: 2,
    binaries: binaries.map((binary) => ({ name: binary.name, sha256: binary.sha256 }))
  },
  deterministicArchive: { result: "pass", sha256: sha256Buffer(archiveBytesA) },
  moduleIntegrity: { command: "go mod verify", result: "pass" },
  focusedSecretScan: scanResults.secret,
  focusedPlaceholderScan: scanResults.placeholder,
  linkedDependencyLicenseReview: {
    result: licenseReview.complete ? "pass" : "fail",
    linkedThirdPartyModules: linkedModules.length,
    standardLibraryLicense: goToolchainLicense,
    missing: licenseReview.missing
  },
  vulnerabilityDatabaseScan,
  installedLocal: installResults,
  limitations: [
    "This build is local and is not hosted, production-signed, notarized, store-released or independently attested.",
    "CycloneDX components are derived from modules linked into the two Go binaries; development-only tooling is excluded.",
    "The focused scanner is not a substitute for an external maintained vulnerability or secret-signature database."
  ]
};

const provenance = {
  schemaVersion: "ynx-local-build-provenance/v1",
  predicateType: "urn:ynx:provenance:local-build:v1",
  subject: artifactSubjects.map((subject) => ({
    name: subject.name,
    digest: { sha256: subject.sha256 },
    bytes: subject.bytes
  })),
  predicate: {
    buildType: "ynx-trust-center-reproducible-go-bundle/v1",
    builder: { id: "scripts/package/trust-center-release.mjs" },
    invocation: {
      sourceCommit,
      sourceBranch,
      release,
      buildTime: commitTime,
      target: { goos, goarch },
      parameters: {
        cgoEnabled: false,
        trimpath: true,
        buildVCS: false,
        linkerBuildID: "empty",
        moduleProxy: "off",
        sumDatabase: "off"
      }
    },
    materials,
    environment: {
      goVersion: exec(goCommand, ["version"]),
      nodeVersion: process.version,
      host: { goos: hostGOOS, goarch: hostGOARCH }
    },
    verification: {
      reproducibleBuild: true,
      deterministicArchive: true,
      goModVerify: true,
      installAndColdStart: installResults.result === "pass"
    },
    truthBoundary: "Local provenance binds bytes to a clean source commit and deterministic commands; it is not external SLSA attestation, notarization or production signing."
  }
};

const manifest = {
  schemaVersion: "ynx-trust-center-artifact-manifest/v1",
  product: "YNX Trust Center",
  sourceCommit,
  sourceBranch,
  release,
  buildTime: commitTime,
  target: { goos, goarch, cgoEnabled: false },
  signingClass: "unsigned-local",
  binarySigningClass: aggregateSigningClass(binaries),
  installedLocal: installResults.result === "pass",
  integratedCentral: false,
  deployedPublic: false,
  downloadHosted: false,
  productionSigned: false,
  storeReleased: false,
  artifacts: artifactSubjects,
  metadata: [
    fileRecord(sbomPath, path.relative(outDir, sbomPath)),
    fileRecord(noticesPath, path.relative(outDir, noticesPath))
  ],
  verificationFile: "verification.json",
  provenanceFile: "provenance.json",
  artifactAvailability: "local build output only; not committed or hosted"
};

const manifestPath = path.join(outDir, "artifact-manifest.json");
const verificationPath = path.join(outDir, "verification.json");
const provenancePath = path.join(outDir, "provenance.json");
writeJSON(manifestPath, manifest);
writeJSON(verificationPath, verification);
writeJSON(provenancePath, provenance);
writeChecksums(outDir, [archivePath, manifestPath, verificationPath, provenancePath, sbomPath, noticesPath]);

if (evidenceDir) {
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o755 });
  const evidenceFiles = [];
  for (const [source, name] of [
    [manifestPath, "artifact-manifest.json"],
    [verificationPath, "verification.json"],
    [provenancePath, "provenance.json"],
    [sbomPath, "bom.cdx.json"],
    [noticesPath, "THIRD_PARTY_NOTICES.txt"]
  ]) {
    const destination = path.join(evidenceDir, name);
    fs.copyFileSync(source, destination);
    evidenceFiles.push(destination);
  }
  const licenseSource = path.join(bundleDir, "licenses");
  if (fs.existsSync(licenseSource)) {
    const licenseDestination = path.join(evidenceDir, "licenses");
    fs.cpSync(licenseSource, licenseDestination, { recursive: true });
    evidenceFiles.push(...walkFiles(licenseDestination).map((file) => path.join(licenseDestination, file)));
  }
  writeChecksums(evidenceDir, evidenceFiles);
}

console.log(JSON.stringify({
  result: "pass",
  sourceCommit,
  release,
  target: `${goos}/${goarch}`,
  artifact: path.relative(root, archivePath),
  artifactSha256: sha256File(archivePath),
  evidence: evidenceDir ? path.relative(root, evidenceDir) : null,
  installedLocal: installResults.result === "pass",
  signingClass: manifest.signingClass,
  binarySigningClass: manifest.binarySigningClass,
  vulnerabilityDatabaseScan: verification.vulnerabilityDatabaseScan.result
}, null, 2));

function parseArgs(args) {
  const result = { allowDirty: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--allow-dirty") {
      result.allowDirty = true;
      continue;
    }
    const key = value.startsWith("--") ? value.slice(2) : "";
    if (!["out", "evidence", "goos", "goarch", "release"].includes(key)) {
      throw new Error(`unknown Trust release argument: ${value}`);
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

function exec(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root || process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  }).trim();
}

function buildBinary(spec, output) {
  const ldflags = [
    "-s",
    "-w",
    "-buildid=",
    "-X",
    `${spec.linkerPackage}.buildCommit=${sourceCommit}`,
    "-X",
    `${spec.linkerPackage}.buildRelease=${release}`,
    "-X",
    `${spec.linkerPackage}.buildTime=${commitTime}`
  ].join(" ");
  execFileSync(goCommand, ["build", "-trimpath", "-buildvcs=false", "-ldflags", ldflags, "-o", output, spec.package], {
    cwd: root,
    env: buildEnvironment,
    stdio: "pipe"
  });
  fs.chmodSync(output, 0o755);
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
}

function goVersionMetadata(binary) {
  const output = execFileSync(goCommand, ["version", "-m", binary], { cwd: root, encoding: "utf8" });
  return output.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function linkedDependencyModules(binaryRecords) {
  const modules = new Map();
  for (const binary of binaryRecords) {
    for (const line of binary.goVersionMetadata) {
      const fields = line.split("\t");
      if (fields[0] !== "dep" || !fields[1] || !fields[2]) continue;
      const key = `${fields[1]}@${fields[2]}`;
      modules.set(key, { path: fields[1], version: fields[2], sum: fields[3] || null });
    }
  }
  return [...modules.values()].sort((a, b) => `${a.path}@${a.version}`.localeCompare(`${b.path}@${b.version}`));
}

function goModuleMetadata() {
  const template = "{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}";
  const output = execFileSync(goCommand, ["list", "-m", "-f", template, "all"], {
    cwd: root,
    env: buildEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const result = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [modulePath, version, directory] = line.split("\t");
    result.set(`${modulePath}@${version}`, { path: modulePath, version, directory });
  }
  return result;
}

function collectLicenseReview(modules, metadata, targetBundleDir) {
  const reviewed = [];
  const missing = [];
  for (const module of modules) {
    const record = metadata.get(`${module.path}@${module.version}`);
    if (!record?.directory || !fs.existsSync(record.directory)) {
      missing.push(`${module.path}@${module.version}:module-directory-unavailable`);
      continue;
    }
    const candidates = fs.readdirSync(record.directory)
      .filter((name) => /^(license|licence|copying|notice)(\..*)?$/i.test(name))
      .sort((a, b) => a.localeCompare(b));
    if (candidates.length === 0) {
      missing.push(`${module.path}@${module.version}:license-file-unavailable`);
      continue;
    }
    const licenseFiles = [];
    for (const candidate of candidates) {
      const source = path.join(record.directory, candidate);
      if (!fs.statSync(source).isFile()) continue;
      const safe = `${sanitizeModule(module.path)}@${sanitizeModule(module.version)}-${candidate}`;
      const destination = path.join(targetBundleDir, "licenses", safe);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      fs.copyFileSync(source, destination);
      licenseFiles.push({
        sourceFile: candidate,
        bundledFile: `licenses/${safe}`,
        sha256: sha256File(source)
      });
    }
    if (licenseFiles.length === 0) {
      missing.push(`${module.path}@${module.version}:license-file-unreadable`);
      continue;
    }
    reviewed.push({ ...module, licenseFiles });
  }
  return { complete: missing.length === 0, missing, modules: reviewed };
}

function collectGoToolchainLicense(targetBundleDir) {
  const candidates = [
    path.join(goRoot, "LICENSE"),
    path.join(goRoot, "LICENSE.txt"),
    path.resolve(goRoot, "..", "LICENSE"),
    path.resolve(goRoot, "..", "LICENSE.txt"),
    path.resolve(goRoot, "..", "share", "doc", "go", "LICENSE")
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!source) {
    throw new Error("Go toolchain LICENSE is unavailable in the bounded GOROOT installation paths");
  }
  const bundledFile = "licenses/Go-LICENSE.txt";
  const destination = path.join(targetBundleDir, bundledFile);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  fs.copyFileSync(source, destination);
  return {
    toolchain: exec(goCommand, ["version"]),
    bundledFile,
    sha256: sha256File(source)
  };
}

function sanitizeModule(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function buildCycloneDX({ sourceCommit, commitTime, release, goos, goarch, binaries, modules, licenses, goToolchainLicense }) {
  const rootRef = `pkg:golang/github.com/JiahaoAlbus/YNX-Chain@${sourceCommit}`;
  const refs = modules.map((module) => modulePurl(module));
  const licenseMap = new Map(licenses.map((entry) => [`${entry.path}@${entry.version}`, entry]));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: deterministicUUID(sourceCommit, `${goos}/${goarch}`),
    version: 1,
    metadata: {
      timestamp: commitTime,
      tools: [{ vendor: "YNX", name: "trust-center-release.mjs", version: "1" }],
      component: {
        type: "application",
        "bom-ref": rootRef,
        group: "github.com/JiahaoAlbus",
        name: "YNX-Chain/trust-center",
        version: sourceCommit,
        purl: rootRef,
        properties: [
          { name: "ynx:release", value: release },
          { name: "ynx:target", value: `${goos}/${goarch}` },
          { name: "ynx:binaries", value: binaries.map((entry) => entry.name).join(",") },
          { name: "ynx:go-toolchain", value: goToolchainLicense.toolchain },
          { name: "ynx:go-license-file", value: goToolchainLicense.bundledFile },
          { name: "ynx:go-license-sha256", value: goToolchainLicense.sha256 }
        ]
      }
    },
    components: modules.map((module) => {
      const license = licenseMap.get(`${module.path}@${module.version}`);
      return {
        type: "library",
        "bom-ref": modulePurl(module),
        group: module.path.includes("/") ? module.path.slice(0, module.path.lastIndexOf("/")) : "",
        name: module.path,
        version: module.version,
        purl: modulePurl(module),
        properties: [
          ...(module.sum ? [{ name: "ynx:go-module-sum", value: module.sum }] : []),
          { name: "ynx:license-files", value: license ? license.licenseFiles.map((file) => file.bundledFile).join(",") : "none" }
        ]
      };
    }),
    dependencies: [{ ref: rootRef, dependsOn: refs }, ...refs.map((ref) => ({ ref, dependsOn: [] }))]
  };
}

function modulePurl(module) {
  return `pkg:golang/${encodeURIComponent(module.path).replace(/%2F/g, "/")}@${encodeURIComponent(module.version)}`;
}

function deterministicUUID(...parts) {
  const bytes = crypto.createHash("sha256").update(parts.join("\u0000")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildThirdPartyNotices(modules, licenses, goToolchainLicense) {
  const lines = [
    "YNX Trust Center Third-Party Notices",
    "====================================",
    "",
    `Source commit: ${sourceCommit}`,
    `Target: ${goos}/${goarch}`,
    "",
    "This inventory is derived from modules linked into the release binaries using `go version -m`.",
    `Go toolchain: ${goToolchainLicense.toolchain}`,
    `Go standard-library license: ${goToolchainLicense.bundledFile}`,
    `Go standard-library license SHA-256: ${goToolchainLicense.sha256}`,
    ""
  ];
  if (modules.length === 0) {
    lines.push("No non-standard-library Go modules are linked into these two Trust release binaries.", "");
  } else {
    const reviewMap = new Map(licenses.map((entry) => [`${entry.path}@${entry.version}`, entry]));
    for (const module of modules) {
      const review = reviewMap.get(`${module.path}@${module.version}`);
      lines.push(`${module.path} ${module.version}`);
      for (const file of review?.licenseFiles || []) {
        lines.push(`  License/notice file: ${file.bundledFile}`);
        lines.push(`  SHA-256: ${file.sha256}`);
      }
      lines.push("");
    }
  }
  lines.push("This file is an inventory and preservation record, not legal advice or a representation of external audit.", "");
  return lines.join("\n");
}

function trackedRuntimeInputs() {
  const output = execFileSync("git", ["ls-files", "-z", "apps/trust-center/main.go", "apps/trust-center/web", "internal/trustproduct", "internal/buildinfo", "cmd/ynx-trust-backup/main.go"], {
    cwd: root,
    encoding: "buffer"
  });
  return output.toString("utf8")
    .split("\u0000")
    .filter((file) => file && !file.endsWith("_test.go"))
    .sort((a, b) => a.localeCompare(b));
}

function runFocusedScans() {
  const allFiles = trackedRuntimeInputs();
  const secretPatterns = [
    /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
  ];
  const productionFiles = allFiles.filter((file) => !file.endsWith("_test.go") && !file.includes("/tests/") && !file.includes("/mobile/android/gradle/"));
  const placeholderPatterns = [
    /\bTODO\b/,
    /\bFIXME\b/,
    /coming soon/i,
    /example\.com/i,
    /fake (?:balance|user|transaction|price|revenue|apy|tvl|liquidity|provider|health)/i,
    /hard[- ]?coded success/i,
    /no[- ]?op button/i
  ];
  const secretFindings = scanFiles(allFiles, secretPatterns);
  const placeholderFindings = scanFiles(productionFiles, placeholderPatterns);
  if (secretFindings.length > 0) {
    throw new Error(`focused Trust secret scan failed: ${JSON.stringify(secretFindings)}`);
  }
  if (placeholderFindings.length > 0) {
    throw new Error(`focused Trust placeholder scan failed: ${JSON.stringify(placeholderFindings)}`);
  }
  return {
    secret: { result: "pass", filesScanned: allFiles.length, signatures: secretPatterns.length },
    placeholder: { result: "pass", filesScanned: productionFiles.length, signatures: placeholderPatterns.length }
  };
}

function scanFiles(files, patterns) {
  const findings = [];
  for (const file of files) {
    const raw = fs.readFileSync(file);
    if (raw.includes(0)) continue;
    const text = raw.toString("utf8");
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) findings.push({ file, pattern: String(pattern), match: match[0].slice(0, 80) });
    }
  }
  return findings;
}

async function verifyInstalledArtifacts({ sourceCommit, release, commitTime, goos, goarch, hostGOOS, hostGOARCH, bundleDir, installDir }) {
  if (goos !== hostGOOS || goarch !== hostGOARCH) {
    return { result: "notRun", reason: `cross target ${goos}/${goarch} cannot execute on ${hostGOOS}/${hostGOARCH}` };
  }
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(installDir, "bin"), { recursive: true, mode: 0o755 });
  fs.mkdirSync(path.join(installDir, "state"), { recursive: true, mode: 0o700 });
  for (const spec of binarySpecs) {
    const source = path.join(bundleDir, "bin", spec.name);
    const destination = path.join(installDir, "bin", spec.name);
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, 0o755);
  }

  const backupVersion = spawnSync(path.join(installDir, "bin", "ynx-trust-backup"), ["version"], { encoding: "utf8" });
  if (backupVersion.status !== 0) {
    throw new Error(`installed backup CLI version failed: ${backupVersion.stderr}`);
  }
  const backupBuild = JSON.parse(backupVersion.stdout);
  assertBuildInfo(backupBuild, sourceCommit, release, commitTime, "backup CLI");

  const port = await reservePort();
  const serverPath = path.join(installDir, "bin", "ynx-trust-center");
  const statePath = path.join(installDir, "state", "state.json");
  const child = spawn(serverPath, [], {
    cwd: installDir,
    env: {
      ...process.env,
      YNX_TRUST_CENTER_ADDR: `127.0.0.1:${port}`,
      YNX_TRUST_CENTER_STORE: statePath,
      YNX_TRUST_CENTER_DEV_HEADER_AUTH: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  try {
    const health = await pollHealth(`http://127.0.0.1:${port}/health`, child);
    if (health.ok !== true || health.service !== "ynx-trust-center") {
      throw new Error(`installed Trust server health was not ready: ${JSON.stringify(health)}`);
    }
    assertBuildInfo(health.build, sourceCommit, release, commitTime, "Trust server");
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child, 5000);
  }
  if (child.exitCode !== null && child.exitCode !== 0 && child.signalCode !== "SIGTERM") {
    throw new Error(`installed Trust server exited unexpectedly: code=${child.exitCode} signal=${child.signalCode} logs=${logs}`);
  }
  return {
    result: "pass",
    method: "copy release binaries into a clean local install root, execute CLI version, cold-start server and verify /health build identity",
    installRoot: path.relative(root, installDir),
    serverHealth: { service: "ynx-trust-center", commit: sourceCommit, release, buildTime: commitTime },
    signingClass: aggregateSigningClass(binaries)
  };
}

function assertBuildInfo(actual, commit, releaseName, buildTime, label) {
  if (!actual || actual.commit !== commit || actual.release !== releaseName || actual.buildTime !== buildTime) {
    throw new Error(`${label} build identity mismatch: ${JSON.stringify(actual)}`);
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function pollHealth(url, child) {
  let lastError = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Trust server exited before health: ${child.exitCode}`);
    try {
      return await getJSON(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Trust server health timed out: ${lastError}`);
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 1000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function detectSigningClass(binary, targetGOOS) {
  if (targetGOOS !== "darwin" || !commandExists("codesign")) return "unsigned-local";
  const result = spawnSync("codesign", ["-dv", "--verbose=4", binary], { encoding: "utf8" });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (/Signature=adhoc/i.test(output)) return "adhoc-local";
  if (result.status === 0) return "locally-signed-unclassified";
  return "unsigned-local";
}

function aggregateSigningClass(records) {
  const values = [...new Set(records.map((record) => record.signingClass))];
  return values.length === 1 ? values[0] : `mixed:${values.sort().join(",")}`;
}

function commandExists(command) {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
  return result.status === 0;
}

function runGovulncheck() {
  const versionResult = spawnSync("govulncheck", ["-version"], {
    cwd: root,
    env: buildEnvironment,
    encoding: "utf8"
  });
  if (versionResult.status !== 0) {
    return {
      command: "govulncheck -version",
      result: "fail",
      exitCode: versionResult.status,
      outputSha256: sha256Buffer(Buffer.from(`${versionResult.stdout || ""}\n${versionResult.stderr || ""}`))
    };
  }
  const result = spawnSync("govulncheck", ["./apps/trust-center", "./cmd/ynx-trust-backup", "./internal/trustproduct"], {
    cwd: root,
    env: buildEnvironment,
    encoding: "utf8"
  });
  return {
    toolVersion: `${versionResult.stdout || ""}\n${versionResult.stderr || ""}`.trim(),
    command: "govulncheck ./apps/trust-center ./cmd/ynx-trust-backup ./internal/trustproduct",
    result: result.status === 0 ? "pass" : "fail",
    exitCode: result.status,
    outputSha256: sha256Buffer(Buffer.from(`${result.stdout || ""}\n${result.stderr || ""}`))
  };
}

function deterministicTarGzip(directory, epochSeconds) {
  const files = walkFiles(directory).sort((a, b) => a.localeCompare(b));
  const chunks = [];
  for (const relative of files) {
    const absolute = path.join(directory, relative);
    const body = fs.readFileSync(absolute);
    const mode = relative.startsWith("bin/") ? 0o755 : 0o644;
    chunks.push(tarHeader(relative, body.length, mode, epochSeconds));
    chunks.push(body);
    const remainder = body.length % 512;
    if (remainder) chunks.push(Buffer.alloc(512 - remainder));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
}

function tarHeader(name, size, mode, mtime) {
  if (Buffer.byteLength(name) > 100) throw new Error(`tar path is too long: ${name}`);
  const header = Buffer.alloc(512, 0);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtime);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "root");
  writeString(header, 297, 32, "root");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeString(header, 148, 6, checksumText);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeString(buffer, offset, length, value) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

function writeOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  writeString(buffer, offset, length - 1, text);
  buffer[offset + length - 1] = 0;
}

function walkFiles(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(directory, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function fileRecord(file, relativePath) {
  return { path: relativePath.split(path.sep).join("/"), sha256: sha256File(file), bytes: fs.statSync(file).size };
}

function writeChecksums(baseDir, files) {
  const records = files.map((file) => `${sha256File(file)}  ${path.relative(baseDir, file).split(path.sep).join("/")}`)
    .sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(path.join(baseDir, "SHA256SUMS"), `${records.join("\n")}\n`, { encoding: "utf8", mode: 0o644 });
}
