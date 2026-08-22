import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactRel = "release/integration/p0-wallet-connectivity/artifacts/wallet-auth-v2-runtime-closure-6cf3ef84";
const artifact = path.join(root, artifactRel);
const manifest = JSON.parse(fs.readFileSync(path.join(artifact, "manifest.json"), "utf8"));
const fail = (message) => { console.error(`FAIL ${message}`); process.exit(1); };
const hash = (file, algorithm = "sha256") => createHash(algorithm).update(fs.readFileSync(file)).digest("hex");

if (manifest.candidateCommit !== "6cf3ef845202bd879ed94515a71b323dd2fc9e14" || manifest.candidateWalletAuthTree !== "4c544d2e2ddb63caef536ea67c8f27b45044fd89") fail("candidate identity mismatch");
for (const item of manifest.files) {
  const file = path.join(artifact, item.path);
  if (!fs.existsSync(file) || fs.statSync(file).size !== item.bytes || hash(file) !== item.sha256) fail(`${item.path} bytes or SHA-256 mismatch`);
  if (item.sha512 && hash(file, "sha512") !== item.sha512) fail(`${item.path} SHA-512 mismatch`);
}
const sbom = JSON.parse(fs.readFileSync(path.join(artifact, "sbom.cdx.json"), "utf8"));
if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.5") fail("SBOM format mismatch");
const components = new Map(sbom.components.map((component) => [component.purl, component]));
for (const purl of ["pkg:npm/%40noble/curves@2.2.0", "pkg:npm/%40noble/hashes@2.2.0"]) if (!components.has(purl)) fail(`SBOM missing ${purl}`);

const runtimeArchive = path.join(artifact, "wallet-auth-v2-noble-runtime-closure-6cf3ef84.tar.gz");
const listing = spawnSync("tar", ["-tzf", runtimeArchive], { encoding: "utf8" });
if (listing.status !== 0) fail(`runtime archive unreadable: ${listing.stderr}`);
const paths = listing.stdout.trim().split("\n").filter(Boolean);
if (paths.some((entry) => entry.startsWith("/") || entry.split("/").includes("..") || !(["node_modules/", "node_modules/@noble/"].includes(entry) || entry.startsWith("node_modules/@noble/curves/") || entry.startsWith("node_modules/@noble/hashes/")))) fail("runtime archive contains unsafe or out-of-scope path");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-wallet-auth-runtime-artifact-"));
try {
  const extract = spawnSync("tar", ["-xzf", runtimeArchive, "-C", temp], { encoding: "utf8" });
  if (extract.status !== 0) fail(`runtime archive extraction failed: ${extract.stderr}`);
  const expected = fs.readFileSync(path.join(artifact, "unpacked-files.sha256"), "utf8").trim().split("\n");
  if (expected.length !== 211) fail("unpacked manifest entry count mismatch");
  for (const line of expected) {
    const match = /^([0-9a-f]{64})  (node_modules\/.+)$/.exec(line);
    if (!match || hash(path.join(temp, match[2])) !== match[1]) fail(`unpacked file mismatch: ${line}`);
  }
  const curves = JSON.parse(fs.readFileSync(path.join(temp, "node_modules/@noble/curves/package.json"), "utf8"));
  const hashes = JSON.parse(fs.readFileSync(path.join(temp, "node_modules/@noble/hashes/package.json"), "utf8"));
  if (curves.version !== "2.2.0" || curves.dependencies?.["@noble/hashes"] !== "2.2.0" || hashes.version !== "2.2.0" || Object.keys(hashes.dependencies ?? {}).length !== 0) fail("runtime dependency graph mismatch");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log(`PASS ${manifest.artifactId}: original npm tarballs, deterministic runtime archive, 211-file manifest and CycloneDX SBOM verified; deployment truth is governed separately by the consumed v7 lease and exact public evidence`);
