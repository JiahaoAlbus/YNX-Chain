#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const matrixPath = ".ai-bridge/full-goal-coverage.json";
const contractPath = "release/integration/docs-compliance-brand-contract.json";
const vectorsPath = "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json";
const releasePath = "release/product-release.json";
const allowedStatuses = new Set([
  "notStarted",
  "inProgress",
  "implementedLocal",
  "testedLocal",
  "integratedCentral",
  "testnetVerified",
  "publicVerified",
  "externalBlocked",
  "notApplicable",
  "verifiedComplete",
]);
const allowedPhases = new Set(["RECOVER", "PROTECT", "FREEZE", "INTEGRATE", "TESTNET", "PUBLIC", "EXPAND"]);
const evidenceStatuses = new Set([
  "implementedLocal",
  "testedLocal",
  "integratedCentral",
  "testnetVerified",
  "publicVerified",
  "verifiedComplete",
]);
const requiredEntryFields = [
  "id",
  "category",
  "requirement",
  "applicability",
  "applicabilityReason",
  "status",
  "evidence",
  "sourceCommit",
  "tests",
  "artifact",
  "publicProof",
  "blockedBy",
  "owner",
  "nextAction",
  "lastUpdated",
];
const requiredCoverageIds = [
  ...Array.from({ length: 22 }, (_, index) => `YNX18-C${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, index) => `YNX18-P${String(index + 1).padStart(2, "0")}`),
];

function isExternalReference(value) {
  return /^https?:\/\//.test(value) || /^git:/.test(value) || /^commit:/.test(value);
}

function validate(matrix, { checkFiles = true } = {}) {
  const failures = [];
  if (matrix?.schemaVersion !== "1.0.0") failures.push("matrix schemaVersion must be 1.0.0");
  if (matrix?.productNumber !== 18) failures.push("matrix productNumber must be 18");
  if (matrix?.productSlug !== "docs-compliance-brand") failures.push("matrix productSlug must be docs-compliance-brand");
  if (matrix?.worktree !== "/Users/huangjiahao/Desktop/YNX Final Worktrees/18-docs-compliance") failures.push("matrix worktree does not match YNX 18");
  if (matrix?.branch !== "codex/final-docs-compliance") failures.push("matrix branch does not match YNX 18");
  if (!allowedPhases.has(matrix?.currentPhase)) failures.push("matrix currentPhase is invalid");
  if (!["active", "blocked", "complete"].includes(matrix?.goalStatus)) failures.push("matrix goalStatus is invalid");
  if (!Array.isArray(matrix?.entries) || matrix.entries.length === 0) failures.push("matrix entries must be non-empty");

  const ids = new Set();
  for (const [index, entry] of (matrix?.entries ?? []).entries()) {
    const label = entry?.id || `entry[${index}]`;
    for (const field of requiredEntryFields) {
      if (!(field in (entry ?? {}))) failures.push(`${label} is missing ${field}`);
    }
    if (ids.has(entry?.id)) failures.push(`duplicate coverage id: ${entry.id}`);
    ids.add(entry?.id);
    if (!allowedStatuses.has(entry?.status)) failures.push(`${label} has invalid status: ${entry?.status}`);
    if (!["applicable", "notApplicable"].includes(entry?.applicability)) failures.push(`${label} has invalid applicability`);
    if (!/^[0-9a-f]{40}$/.test(entry?.sourceCommit ?? "")) failures.push(`${label} sourceCommit must be an exact 40-character commit`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.lastUpdated ?? "")) failures.push(`${label} lastUpdated must be YYYY-MM-DD`);
    for (const field of ["evidence", "tests", "artifact", "publicProof", "blockedBy"]) {
      if (!Array.isArray(entry?.[field])) failures.push(`${label} ${field} must be an array`);
    }
    if (evidenceStatuses.has(entry?.status) && (entry?.evidence?.length ?? 0) === 0) failures.push(`${label} requires evidence for status ${entry.status}`);
    if (entry?.status === "publicVerified" && (entry?.publicProof?.length ?? 0) === 0) failures.push(`${label} requires publicProof for publicVerified`);
    if (entry?.status === "externalBlocked" && (entry?.blockedBy?.length ?? 0) === 0) failures.push(`${label} requires blockedBy for externalBlocked`);
    if (entry?.status === "notApplicable" && entry?.applicability !== "notApplicable") failures.push(`${label} must set applicability=notApplicable`);
    if (entry?.status !== "notApplicable" && entry?.applicability === "notApplicable") failures.push(`${label} applicability conflicts with status`);
    if (typeof entry?.owner !== "string" || entry.owner.trim() === "") failures.push(`${label} owner must be non-empty`);
    if (typeof entry?.nextAction !== "string" || entry.nextAction.trim() === "") failures.push(`${label} nextAction must be non-empty`);

    if (checkFiles) {
      for (const reference of [...(entry?.evidence ?? []), ...(entry?.tests ?? []), ...(entry?.artifact ?? [])]) {
        if (typeof reference !== "string" || reference.trim() === "") {
          failures.push(`${label} contains an empty reference`);
          continue;
        }
        if (!isExternalReference(reference) && !fs.existsSync(path.resolve(reference))) failures.push(`${label} references missing local evidence: ${reference}`);
      }
    }
  }

  for (const id of requiredCoverageIds) {
    if (!ids.has(id)) failures.push(`missing required coverage id: ${id}`);
  }
  if (matrix?.goalStatus === "complete") {
    for (const entry of matrix?.entries ?? []) {
      if (!["verifiedComplete", "externalBlocked", "notApplicable"].includes(entry.status)) failures.push(`complete goal contains unfinished entry: ${entry.id}`);
    }
  }
  return failures;
}

function validateIntegration(matrix, contract, vectors, release) {
  const failures = [];
  if (contract?.schemaVersion !== "1.0.0") failures.push("integration contract schemaVersion must be 1.0.0");
  if (contract?.contractVersion !== "0.1.1-candidate") failures.push("integration contractVersion is invalid");
  if (contract?.productNumber !== 18 || contract?.productSlug !== matrix.productSlug) failures.push("integration contract product identity does not match coverage matrix");
  if (contract?.sourceCommit !== matrix.sourceCommit) failures.push("integration contract sourceCommit does not match coverage matrix");
  if (!Array.isArray(contract?.canonicalEvents) || contract.canonicalEvents.length !== 0) failures.push("YNX 18 must not claim ownership of Data Fabric canonical events");
  if (!Array.isArray(contract?.errorCodes) || contract.errorCodes.length < 6) failures.push("integration contract error codes are incomplete");
  for (const artifact of Object.values(contract?.artifacts ?? {})) {
    if (typeof artifact !== "string" || !fs.existsSync(path.resolve(artifact))) failures.push(`integration contract references missing artifact: ${artifact}`);
  }
  const stateKeys = ["implementedLocal", "testedLocal", "installedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"];
  for (const key of stateKeys) {
    if (contract?.releaseStates?.[key] !== release?.states?.[key]) failures.push(`integration contract release state differs from product release: ${key}`);
  }
  if (vectors?.schemaVersion !== "1.0.0" || vectors?.contractVersion !== contract?.contractVersion) failures.push("cross-product vectors do not match the contract version");
  if (vectors?.sourceCommit !== matrix.sourceCommit) failures.push("cross-product vectors sourceCommit does not match coverage matrix");
  if (!Array.isArray(vectors?.vectors) || vectors.vectors.length < 12) failures.push("cross-product vectors must contain at least 12 cases");
  const vectorIds = new Set();
  for (const vector of vectors?.vectors ?? []) {
    if (!/^YNX18-V\d{2}$/.test(vector?.id ?? "")) failures.push(`invalid vector id: ${vector?.id}`);
    if (vectorIds.has(vector?.id)) failures.push(`duplicate vector id: ${vector.id}`);
    vectorIds.add(vector?.id);
    if (!vector?.expected && !vector?.expectedError) failures.push(`${vector?.id} must define expected or expectedError`);
  }
  return failures;
}

function runSelfTest(matrix) {
  const cases = [
    {
      name: "duplicate id",
      mutate(candidate) { candidate.entries[1].id = candidate.entries[0].id; },
      expected: "duplicate coverage id",
    },
    {
      name: "invalid status",
      mutate(candidate) { candidate.entries[0].status = "done"; },
      expected: "invalid status",
    },
    {
      name: "public proof missing",
      mutate(candidate) {
        const entry = candidate.entries.find((item) => item.status === "publicVerified");
        entry.publicProof = [];
      },
      expected: "requires publicProof",
    },
    {
      name: "external blocker missing",
      mutate(candidate) {
        const entry = candidate.entries.find((item) => item.status === "externalBlocked");
        entry.blockedBy = [];
      },
      expected: "requires blockedBy",
    },
  ];
  const failures = [];
  for (const testCase of cases) {
    const candidate = structuredClone(matrix);
    testCase.mutate(candidate);
    const result = validate(candidate, { checkFiles: false });
    if (!result.some((message) => message.includes(testCase.expected))) failures.push(`self-test did not reject ${testCase.name}`);
  }
  return failures;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    process.stderr.write(`cannot read ${file}: ${error.message}\n`);
    process.exit(1);
  }
}

const matrix = readJson(matrixPath);
const contract = readJson(contractPath);
const vectors = readJson(vectorsPath);
const release = readJson(releasePath);
const failures = [...validate(matrix), ...validateIntegration(matrix, contract, vectors, release)];
if (process.argv.includes("--self-test")) failures.push(...runSelfTest(matrix));
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

const counts = Object.fromEntries([...allowedStatuses].map((status) => [status, matrix.entries.filter((entry) => entry.status === status).length]));
process.stdout.write(`full goal coverage gate passed: ${matrix.entries.length} entries, phase ${matrix.currentPhase}, goal ${matrix.goalStatus}, statuses ${JSON.stringify(counts)}\n`);
