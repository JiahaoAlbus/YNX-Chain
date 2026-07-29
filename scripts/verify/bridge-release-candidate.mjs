#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const sha256 = body => crypto.createHash("sha256").update(body).digest("hex");
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const fail = message => { throw new Error(message); };

function parseArguments(argv) {
  let candidate = "tmp/bridge-release-candidate";
  let sourceRoot = ".";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--candidate" && value) candidate = value;
    else if (argv[index] === "--source-root" && value) sourceRoot = value;
    else throw new Error("usage: bridge-release-candidate.mjs [--candidate <directory>] [--source-root <directory>]");
    index += 1;
  }
  return { candidate: path.resolve(candidate), sourceRoot: path.resolve(sourceRoot) };
}

function record(directory, file) {
  const body = fs.readFileSync(path.join(directory, file));
  return { file, bytes: body.length, sha256: sha256(body) };
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to reserve release verification port"));
        return;
      }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function temporaryRelayerRegistry() {
  const registry = {};
  for (const name of ["relayer-a", "relayer-b"]) {
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" });
    registry[name] = Buffer.from(jwk.x, "base64url").toString("base64");
  }
  return JSON.stringify(registry);
}

function fixtureEnvironment(statePath) {
  const operatorAccess = crypto.randomBytes(24).toString("hex");
  const gatewayAccess = crypto.randomBytes(24).toString("hex");
  const quoteSeal = crypto.randomBytes(32).toString("hex");
  return {
    ...process.env,
    YNX_BRIDGE_STATE_PATH: statePath,
    YNX_BRIDGE_API_KEY: operatorAccess,
    YNX_BRIDGE_GATEWAY_API_KEY: gatewayAccess,
    YNX_BRIDGE_QUOTE_SEAL_KEY: quoteSeal,
    YNX_BRIDGE_RELAYER_THRESHOLD: "2",
    YNX_BRIDGE_RELAYERS_JSON: temporaryRelayerRegistry(),
    YNX_BRIDGE_ROUTE_POLICIES_JSON: '[{"provider":"release-verification","classification":"external-bridge-adapter","sourceChain":"ethereum-sepolia","destinationChain":"ynx_6423-1","sourceAsset":"sepolia-usdc","destinationAsset":"ynx-usdc","sourceAssetClass":"testnet-stablecoin","destinationAssetClass":"wrapped-test-asset","minConfirmations":12,"maxAmount":"1000","maxOutstanding":"1000","dailyLimit":"2000","userOutstandingLimit":"1000","largeTransferThreshold":"500","largeTransferDelaySeconds":3600,"assetBoundary":"canonical-to-represented","externalSubmission":false}]'
  };
}

function currentPlatformBinary(manifest) {
  const platform = process.platform === "darwin" && process.arch === "arm64"
    ? "darwin/arm64"
    : process.platform === "linux" && process.arch === "x64"
      ? "linux/amd64"
      : null;
  if (!platform) fail(`unsupported release verification host ${process.platform}/${process.arch}`);
  const binary = manifest.binaries.find(candidate => candidate.platform === platform);
  if (!binary) fail(`candidate is missing host binary ${platform}`);
  return binary.filename;
}

