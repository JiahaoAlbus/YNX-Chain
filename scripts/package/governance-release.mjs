import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const outDir = process.argv[2];
if (!outDir || !path.isAbsolute(outDir)) {
  console.error("usage: node scripts/package/governance-release.mjs <absolute-output-directory>");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty) throw new Error("governance release packaging requires a clean worktree");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const commitTime = execFileSync("git", ["show", "-s", "--format=%cI", commit], { encoding: "utf8" }).trim();
const goVersion = execFileSync("go", ["version"], { encoding: "utf8" }).trim();
const goEnv = JSON.parse(execFileSync("go", ["env", "-json", "GOOS", "GOARCH", "GOVERSION", "CGO_ENABLED"], { encoding: "utf8" }));

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
const artifacts = [
  { name: "ynx-governanced", source: "./cmd/ynx-governanced" },
  { name: "ynx-governance-state", source: "./cmd/ynx-governance-state" }
];
const buildEnv = { ...process.env, CGO_ENABLED: "0", SOURCE_DATE_EPOCH: String(Math.floor(new Date(commitTime).getTime() / 1000)) };
for (const artifact of artifacts) {
  execFileSync("go", ["build", "-trimpath", "-o", path.join(outDir, artifact.name), artifact.source], { env: buildEnv, stdio: "inherit" });
}

const modules = execFileSync("go", ["list", "-m", "-f", "{{json .}}", "all"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const components = modules.filter((module) => module.Path && module.Version).map((module) => ({
  type: "library",
  name: module.Path,
  version: module.Version,
  purl: `pkg:golang/${encodeURIComponent(module.Path)}@${encodeURIComponent(module.Version)}`,
  licenses: [{ license: { id: directLicense(module.Path) } }]
})).sort((a, b) => a.name.localeCompare(b.name));
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${uuidFromCommit(commit)}`,
  version: 1,
  metadata: { timestamp: commitTime, component: { type: "application", name: "ynx-governance", version: commit } },
  components
};
writeJSON(path.join(outDir, "governance-sbom.cdx.json"), sbom);
fs.copyFileSync("docs/governance/THIRD_PARTY_NOTICES.md", path.join(outDir, "THIRD_PARTY_NOTICES.md"));

const records = artifacts.map((artifact) => fileRecord(outDir, artifact.name));
records.push(fileRecord(outDir, "governance-sbom.cdx.json"));
records.push(fileRecord(outDir, "THIRD_PARTY_NOTICES.md"));
for (const artifact of artifacts) {
  fs.writeFileSync(path.join(outDir, `${artifact.name}.go-version.txt`), execFileSync("go", ["version", "-m", path.join(outDir, artifact.name)], { encoding: "utf8" }), { mode: 0o600 });
  records.push(fileRecord(outDir, `${artifact.name}.go-version.txt`));
}
records.sort((a, b) => a.file.localeCompare(b.file));
const manifest = {
  schemaVersion: "ynx-governance-artifact-provenance/v1",
  sourceCommit: commit,
  sourceCommitTime: commitTime,
  generatedAt: new Date().toISOString(),
  builder: { goVersion, goos: goEnv.GOOS, goarch: goEnv.GOARCH, cgoEnabled: false, trimpath: true },
  signingClass: "unsigned-local-development",
  minimumOS: `${goEnv.GOOS}/${goEnv.GOARCH}; minimum version not established`,
  installedLocal: false,
  deployedStaging: false,
  deployedPublic: false,
  downloadHosted: false,
  productionSigned: false,
  reproducibility: "binary byte identity is checked separately by governance-check.sh on one builder",
  artifacts: records
};
writeJSON(path.join(outDir, "provenance.json"), manifest);
console.log(JSON.stringify(manifest, null, 2));

function directLicense(modulePath) {
  if (modulePath === "github.com/cometbft/cometbft") return "Apache-2.0";
  if (modulePath === "github.com/decred/dcrd/dcrec/secp256k1/v4") return "ISC";
  if (modulePath === "golang.org/x/crypto") return "BSD-3-Clause";
  return "NOASSERTION";
}
function fileRecord(directory, file) {
  const body = fs.readFileSync(path.join(directory, file));
  return { file, bytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") };
}
function uuidFromCommit(value) {
  const hex = crypto.createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
function writeJSON(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
