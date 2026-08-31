#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const RELEASE_STATES = [
  "implementedLocal",
  "testedLocal",
  "installedLocal",
  "integratedCentral",
  "deployedStaging",
  "deployedPublic",
  "downloadHosted",
  "productionSigned",
  "storeReleased",
];

const EVIDENCE_FILES = [
  "FEATURE_COMPLETION_EVIDENCE.md",
  "EVIDENCE_INDEX.md",
  "UI_DESIGN_AUDIT.md",
  "MIGRATION_COMPATIBILITY.md",
  "OBSERVABILITY.md",
  "RELEASE_NOTES.md",
  "OPERATIONS.md",
  "SLO_CAPACITY_PLAN.md",
  "UNIT_ECONOMICS.md",
];

const SELF_AUDIT_PATHS = new Set([
  "docs/coordination/FABLE5_TOTAL_ACCEPTANCE_AUDIT.md",
  "release/integration/fable5-total-acceptance-audit.json",
  "scripts/audit-fable5-products.mjs",
]);

const PRODUCT_PATH_HINTS = {
  "01": ["chain", "chain-core"], "02": ["wallet", "auth"], "03": ["social"],
  "04": ["pay"], "05": ["merchant-console"], "06": ["card"], "07": ["exchange"],
  "08": ["quant"], "09": ["shop"], "10": ["seller-console"], "11": ["developer"],
  "12": ["explorer"], "13": ["monitor"], "14": ["ai"], "15": ["trust-center"],
  "16": ["resource-market"], "17": ["economics", "tokenomics", "treasury", "stablecoin"],
  "18": ["docs-compliance", "whitepaper", "compliance", "brand"], "19": ["oracle"],
  "20": ["cloud"], "21": ["bridge"], "22": ["browser"], "23": ["search"],
  "24": ["finance"], "25": ["mail"], "26": ["data-fabric"], "27": ["dex"],
  "28": ["website"], "29": ["integration"], "30": ["security"], "31": ["governance"],
  "32": ["music"], "33": ["video"], "34": ["creator-studio"], "35": ["docs"],
  "36": ["calendar"],
};

function usage() {
  console.error("usage: audit-fable5-products.mjs <Fable5.md> <output.json>");
  process.exit(2);
}

