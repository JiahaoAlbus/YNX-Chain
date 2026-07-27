import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(2));
if (!options.out || !options.sourceCommit) {
  fail("usage: node scripts/release/build-economics-testnet-cli.mjs --out <directory> --source-commit <40-char commit>");
}
if (!/^[0-9a-f]{40}$/.test(options.sourceCommit)) fail("source commit must be 40 lowercase hex characters");
verifyCommit(options.sourceCommit);

const goos = goEnv("GOOS");
const goarch = goEnv("GOARCH");
const goVersion = execFileSync("go", ["version"], { cwd: root, encoding: "utf8" }).trim();
const generatedAt = execFileSync("git", ["show", "-s", "--format=%cI", options.sourceCommit], { cwd: root, encoding: "utf8" }).trim();
const artifactId = `ynxt-economics-testnet-cli-${goos}-${goarch}`;
const out = path.resolve(root, options.out);
const binDir = path.join(out, "bin");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(binDir, { recursive: true, mode: 0o755 });

const binaries = [
  ["ynx-economics-integration-store", "./cmd/ynx-economics-integration-store"],
  ["ynx-economics-local-testnet-evidence", "./cmd/ynx-economics-local-testnet-evidence"],
  ["ynx-economics-runtime", "./cmd/ynx-economics-runtime"],
  ["ynx-economics-shared-testnet-acceptance", "./cmd/ynx-economics-shared-testnet-acceptance"],
  ["ynx-staking-risk-runtime", "./cmd/ynx-staking-risk-runtime"],
];

for (const [name, packagePath] of binaries) {
  const target = path.join(binDir, name);
  const result = spawnSync("go", ["build", "-trimpath", "-buildvcs=false", "-ldflags=-buildid=", "-o", target, packagePath], {
    cwd: root,
    env: { ...process.env, CGO_ENABLED: "0" },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) fail(result.stderr || `go build failed for ${packagePath}`);
  fs.chmodSync(target, 0o755);
}

const readme = [
  "YNXT Economics Testnet CLI Artifact",
  "",
  `Artifact: ${artifactId}`,
  `Source commit: ${options.sourceCommit}`,
  `Target: ${goos}/${goarch}`,
  `Toolchain: ${goVersion}`,
  "Signing class: unsigned_local_testnet_cli",
  "",
  "This package is for local and YNX Testnet verification only.",
  "It is not production-signed, publicly hosted, store-released, or evidence of shared-Testnet acceptance.",
  "Install by copying the required binaries from bin/ into a user-controlled executable directory.",
  "Do not grant these tools signer, Treasury, custody, validator, provider, or production credentials.",
  "",
].join("\n");
fs.writeFileSync(path.join(out, "README.txt"), readme, { mode: 0o644 });

const files = walkFiles(out)
  .filter((relative) => relative !== "manifest.json")
  .sort()
  .map((relative) => fileEvidence(out, relative));
const packageHash = canonicalHash({
  schemaVersion: 1,
  artifactId,
  sourceCommit: options.sourceCommit,
  target: { goos, goarch },
  signingClass: "unsigned_local_testnet_cli",
  files,
});
const manifest = {
  schemaVersion: 1,
  artifactId,
  generatedAt,
  sourceCommit: options.sourceCommit,
  target: { goos, goarch },
  toolchain: goVersion,
  build: {
    cgoEnabled: false,
    trimpath: true,
    buildVCS: false,
    buildID: "empty",
  },
  signingClass: "unsigned_local_testnet_cli",
  immutableDownloadURL: null,
  productionSigned: false,
  sharedTestnetEvidence: false,
  packageHash,
  files,
};
fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify(manifest));

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail(`invalid argument: ${key ?? ""}`);
    parsed[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return parsed;
}

function verifyCommit(commit) {
  const result = spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: root });
  if (result.status !== 0) fail(`source commit does not exist: ${commit}`);
}

function goEnv(name) {
  return execFileSync("go", ["env", name], { cwd: root, encoding: "utf8" }).trim();
}

function walkFiles(directory, relative = "") {
  const output = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(directory, next));
    else if (entry.isFile()) output.push(next.split(path.sep).join("/"));
    else fail(`artifact contains unsupported file type: ${next}`);
  }
  return output;
}

function fileEvidence(directory, relative) {
  const absolute = path.join(directory, relative);
  const bytes = fs.readFileSync(absolute);
  return {
    path: relative,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    mode: (fs.statSync(absolute).mode & 0o777).toString(8).padStart(4, "0"),
  };
}

function canonicalHash(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
