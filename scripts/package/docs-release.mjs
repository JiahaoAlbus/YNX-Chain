#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDeterministicZip } from "../lib/deterministic-zip.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicInputs = [
  "docs/public",
  "docs/whitepaper/YNX_CHAIN_WHITEPAPER.md",
  "docs/whitepaper/STREAMBFT_SPECIFICATION.md",
  "docs/whitepaper/EXECUTION_AND_LOCAL_FEE_MARKETS.md",
  "docs/economics/YNXT_TOKENOMICS.md",
  "docs/economics/TREASURY_REVENUE_BURN.md",
  "docs/economics/PROOF_OF_SOLVENCY.md",
  "docs/economics/STAKING_LIQUID_STAKING_SAFETY_MODULE.md",
  "docs/stablecoin/STABLECOIN_RESERVE_REDEMPTION.md",
  "docs/security/SECURITY_PRIVACY_AI_GOVERNANCE.md",
  "docs/legal/TERMS_OF_USE_DRAFT.md",
  "docs/legal/PRIVACY_NOTICE_DRAFT.md",
  "docs/legal/ACCEPTABLE_USE_POLICY_DRAFT.md",
  "release/document-metadata-inventory.json",
  "release/public-product-metadata.json",
  "release/structured-data-suggestions.json",
  "release/facts/brand.json",
  "release/facts/claims.json",
  "release/facts/compliance.json",
  "release/facts/economics.json",
  "release/facts/faq.json",
  "release/facts/glossary.json",
  "release/facts/localization.json",
  "release/facts/network.json",
  "release/facts/public-urls.json",
  "release/facts/release-status.json",
  "release/facts/test.json",
  "release/evidence/website-public-acceptance-2026-07-26.json",
  "release/locales",
  "release/schemas",
];
const prohibitedPublicText = [
  /\bcodex\b/i,
  /\bbranch\b/i,
  /\/users\//i,
  /\bworktree\b/i,
  /\brefs\/heads\b/i,
  /\borigin\//i,
  /\blocalhost\b/i,
  /\b127\.0\.0\.1\b/i,
  /\bexample\.com\b/i,
];

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
  process.stdout.write("docs release package self-test passed\n");
  process.exit(0);
}

const outputIndex = args.indexOf("--output");
const outputDir = path.resolve(repoRoot, outputIndex >= 0 ? args[outputIndex + 1] : "tmp/packages/docs-release");
build(outputDir);

function build(outputDir) {
  assertCleanTrackedSource();
  const commit = git(["rev-parse", "HEAD"]);
  const commitTime = git(["show", "-s", "--format=%cI", commit]);
  const releaseStatus = readJson("release/facts/release-status.json");
  const entries = collectEntries();
  const bundleManifest = {
    schema: "ynx-public-docs-bundle/v1",
    package: "YNX Chain Website Content",
    release: releaseStatus.release,
    releaseClass: releaseStatus.releaseClass,
    sourceCommit: commit,
    sourceCommitTime: commitTime,
    publicReleaseStates: releaseStatus.states,
    files: entries.map((entry) => ({
      path: entry.name,
      bytes: entry.data.length,
      sha256: sha256(entry.data),
    })),
  };
  entries.push({
    name: "bundle-manifest.json",
    data: Buffer.from(`${JSON.stringify(bundleManifest, null, 2)}\n`),
  });
  const archive = createDeterministicZip(entries);
  const archiveName = `ynx-website-content-${commit.slice(0, 12)}.zip`;
  const artifactManifest = {
    schema: "ynx-public-docs-artifact/v1",
    package: bundleManifest.package,
    release: bundleManifest.release,
    sourceCommit: commit,
    sourceCommitTime: commitTime,
    archive: archiveName,
    bytes: archive.length,
    sha256: sha256(archive),
    productionSigned: false,
    downloadHosted: false,
  };

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, archiveName), archive);
  fs.writeFileSync(
    path.join(outputDir, "artifact-manifest.json"),
    `${JSON.stringify(artifactManifest, null, 2)}\n`,
  );
  process.stdout.write(`${archiveName}\nartifact-manifest.json\n`);
}

function collectEntries() {
  const files = publicInputs.flatMap((input) => {
    const absolute = path.join(repoRoot, input);
    if (!fs.existsSync(absolute)) throw new Error(`missing public package input: ${input}`);
    return fs.statSync(absolute).isDirectory() ? [...walk(absolute)] : [absolute];
  });
  const tracked = new Set(git(["ls-files", "--", ...publicInputs]).split("\n").filter(Boolean));
  return [...new Set(files)]
    .map((absolute) => {
      const name = path.relative(repoRoot, absolute).replaceAll(path.sep, "/");
      if (!tracked.has(name)) throw new Error(`refusing untracked public package input: ${name}`);
      const data = fs.readFileSync(absolute);
      inspectPublicText(name, data);
      return { name, data };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function inspectPublicText(name, data) {
  if (!/\.(json|md|txt|html|xml|ya?ml)$/i.test(name)) return;
  const text = data.toString("utf8");
  for (const pattern of prohibitedPublicText) {
    if (pattern.test(text)) throw new Error(`prohibited public reference ${pattern} in ${name}`);
  }
}

function assertCleanTrackedSource() {
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) throw new Error("refusing to build a publishable package from tracked dirty changes");
}

function git(arguments_) {
  return execFileSync("git", arguments_, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf8"));
}

function* walk(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(absolute);
    else if (entry.isFile()) yield absolute;
  }
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function selfTest() {
  const fixture = [
    { name: "b.txt", data: Buffer.from("beta\n") },
    { name: "a.txt", data: Buffer.from("alpha\n") },
  ];
  const first = createDeterministicZip(fixture);
  const second = createDeterministicZip([...fixture].reverse());
  if (!first.equals(second)) throw new Error("deterministic ZIP changed when input order changed");
  const changed = createDeterministicZip([
    fixture[0],
    { name: "a.txt", data: Buffer.from("changed\n") },
  ]);
  if (first.equals(changed)) throw new Error("deterministic ZIP ignored changed input");

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-docs-release-"));
  try {
    fs.writeFileSync(path.join(temporary, "first.zip"), first);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