function runGit(worktree, args) {
  try {
    return execFileSync("git", ["-C", worktree, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function gitSucceeds(worktree, args) {
  try {
    execFileSync("git", ["-C", worktree, ...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runGitStatus(worktree) {
  try {
    return execFileSync("git", ["-C", worktree, "status", "--porcelain=v1"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).replace(/\n$/, "");
  } catch {
    return null;
  }
}

function isEvidenceOnlyPath(path) {
  if (path.startsWith("docs/") || path.startsWith("release/") || path.startsWith(".ai-bridge/")) return true;
  if (["product-release.json", "public-product-metadata.json"].includes(path)) return true;
  if (/^apps\/[^/]+\/(product-release\.json|public-product-metadata\.json)$/.test(path)) return true;
  if (/(^|\/)tests?\//.test(path)) return true;
  if (/(^|\/)[^/]+_test\.go$/.test(path)) return true;
  if (/(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return true;
  return /^apps\/[^/]+\/(FEATURE_COMPLETION_EVIDENCE|EVIDENCE_INDEX|UI_DESIGN_AUDIT|MIGRATION_COMPATIBILITY|OBSERVABILITY|RELEASE_NOTES|OPERATIONS|SLO_CAPACITY_PLAN|UNIT_ECONOMICS|FABLE5_REQUIREMENTS)\.md$/.test(path);
}

function runtimeBinding(worktree, sourceCommit, head) {
  if (!sourceCommit || !head) return { bound: false, exactHead: false, evidenceOnlyCommits: false, changedPaths: [] };
  if (sourceCommit === head) return { bound: true, exactHead: true, evidenceOnlyCommits: true, changedPaths: [] };
  if (!gitSucceeds(worktree, ["merge-base", "--is-ancestor", sourceCommit, head])) {
    return { bound: false, exactHead: false, evidenceOnlyCommits: false, changedPaths: [] };
  }
  const changedPaths = (runGit(worktree, ["diff", "--name-only", `${sourceCommit}..${head}`]) || "")
    .split("\n")
    .filter(Boolean);
  const evidenceOnlyCommits = changedPaths.length > 0 && changedPaths.every(isEvidenceOnlyPath);
  return {
    bound: evidenceOnlyCommits,
    exactHead: false,
    evidenceOnlyCommits,
    changedPathCount: changedPaths.length,
    changedPathSample: changedPaths.slice(0, 20),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function walkFiles(root, maximumDepth = 4) {
  const result = [];
  const visit = (directory, depth) => {
    if (depth > maximumDepth) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if ([".git", "node_modules", "dist", "build", ".next", ".cache"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, depth + 1);
      else if (entry.isFile()) result.push(path);
    }
  };
  visit(root, 0);
  return result;
}

function readJson(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function normalizedStates(record) {
  const nested = record.releaseStates && typeof record.releaseStates === "object" ? record.releaseStates : {};
  return Object.fromEntries(
    RELEASE_STATES.map((key) => [key, record[key] === true || nested[key] === true]),
  );
}

function extractSections(source) {
  const marker = /^# (\d{2})｜(.+)$/gm;
  const found = [...source.matchAll(marker)];
  return found.map((match, index) => {
    const start = match.index;
    const end = index + 1 < found.length ? found[index + 1].index : source.length;
    const body = source.slice(start, end);
    const worktree = body.match(/Worktree：\s*\n\s*([^\n]+)/)?.[1]?.trim() || null;
    const branch = body.match(/Branch：\s*\n\s*([^\n]+)/)?.[1]?.trim() || null;
    const productRequirements = body
      .split("\n")
      .filter((line) => /^\s*-\s+/.test(line) || /^\s*\d+\.\s+/.test(line)).length;
    return {
      number: match[1],
      title: match[2].trim(),
      expectedWorktree: worktree,
      expectedBranch: branch,
      specificationSha256: sha256(body),
      enumeratedRequirementLines: productRequirements,
    };
  });
}

if (process.argv.length !== 4) usage();
const specificationPath = resolve(process.argv[2]);
const outputPath = resolve(process.argv[3]);
if (!existsSync(specificationPath) || !statSync(specificationPath).isFile()) usage();

const source = readFileSync(specificationPath, "utf8");
const sections = extractSections(source);
if (sections.length !== 36) {
  throw new Error(`expected 36 Fable5 product sections, found ${sections.length}`);
}

const products = sections.map((section) => {
  const worktreeExists = Boolean(section.expectedWorktree && existsSync(section.expectedWorktree));
  const branch = worktreeExists ? runGit(section.expectedWorktree, ["branch", "--show-current"]) : null;
  const head = worktreeExists ? runGit(section.expectedWorktree, ["rev-parse", "HEAD"]) : null;
  const status = worktreeExists ? runGitStatus(section.expectedWorktree) : null;
  const dirtyEntries = status
    ? status
        .split("\n")
        .filter(Boolean)
        .filter((entry) => !SELF_AUDIT_PATHS.has(entry.slice(3)))
    : [];
  const files = worktreeExists ? walkFiles(section.expectedWorktree) : [];
  const hints = PRODUCT_PATH_HINTS[section.number] || [];
  const releasePaths = files.filter((path) => {
    if (!path.endsWith("product-release.json")) return false;
    const local = relative(section.expectedWorktree, path).replaceAll("\\", "/");
    if (local === "product-release.json" || local === "release/product-release.json") return true;
    const segments = local.toLowerCase().split("/");
    return hints.some((hint) => segments.includes(hint));
  });
  const releaseRecords = releasePaths.map((path) => {
    const parsed = readJson(path);
    if (!parsed.ok) return { path, validJson: false, error: parsed.error };
    const record = parsed.value;
    const sourceCommit = record.sourceCommit || record.commit || null;
    const states = normalizedStates(record);
    const binding = runtimeBinding(section.expectedWorktree, sourceCommit, head);
    const allReleaseStatesTrue = RELEASE_STATES.every((key) => states[key]);
    return {
      path,
      validJson: true,
      productId: record.productId || null,
      name: record.name || null,
      sourceCommit,
      sourceBoundToHead: binding.exactHead,
      currentRuntimeSourceBound: binding.bound,
      evidenceOnlyCommitsAfterRuntimeSource: binding.evidenceOnlyCommits,
      changedPathCountAfterRuntimeSource: binding.changedPathCount || 0,
      changedPathSampleAfterRuntimeSource: binding.changedPathSample || [],
      states,
      allReleaseStatesTrue,
      publicUrls: Array.isArray(record.publicUrls) ? record.publicUrls : [],
      healthUrls: Array.isArray(record.healthUrls) ? record.healthUrls : [],
    };
  });
  const evidence = Object.fromEntries(
    EVIDENCE_FILES.map((name) => [name, files.filter((path) => path.endsWith(`/${name}`))]),
  );
  const exactRecords = releaseRecords.filter((record) => record.validJson && record.currentRuntimeSourceBound);
  const exactAllTrue = exactRecords.some((record) => record.allReleaseStatesTrue);
  return {
    ...section,
    worktreeExists,
    actualBranch: branch,
    head,
    clean: dirtyEntries.length === 0,
    dirtyEntries,
    branchMatchesSpecification: branch === section.expectedBranch,
    releaseRecords,
    currentRuntimeBoundReleaseRecords: releaseRecords.filter(
      (record) => record.validJson && record.currentRuntimeSourceBound,
    ).length,
    evidence,
    completionVerdict: exactAllTrue
      ? "requires-independent-runtime-and-artifact-verification"
      : "not-proven-complete",
  };
});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  specification: {
    path: specificationPath,
    sha256: sha256(source),
    productSections: sections.length,
  },
  acceptanceRule:
    "A folder, branch, release record, local test, HTTP 200 or screenshot is insufficient. Completion requires an exact-HEAD-bound record, all nine directly evidenced release states, and independent runtime/artifact verification.",
  aggregate: {
    products: products.length,
    worktreesPresent: products.filter((product) => product.worktreeExists).length,
    cleanWorktrees: products.filter((product) => product.clean).length,
    specificationBranchMatches: products.filter((product) => product.branchMatchesSpecification).length,
    productsWithCurrentRuntimeBoundReleaseRecord: products.filter(
      (product) => product.currentRuntimeBoundReleaseRecords > 0,
    ).length,
    productsProvenComplete: products.filter(
      (product) => product.completionVerdict === "proven-complete",
    ).length,
  },
  products,
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.aggregate));