async function verifyColdStart(binary, manifest, temp) {
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}`;
  const env = fixtureEnvironment(path.join(temp, "cold-start-state.json"));
  execFileSync(binary, ["--check-config", "--http", `127.0.0.1:${port}`], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  const child = spawn(binary, ["--http", `127.0.0.1:${port}`], { env, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    let health;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const response = await fetch(`${url}/health`);
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch {}
      if (child.exitCode !== null) break;
      await sleep(10);
    }
    if (!health) fail(`candidate cold start failed: ${stderr.slice(0, 500)}`);
    const versionResponse = await fetch(`${url}/version`);
    if (!versionResponse.ok) fail(`candidate version endpoint returned ${versionResponse.status}`);
    const version = await versionResponse.json();
    const buildCommit = String(version.build?.commit || "");
    if (!buildCommit.startsWith(manifest.sourceCommit.slice(0, 12))) fail(`candidate build commit mismatch: ${buildCommit}`);
    if (version.build?.release !== manifest.release) fail(`candidate release mismatch: ${version.build?.release}`);
    if (version.liveBridge !== false || version.externalSubmissionEnabled !== false) fail("candidate cold start overclaims executable Bridge state");
    return { platform: `${process.platform}/${process.arch}`, health: true, version: true, buildCommit, release: version.build.release };
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), sleep(2000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}

function verifySDKInstall(candidate, manifest, temp) {
  const sdk = path.join(candidate, manifest.sdk.filename);
  const installRoot = path.join(temp, "sdk-install");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(path.join(installRoot, "package.json"), '{"name":"bridge-release-verification","private":true,"type":"module"}\n');
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", sdk], { cwd: installRoot, stdio: ["ignore", "pipe", "pipe"] });
  const script = "import {YNXBridgeClient,bridgeTransferAvailability} from '@ynx-chain/bridge-sdk'; const client=new YNXBridgeClient({baseURL:'https://rest.ynxweb4.com/app/bridge/'}); const state=bridgeTransferAvailability({phase:'destination_mint_release_confirmed',destinationAssetAvailable:false,updatedAt:'2026-07-29T00:00:00Z',stateMachineVersion:'ynx.bridge.lifecycle.v1'}); if(!client||state.assetAvailable!==false) process.exit(1); console.log('sdk import and fail-closed availability passed');";
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: installRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!output.includes("fail-closed availability passed")) fail("installed SDK did not pass import and fail-closed classification");
  return { installed: true, imported: true, destinationConfirmationAvailable: false };
}

export async function verifyBridgeReleaseCandidate({ candidate, sourceRoot }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate, "artifact-manifest.json"), "utf8"));
  const provenance = JSON.parse(fs.readFileSync(path.join(candidate, "provenance.json"), "utf8"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }).trim();
  if (manifest.schemaVersion !== 1 || manifest.productNumber !== "21" || manifest.sourceCommit !== commit || manifest.release !== `ynx-bridge-${commit.slice(0, 12)}`) fail("candidate manifest source identity is invalid");
  for (const key of ["productionSigned", "executableYnxRouteAvailable", "externalSubmissionEnabled", "userAssetMovementEnabled", "fundedDepositVerified", "fundedWithdrawalVerified", "testnetVerified", "mainnetReleased"]) {
    if (manifest[key] !== false) fail(`candidate truth boundary ${key} must remain false`);
  }
  if (manifest.signingClass !== "unsigned-testnet-candidate" || manifest.reproducibleBuilds?.binaries !== true || manifest.reproducibleBuilds?.sdk !== true || manifest.binaries?.length !== 2) fail("candidate reproducibility or signing boundary is invalid");

  const manifestFiles = new Map(manifest.files.map(entry => [entry.file, entry]));
  if (manifestFiles.size !== manifest.files.length) fail("candidate manifest contains duplicate files");
  for (const entry of manifest.files) {
    const actual = record(candidate, entry.file);
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) fail(`candidate file mismatch: ${entry.file}`);
  }

  const checksumLines = fs.readFileSync(path.join(candidate, "SHA256SUMS"), "utf8").trim().split("\n");
  const checksumFiles = new Set();
  for (const line of checksumLines) {
    const match = /^([0-9a-f]{64})  ([^/]+)$/.exec(line);
    if (!match || checksumFiles.has(match[2])) fail(`invalid SHA256SUMS line: ${line}`);
    checksumFiles.add(match[2]);
    if (record(candidate, match[2]).sha256 !== match[1]) fail(`SHA256SUMS mismatch: ${match[2]}`);
  }
  const expectedChecksumFiles = fs.readdirSync(candidate).filter(file => file !== "SHA256SUMS" && fs.statSync(path.join(candidate, file)).isFile()).sort();
  if (JSON.stringify([...checksumFiles].sort()) !== JSON.stringify(expectedChecksumFiles)) fail("SHA256SUMS coverage is incomplete");

  if (provenance._type !== "https://in-toto.io/Statement/v1" || provenance.predicateType !== "https://slsa.dev/provenance/v1" || provenance.predicate?.buildDefinition?.externalParameters?.sourceCommit !== commit || provenance.predicate?.truthBoundary?.productionSigned !== false || provenance.predicate?.truthBoundary?.externalSubmissionEnabled !== false || provenance.predicate?.truthBoundary?.userAssetMovementEnabled !== false || provenance.predicate?.truthBoundary?.testnetVerified !== false || provenance.predicate?.truthBoundary?.mainnetReleased !== false) fail("candidate provenance is invalid or overclaims release state");
  for (const subject of provenance.subject || []) {
    if (record(candidate, subject.name).sha256 !== subject.digest?.sha256) fail(`provenance subject mismatch: ${subject.name}`);
  }
  for (const binary of manifest.binaries) {
    const sbom = JSON.parse(fs.readFileSync(path.join(candidate, binary.sbom), "utf8"));
    if (sbom.spdxVersion !== "SPDX-2.3" || sbom.packages?.length !== 2 || sbom.artifact?.sha256 !== binary.sha256 || sbom.artifact?.platform !== binary.platform || sbom.artifact?.signingClass !== "unsigned-testnet-candidate" || sbom.artifact?.installedLocal !== false || sbom.artifact?.deployedPublic !== false) fail(`candidate SBOM invalid: ${binary.sbom}`);
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-bridge-release-verify-"));
  try {
    const downloaded = path.join(temp, "downloaded");
    fs.cpSync(candidate, downloaded, { recursive: true });
    for (const file of fs.readdirSync(candidate)) {
      if (fs.statSync(path.join(candidate, file)).isFile() && record(candidate, file).sha256 !== record(downloaded, file).sha256) fail(`downloaded-byte verification failed: ${file}`);
    }
    const sdkInstall = verifySDKInstall(downloaded, manifest, temp);
    const hostBinary = path.join(downloaded, currentPlatformBinary(manifest));
    fs.chmodSync(hostBinary, 0o755);
    const coldStart = await verifyColdStart(hostBinary, manifest, temp);
    return { sourceCommit: commit, release: manifest.release, files: expectedChecksumFiles.length + 1, sdkInstall, coldStart };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyBridgeReleaseCandidate(parseArguments(process.argv.slice(2)));
  process.stdout.write(`Bridge release candidate verified: ${JSON.stringify(result)}\n`);
}
