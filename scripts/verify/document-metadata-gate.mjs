#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const inventoryPath = "release/document-metadata-inventory.json";
const allowedAuthorityClasses = new Set([
  "technical-whitepaper",
  "economics-disclosure",
  "security-privacy-governance",
  "legal-draft",
  "brand-guidance",
]);

function normalize(value) {
  return String(value ?? "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMetadataTable(text) {
  const metadata = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!match) continue;
    const key = normalize(match[1]);
    const value = normalize(match[2]);
    if (key === "Metadata" || key === "---") continue;
    metadata[key] = value;
  }
  return metadata;
}

function validate(inventory, { checkFiles = true, contentOverrides = new Map() } = {}) {
  const failures = [];
  if (inventory?.schemaVersion !== "1.0.0") failures.push("inventory schemaVersion must be 1.0.0");
  if (inventory?.productNumber !== 18) failures.push("inventory productNumber must be 18");
  if (inventory?.productSlug !== "docs-compliance-brand") failures.push("inventory productSlug is invalid");
  if (!/^[0-9a-f]{40}$/.test(inventory?.sourceCommit ?? "")) failures.push("inventory sourceCommit must be an exact commit");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inventory?.lastUpdated ?? "")) failures.push("inventory lastUpdated must be YYYY-MM-DD");
  if (!Array.isArray(inventory?.requiredMetadataFields) || inventory.requiredMetadataFields.length !== 7) failures.push("inventory must define seven required metadata fields");
  if (!Array.isArray(inventory?.documents) || inventory.documents.length < 5) failures.push("inventory must contain at least five high-authority documents");

  const ids = new Set();
  const paths = new Set();
  for (const [index, document] of (inventory?.documents ?? []).entries()) {
    const label = document?.id || `document[${index}]`;
    if (ids.has(document?.id)) failures.push(`duplicate document id: ${document.id}`);
    ids.add(document?.id);
    if (paths.has(document?.path)) failures.push(`duplicate document path: ${document.path}`);
    paths.add(document?.path);
    if (!allowedAuthorityClasses.has(document?.authorityClass)) failures.push(`${label} has invalid authorityClass`);
    if (!document?.path?.startsWith("docs/") || !document.path.endsWith(".md")) failures.push(`${label} path must be a Markdown document under docs/`);
    if (!document?.metadata || typeof document.metadata !== "object") failures.push(`${label} metadata must be an object`);
    for (const field of inventory?.requiredMetadataFields ?? []) {
      if (typeof document?.metadata?.[field] !== "string" || document.metadata[field].trim() === "") failures.push(`${label} is missing metadata field ${field}`);
    }
    if (!/^[0-9a-f]{40}$/.test(document?.metadata?.["Source commit"] ?? "")) failures.push(`${label} Source commit must be an exact commit`);
    if (!/^\d+\.\d+\.\d+-candidate$/.test(document?.metadata?.Version ?? "")) failures.push(`${label} Version must be a candidate semantic version`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(document?.metadata?.["Last reviewed"] ?? "")) failures.push(`${label} Last reviewed must be YYYY-MM-DD`);
    if (document?.metadata?.["Product release"] !== inventory?.productRelease) failures.push(`${label} Product release differs from inventory`);
    if (document?.changeLogVersion !== document?.metadata?.Version) failures.push(`${label} changeLogVersion differs from Version`);
    if (!Array.isArray(document?.publicEvidence) || document.publicEvidence.length === 0) failures.push(`${label} publicEvidence must be non-empty`);

    if (!checkFiles) continue;
    const resolved = path.resolve(document.path ?? "");
    if (!fs.existsSync(resolved)) {
      failures.push(`${label} document does not exist: ${document.path}`);
      continue;
    }
    for (const evidence of document.publicEvidence ?? []) {
      if (typeof evidence !== "string" || !fs.existsSync(path.resolve(evidence))) failures.push(`${label} references missing evidence: ${evidence}`);
    }
    const text = contentOverrides.get(document.path) ?? fs.readFileSync(resolved, "utf8");
    const parsed = parseMetadataTable(text);
    for (const field of inventory.requiredMetadataFields ?? []) {
      const expected = normalize(document.metadata[field]);
      const actual = normalize(parsed[field]);
      if (actual !== expected) failures.push(`${label} metadata mismatch for ${field}: expected "${expected}", got "${actual}"`);
    }
    if (!text.includes("## Change log")) failures.push(`${label} lacks Change log heading`);
    if (!text.includes(`- ${document.changeLogVersion} (`)) failures.push(`${label} lacks change-log entry for ${document.changeLogVersion}`);
  }
  return failures;
}

function runSelfTest(inventory) {
  const failures = [];
  const cases = [
    {
      name: "duplicate document path",
      mutate(candidate) { candidate.documents[1].path = candidate.documents[0].path; },
      expected: "duplicate document path",
      options: { checkFiles: false },
    },
    {
      name: "invalid source commit",
      mutate(candidate) { candidate.documents[0].metadata["Source commit"] = "latest"; },
      expected: "Source commit must be an exact commit",
      options: { checkFiles: false },
    },
    {
      name: "metadata mismatch",
      mutate(candidate) {
        candidate.documents[0].metadata.Version = "9.9.9-candidate";
        candidate.documents[0].changeLogVersion = "9.9.9-candidate";
      },
      expected: "metadata mismatch for Version",
      options: { checkFiles: true },
    },
    {
      name: "missing change log",
      mutate(candidate, options) {
        const document = candidate.documents[0];
        const text = fs.readFileSync(document.path, "utf8").replace("## Change log", "## Revision notes");
        options.contentOverrides = new Map([[document.path, text]]);
      },
      expected: "lacks Change log heading",
      options: { checkFiles: true },
    },
  ];
  for (const testCase of cases) {
    const candidate = structuredClone(inventory);
    const options = { ...testCase.options };
    testCase.mutate(candidate, options);
    const result = validate(candidate, options);
    if (!result.some((message) => message.includes(testCase.expected))) failures.push(`self-test did not reject ${testCase.name}`);
  }
  return failures;
}

let inventory;
try {
  inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
} catch (error) {
  process.stderr.write(`cannot read ${inventoryPath}: ${error.message}\n`);
  process.exit(1);
}

const failures = validate(inventory);
if (process.argv.includes("--self-test")) failures.push(...runSelfTest(inventory));
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`document metadata gate passed: ${inventory.documents.length} high-authority documents, ${inventory.requiredMetadataFields.length} required metadata fields, product release ${inventory.productRelease}\n`);
