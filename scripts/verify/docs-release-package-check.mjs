#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDeterministicZip, readStoredZip } from "../lib/deterministic-zip.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requiredBundleInputs = [
  "docs/public/PUBLIC_BRAND_FACTS.md",
  "docs/public/FAQ.md",
  "release/public-product-metadata.json",
  "release/facts/release-status.json",
  "release/locales/ar.json",
  "release/schemas/public-record.schema.json",
];
const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
  process.stdout.write("docs release package verifier self-test passed\n");
  process.exit(0);
}

const packageDir = path.resolve(repoRoot, args[0] || "tmp/packages/docs-release");
validatePackage(packageDir);
process.stdout.write(`docs release package verified: ${packageDir}\n`);

function validatePackage(packageDir, expectedCommit = git(["rev-parse", "HEAD"])) {
  const artifactPath = path.join(packageDir, "artifact-manifest.json");
  if (!fs.existsSync(artifactPath)) throw new Error("missing artifact-manifest.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (artifact.schema !== "ynx-public-docs-artifact/v1") throw new Error("invalid artifact schema");
  if (artifact.sourceCommit !== expectedCommit) throw new Error("artifact source commit does not match HEAD");
  if (artifact.productionSigned !== false || artifact.downloadHosted !== false) {
    throw new Error("local candidate must not claim signing or hosted download");
  }

  const archivePath = path.join(packageDir, artifact.archive);
  if (!fs.existsSync(archivePath)) throw new Error(`missing archive: ${artifact.archive}`);
  const archive = fs.readFileSync(archivePath);
  if (artifact.bytes !== archive.length) throw new Error("archive byte count mismatch");
  if (artifact.sha256 !== sha256(archive)) throw new Error("archive SHA-256 mismatch");

  const entries = readStoredZip(archivePath);
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  if (byName.size !== entries.length) throw new Error("archive contains duplicate entries");
  const manifestBody = byName.get("bundle-manifest.json");
  if (!manifestBody) throw new Error("archive lacks bundle-manifest.json");
  const manifest = JSON.parse(manifestBody.toString("utf8"));
  if (manifest.schema !== "ynx-public-docs-bundle/v1") throw new Error("invalid bundle schema");
  if (manifest.sourceCommit !== expectedCommit) throw new Error("bundle source commit does not match HEAD");

  const recorded = new Map(manifest.files.map((entry) => [entry.path, entry]));
  for (const [name, data] of byName) {
    if (name === "bundle-manifest.json") continue;
    const entry = recorded.get(name);
    if (!entry) throw new Error(`bundle manifest omits ${name}`);
    if (entry.bytes !== data.length) throw new Error(`bundle byte count mismatch: ${name}`);
    if (entry.sha256 !== sha256(data)) throw new Error(`bundle SHA-256 mismatch: ${name}`);
    recorded.delete(name);
  }
  if (recorded.size > 0) throw new Error(`bundle manifest references missing file: ${recorded.keys().next().value}`);

  for (const required of requiredBundleInputs) {
    if (!byName.has(required)) throw new Error(`bundle lacks required website input: ${required}`);
  }
}

function git(arguments_) {
  return execFileSync("git", arguments_, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function selfTest() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-docs-package-check-"));
  try {
    const expectedCommit = "a".repeat(40);
    const sources = requiredBundleInputs.map((name) => ({
      name,
      data: Buffer.from(`fixture for ${name}\n`),
    }));
    const bundleManifest = Buffer.from(`${JSON.stringify({
      schema: "ynx-public-docs-bundle/v1",
      sourceCommit: expectedCommit,
      files: sources.map(({ name, data }) => ({
        path: name,
        bytes: data.length,
        sha256: sha256(data),
      })),
    })}\n`);
    const archive = createDeterministicZip([...sources, { name: "bundle-manifest.json", data: bundleManifest }]);
    const archiveName = "fixture.zip";
    fs.writeFileSync(path.join(temporary, archiveName), archive);
    fs.writeFileSync(path.join(temporary, "artifact-manifest.json"), `${JSON.stringify({
      schema: "ynx-public-docs-artifact/v1",
      sourceCommit: expectedCommit,
      archive: archiveName,
      bytes: archive.length,
      sha256: sha256(archive),
      productionSigned: false,
      downloadHosted: false,
    })}\n`);
    validatePackage(temporary, expectedCommit);

    const tampered = Buffer.from(archive);
    tampered[40] ^= 1;
    fs.writeFileSync(path.join(temporary, archiveName), tampered);
    let failedForTamper = false;
    try {
      validatePackage(temporary, expectedCommit);
    } catch {
      failedForTamper = true;
    }
    if (!failedForTamper) throw new Error("verifier accepted a tampered archive");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
