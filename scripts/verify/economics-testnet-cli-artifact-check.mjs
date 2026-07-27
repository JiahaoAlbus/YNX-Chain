import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(2));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-economics-testnet-cli-"));
const buildA = path.join(temporary, "build-a");
const buildB = path.join(temporary, "build-b");
const installRoot = path.join(temporary, "install");
const installedBin = path.join(installRoot, "bin");
const statePath = path.join(temporary, "state", "economics-integration-store.json");
const evidencePath = path.join(temporary, "state", "local-testnet-evidence.json");
const storeSourceCommit = "72591ce6ab9eb4ae7878fcf6369c9aac37e7fba9";

try {
  const manifestA = buildArtifact(buildA, sourceCommit);
  const manifestB = buildArtifact(buildB, sourceCommit);
  assert.deepEqual(manifestB, manifestA, "two artifact manifests differ");
  compareArtifactFiles(buildA, buildB, manifestA.files);

  fs.mkdirSync(installedBin, { recursive: true, mode: 0o755 });
  const installed = [];
  for (const file of manifestA.files.filter((entry) => entry.path.startsWith("bin/"))) {
    const source = path.join(buildA, file.path);
    const target = path.join(installedBin, path.basename(file.path));
    fs.copyFileSync(source, target);
    fs.chmodSync(target, 0o755);
    assert.equal(hashFile(target), file.sha256, `installed binary hash changed: ${file.path}`);
    assert.equal((fs.statSync(target).mode & 0o777), 0o755, `installed binary mode changed: ${file.path}`);
    installed.push(path.basename(file.path));
  }
  installed.sort();

  const economics = runJSON(path.join(installedBin, "ynx-economics-runtime"), [
    "-input",
    path.join(root, "economics/examples/runtime-replay.json"),
  ]);
  assert.equal(economics.stateHash, "sha256:54e5f96297e88f260ef2be35ac0dea6d3c534c731bdd34f0f3c7083412544e09");

  const staking = runJSON(path.join(installedBin, "ynx-staking-risk-runtime"), [
    "-input",
    path.join(root, "economics/examples/staking-risk-runtime-replay.json"),
  ]);
  assert.equal(staking.stateHash, "sha256:702b746f252e323573fc8605da697a285f612959542b03d0a5dee86a029c7764");

  const store = runJSON(path.join(installedBin, "ynx-economics-integration-store"), [
    "-state",
    statePath,
    "-economics-input",
    path.join(root, "economics/examples/runtime-replay.json"),
    "-staking-input",
    path.join(root, "economics/examples/staking-risk-runtime-replay.json"),
    "-source-commit",
    storeSourceCommit,
    "-ingested-at",
    "2026-08-04T00:00:00Z",
    "-summary",
  ]);
  assert.equal(store.storeStateHash, "sha256:c4673098638660439cc69a5bbef21239e034c92a18d4b77c46ca9398022b41ed");
  assert.equal((fs.statSync(statePath).mode & 0o777), 0o600, "installed Store did not persist mode 0600");

  const localEvidence = runJSON(path.join(installedBin, "ynx-economics-local-testnet-evidence"), [
    "-store",
    statePath,
    "-source-commit",
    storeSourceCommit,
    "-generated-at",
    "2026-08-04T01:00:00Z",
    "-height",
    "6423",
    "-nonce",
    "1",
    "-out",
    evidencePath,
    "-summary",
  ]);
  assert.equal(localEvidence.transactionId, "econ-local-tx-abbeda604c4fae1d357982ad6bb1011e3d134fa437eb0c52e91464d41704aa70");
  assert.equal(localEvidence.blockHash, "sha256:cb1eebecdd4708636da415bd9a79d67ef6eec519d1b5cb8358d7363ab750ed4a");
  assert.equal(localEvidence.evidenceHash, "sha256:ed2ac4a7dc035a3dddaa021e09763526d74cd72cc3a3ea77faee45ce8fa91348");
  assert.equal(localEvidence.sharedTestnet, false);
  assert.equal(localEvidence.publicDeployment, false);
  assert.equal(localEvidence.production, false);
  assert.equal((fs.statSync(evidencePath).mode & 0o777), 0o600, "installed evidence CLI did not persist mode 0600");

  let outputManifest = null;
  if (options.outDir) {
    outputManifest = buildArtifact(path.resolve(root, options.outDir), sourceCommit);
    assert.deepEqual(outputManifest, manifestA, "output artifact differs from verified build");
  }

  fs.rmSync(installRoot, { recursive: true, force: true });
  assert.equal(fs.existsSync(installRoot), false, "transient installation was not removed");

  const evidence = {
    schemaVersion: 1,
    evidenceClass: "local-unsigned-testnet-cli-artifact",
    generatedAt: manifestA.generatedAt,
    sourceCommit,
    storeSourceCommit,
    artifact: {
      id: manifestA.artifactId,
      path: options.outDir ?? null,
      target: manifestA.target,
      toolchain: manifestA.toolchain,
      packageHash: manifestA.packageHash,
      files: manifestA.files,
      signingClass: manifestA.signingClass,
      immutableDownloadURL: null,
    },
    reproducibility: {
      buildAEqualsBuildB: true,
      cgoEnabled: false,
      trimpath: true,
      buildVCS: false,
      buildID: "empty",
    },
    installation: {
      executed: true,
      transient: true,
      prefixClass: "temporary-user-controlled-prefix",
      installedBinaries: installed,
      executableMode: "0755",
      removalVerified: true,
    },
    coldStart: {
      economicsStateHash: economics.stateHash,
      stakingStateHash: staking.stateHash,
      storeStateHash: store.storeStateHash,
      transactionId: localEvidence.transactionId,
      blockHash: localEvidence.blockHash,
      evidenceHash: localEvidence.evidenceHash,
    },
    releaseTruth: {
      installedLocal: true,
      sharedTestnet: false,
      deployedPublic: false,
      downloadHosted: false,
      productionSigned: false,
      storeReleased: false,
    },
  };
  if (options.evidence) {
    const target = path.resolve(root, options.evidence);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
  }
  console.log(`economics Testnet CLI artifact verified: source=${sourceCommit} package=${manifestA.packageHash} binaries=${installed.length} installedLocal=true productionSigned=false`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function buildArtifact(out, sourceCommit) {
  const result = spawnSync("node", [
    "./scripts/release/build-economics-testnet-cli.mjs",
    "--out",
    out,
    "--source-commit",
    sourceCommit,
  ], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || "artifact build failed");
  return JSON.parse(result.stdout);
}

function compareArtifactFiles(firstRoot, secondRoot, files) {
  for (const file of files) {
    const first = fs.readFileSync(path.join(firstRoot, file.path));
    const second = fs.readFileSync(path.join(secondRoot, file.path));
    assert.deepEqual(second, first, `artifact file differs across builds: ${file.path}`);
  }
  assert.deepEqual(
    fs.readFileSync(path.join(secondRoot, "manifest.json")),
    fs.readFileSync(path.join(firstRoot, "manifest.json")),
    "manifest bytes differ across builds",
  );
}

function runJSON(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed`);
  return JSON.parse(result.stdout);
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument: ${key ?? ""}`);
    parsed[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return parsed;
}
