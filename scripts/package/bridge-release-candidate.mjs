#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.cwd());
const sha256 = body => crypto.createHash("sha256").update(body).digest("hex");
const canonicalJSON = value => `${JSON.stringify(value, null, 2)}\n`;
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });

function parseArguments(argv) {
  let output = "tmp/bridge-release-candidate";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--output" || !argv[index + 1]) throw new Error("usage: bridge-release-candidate.mjs [--output <directory>]");
    output = argv[index + 1];
    index += 1;
  }
  return { output: path.resolve(root, output) };
}

function assertSafeOutput(output) {
  const allowed = [path.join(root, "tmp"), path.resolve(os.tmpdir())];
  if (!allowed.some(candidate => output === candidate || output.startsWith(`${candidate}${path.sep}`))) {
    throw new Error("Bridge release candidate output must be under repository tmp/ or the system temporary directory");
  }
}

function fileRecord(directory, file) {
  const body = fs.readFileSync(path.join(directory, file));
  return { file, bytes: body.length, sha256: sha256(body) };
}

function writeFile(directory, file, body, mode = 0o644) {
  const target = path.join(directory, file);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  fs.writeFileSync(target, body, { mode });
}

function buildBinary(temp, output, { goos, goarch, filename }, commit, release, buildTime) {
  const ldflags = `-s -w -buildid= -X main.buildCommit=${commit} -X main.buildRelease=${release} -X main.buildTime=${buildTime}`;
  const builds = [];
  for (const iteration of ["first", "second"]) {
    const target = path.join(temp, `${filename}-${iteration}`);
    execFileSync("go", ["build", "-buildvcs=false", "-trimpath", "-ldflags", ldflags, "-o", target, "./cmd/ynx-bridged"], {
      cwd: root,
      env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    builds.push({ target, body: fs.readFileSync(target) });
  }
  const firstHash = sha256(builds[0].body);
  const secondHash = sha256(builds[1].body);
  if (firstHash !== secondHash) throw new Error(`non-reproducible Bridge binary for ${goos}/${goarch}: ${firstHash} != ${secondHash}`);
  const destination = path.join(output, filename);
  fs.copyFileSync(builds[0].target, destination);
  fs.chmodSync(destination, 0o755);
  const sbom = `ynx-bridge-sbom-${goos}-${goarch}.spdx.json`;
  execFileSync(process.execPath, [
    path.join(root, "scripts/package/bridge-sbom.mjs"),
    destination,
    path.join(output, sbom),
    commit,
    release,
    buildTime,
    `${goos}/${goarch}`,
    "unsigned-testnet-candidate"
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return { filename, platform: `${goos}/${goarch}`, sha256: firstHash, sbom };
}

function packSDK(temp, output, version) {
  const packs = [];
  for (const iteration of ["first", "second"]) {
    const directory = path.join(temp, `sdk-${iteration}`);
    fs.mkdirSync(directory, { recursive: true });
    const raw = execFileSync("npm", ["pack", "--json", "--pack-destination", directory], {
      cwd: path.join(root, "sdk/bridge"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const result = JSON.parse(raw);
    if (!Array.isArray(result) || result.length !== 1 || !result[0]?.filename) throw new Error("npm pack did not produce exactly one Bridge SDK package");
    const source = path.join(directory, result[0].filename);
    packs.push({ source, body: fs.readFileSync(source), metadata: result[0] });
  }
  const firstHash = sha256(packs[0].body);
  const secondHash = sha256(packs[1].body);
  if (firstHash !== secondHash) throw new Error(`non-reproducible Bridge SDK package: ${firstHash} != ${secondHash}`);
  const filename = `ynx-bridge-sdk-${version}.tgz`;
  fs.copyFileSync(packs[0].source, path.join(output, filename));
  fs.chmodSync(path.join(output, filename), 0o644);
  return { filename, sha256: firstHash, bytes: packs[0].body.length };
}

export function buildBridgeReleaseCandidate({ output }) {
  assertSafeOutput(output);
  const commit = run("git", ["rev-parse", "HEAD"]).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("invalid source commit");
  const buildTime = new Date(run("git", ["show", "-s", "--format=%cI", commit]).trim()).toISOString();
  const sdkPackage = JSON.parse(fs.readFileSync(path.join(root, "sdk/bridge/package.json"), "utf8"));
  const release = `ynx-bridge-${commit.slice(0, 12)}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-bridge-release-"));
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true, mode: 0o755 });
  try {
    const platforms = [
      { goos: "linux", goarch: "amd64", filename: `ynx-bridged-${commit.slice(0, 12)}-linux-amd64` },
      { goos: "darwin", goarch: "arm64", filename: `ynx-bridged-${commit.slice(0, 12)}-darwin-arm64` }
    ];
    const binaries = platforms.map(platform => buildBinary(temp, output, platform, commit, release, buildTime));
    const sdk = packSDK(temp, output, sdkPackage.version);
    const install = `# YNX Bridge ${commit.slice(0, 12)} unsigned Testnet candidate\n\nThis package is for integration and verification only. It is not production-signed, not Mainnet-ready, and does not enable public mutation, external submission, or user asset movement.\n\n## Verify\n\nRun \`shasum -a 256 -c SHA256SUMS\` from the candidate directory.\n\n## Configuration check\n\nSet operator-controlled Testnet configuration, then run the platform binary with \`--check-config\`. Never embed API keys, relayer private keys, Wallet secrets, seed phrases, or signing authority in client applications.\n\n## Cold start\n\nBind the coordinator to loopback, use a mode-0600 state path, and verify \`GET /health\` and \`GET /version\`. Public clients must use the canonical App Gateway or the scoped read-only TLS surface.\n\n## Truth boundary\n\nThe candidate contains a coordinator, read-only SDK and evidence tooling. No approved executable YNX route, verified funded deposit, verified funded withdrawal, production signer ceremony, independent security acceptance, or canonical/light-client Bridge proof is included.\n`;
    writeFile(output, "INSTALL.md", install);
    fs.copyFileSync(path.join(root, "docs/bridge/THIRD_PARTY_NOTICES.md"), path.join(output, "THIRD_PARTY_NOTICES.md"));
    fs.chmodSync(path.join(output, "THIRD_PARTY_NOTICES.md"), 0o644);

    const initialFiles = fs.readdirSync(output).filter(file => fs.statSync(path.join(output, file)).isFile()).sort();
    const initialRecords = initialFiles.map(file => fileRecord(output, file));
    const provenance = {
      _type: "https://in-toto.io/Statement/v1",
      predicateType: "https://slsa.dev/provenance/v1",
      subject: initialRecords.map(({ file, sha256: digest }) => ({ name: file, digest: { sha256: digest } })),
      predicate: {
        buildDefinition: {
          buildType: "https://ynxweb4.com/build-types/bridge-unsigned-testnet-candidate/v1",
          externalParameters: { sourceCommit: commit, release, platforms: binaries.map(({ platform }) => platform), sdkVersion: sdkPackage.version },
          internalParameters: { cgoEnabled: false, trimpath: true, buildVcs: false, signingClass: "unsigned-testnet-candidate" },
          resolvedDependencies: [
            { uri: "git+https://github.com/JiahaoAlbus/YNX-Chain", digest: { gitCommit: commit } },
            { uri: "pkg:golang/stdlib", digest: { version: run("go", ["env", "GOVERSION"]).trim() } },
            { uri: "pkg:npm/@ynx-chain/bridge-sdk", digest: { version: sdkPackage.version } }
          ]
        },
        runDetails: {
          builder: { id: "https://github.com/JiahaoAlbus/YNX-Chain/blob/main/scripts/package/bridge-release-candidate.mjs" },
          metadata: { invocationId: `${release}-deterministic`, startedOn: buildTime, finishedOn: buildTime },
          byproducts: []
        },
        truthBoundary: {
          releaseClass: "unsigned-testnet-candidate",
          productionSigned: false,
          externalSubmissionEnabled: false,
          userAssetMovementEnabled: false,
          testnetVerified: false,
          mainnetReleased: false
        }
      }
    };
    writeFile(output, "provenance.json", canonicalJSON(provenance));

    const payloadFiles = fs.readdirSync(output).filter(file => fs.statSync(path.join(output, file)).isFile()).sort();
    const payloadRecords = payloadFiles.map(file => fileRecord(output, file));
    const manifest = {
      schemaVersion: 1,
      product: "YNX Bridge & Interoperability",
      productNumber: "21",
      release,
      sourceCommit: commit,
      buildTime,
      signingClass: "unsigned-testnet-candidate",
      productionSigned: false,
      executableYnxRouteAvailable: false,
      externalSubmissionEnabled: false,
      userAssetMovementEnabled: false,
      fundedDepositVerified: false,
      fundedWithdrawalVerified: false,
      testnetVerified: false,
      mainnetReleased: false,
      reproducibleBuilds: { binaries: true, sdk: true },
      binaries,
      sdk,
      files: payloadRecords
    };
    writeFile(output, "artifact-manifest.json", canonicalJSON(manifest));
    const checksumFiles = fs.readdirSync(output).filter(file => file !== "SHA256SUMS" && fs.statSync(path.join(output, file)).isFile()).sort();
    const sums = checksumFiles.map(file => `${fileRecord(output, file).sha256}  ${file}`).join("\n");
    writeFile(output, "SHA256SUMS", `${sums}\n`);
    return { output, manifest };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildBridgeReleaseCandidate(parseArguments(process.argv.slice(2)));
  process.stdout.write(`Bridge release candidate generated: ${result.output}\n${canonicalJSON({ release: result.manifest.release, sourceCommit: result.manifest.sourceCommit, files: result.manifest.files.length })}`);
}
