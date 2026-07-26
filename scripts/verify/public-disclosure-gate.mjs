#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const loaded = new Map();
const factIndexPath = "release/facts/authoritative-facts.json";
const requiredRecordKeys = [
  "brand", "network", "release", "economics", "compliance", "publicUrls",
  "evidence", "claims", "glossary", "faq", "localization", "supersededFacts"
];
const releaseStateKeys = [
  "implementedLocal", "testedLocal", "installedLocal", "integratedCentral",
  "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"
];

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return typeof relativePath === "string" && relativePath.length > 0 && fs.existsSync(absolute(relativePath));
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(relativePath) {
  if (loaded.has(relativePath)) return loaded.get(relativePath);
  if (!exists(relativePath)) {
    failures.push(`missing referenced JSON: ${relativePath}`);
    loaded.set(relativePath, null);
    return null;
  }
  try {
    const value = JSON.parse(fs.readFileSync(absolute(relativePath), "utf8"));
    loaded.set(relativePath, value);
    return value;
  } catch (error) {
    failures.push(`invalid JSON ${relativePath}: ${error.message}`);
    loaded.set(relativePath, null);
    return null;
  }
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validateSchemaReference(relativePath, value) {
  if (!value || typeof value.$schema !== "string") {
    failures.push(`${relativePath} lacks a local $schema reference`);
    return;
  }
  if (/^https?:\/\//i.test(value.$schema)) return;
  const schemaPath = path.normalize(path.join(path.dirname(relativePath), value.$schema));
  expect(exists(schemaPath), `${relativePath} references missing schema ${schemaPath}`);
}

function validateBase(relativePath, value, canonicalCommit) {
  if (!value) return;
  validateSchemaReference(relativePath, value);
  expect(value.schemaVersion === "1.0.0", `${relativePath} must use schemaVersion 1.0.0`);
  expect(typeof value.version === "string" && value.version.length > 0, `${relativePath} lacks version`);
  expect(/^[0-9a-f]{40}$/.test(value.sourceCommit ?? ""), `${relativePath} sourceCommit must be an exact 40-hex Git SHA`);
  expect(value.sourceCommit === canonicalCommit, `${relativePath} sourceCommit differs from authoritative index`);
  expect(validDate(value.lastReviewed), `${relativePath} has invalid lastReviewed date`);
  expect(typeof value.status === "string" && value.status.length > 0, `${relativePath} lacks status`);
}

function validateEvidenceLocations(owner, locations) {
  expect(Array.isArray(locations) && locations.length > 0, `${owner} lacks evidence locations`);
  if (!Array.isArray(locations)) return;
  for (const location of locations) {
    expect(exists(location), `${owner} references missing evidence location ${location}`);
  }
}

const index = readJson(factIndexPath);
if (index) {
  validateSchemaReference(factIndexPath, index);
  const canonicalCommit = index.sourceCommit;
  expect(/^[0-9a-f]{40}$/.test(canonicalCommit ?? ""), `${factIndexPath} sourceCommit must be an exact 40-hex Git SHA`);
  expect(index.schemaVersion === "1.0.0", `${factIndexPath} must use schemaVersion 1.0.0`);
  expect(validDate(index.lastReviewed), `${factIndexPath} has invalid lastReviewed date`);
  expect(index.status === "Candidate", `${factIndexPath} must remain Candidate until central integration and public deployment evidence exist`);

  const records = index.records ?? {};
  for (const key of requiredRecordKeys) {
    const recordPath = records[key];
    expect(typeof recordPath === "string", `${factIndexPath} lacks records.${key}`);
    expect(/^release\/facts\/[a-z0-9-]+\.json$/.test(recordPath ?? ""), `${factIndexPath} records.${key} must point inside release/facts`);
    const record = readJson(recordPath);
    validateBase(recordPath, record, canonicalCommit);
  }

  const factFiles = fs.existsSync(absolute("release/facts"))
    ? fs.readdirSync(absolute("release/facts")).filter((name) => name.endsWith(".json")).sort()
    : [];
  for (const name of factFiles) {
    const relativePath = `release/facts/${name}`;
    validateBase(relativePath, readJson(relativePath), canonicalCommit);
  }

  const release = readJson(records.release);
  if (release) {
    for (const key of releaseStateKeys) {
      expect(typeof release.states?.[key] === "boolean", `${records.release} state ${key} must be boolean`);
      expect(Array.isArray(release.stateEvidence?.[key]), `${records.release} stateEvidence.${key} must be an array`);
      if (release.states?.[key] === true) {
        validateEvidenceLocations(`${records.release} state ${key}`, release.stateEvidence?.[key]);
      }
    }
    expect(release.states?.implementedLocal === true, `${records.release} implementedLocal must remain evidence-bound true`);
    expect(release.states?.testedLocal === true, `${records.release} testedLocal must remain evidence-bound true`);
    for (const key of releaseStateKeys.filter((key) => !["implementedLocal", "testedLocal", "integratedCentral", "deployedPublic"].includes(key))) {
      expect(release.states?.[key] === false, `${records.release} ${key} must remain false without stronger evidence`);
    }
    expect(release.states?.integratedCentral === true, `${records.release} integratedCentral must match Website owner acceptance evidence`);
    expect(release.states?.deployedPublic === true, `${records.release} deployedPublic must match direct production-route evidence`);
  }

  const claims = readJson(records.claims);
  const claimIds = new Set();
  if (claims) {
    expect(Array.isArray(claims.highRiskTerms) && claims.highRiskTerms.length > 0, `${records.claims} lacks highRiskTerms`);
    expect(Array.isArray(claims.claims) && claims.claims.length > 0, `${records.claims} lacks claims`);
    for (const claim of claims.claims ?? []) {
      expect(/^CLM-\d{3}$/.test(claim.claimId ?? ""), `invalid claimId ${claim.claimId ?? "<missing>"}`);
      expect(!claimIds.has(claim.claimId), `duplicate claimId ${claim.claimId}`);
      claimIds.add(claim.claimId);
      expect(claim.sourceCommit === canonicalCommit, `${claim.claimId} sourceCommit differs from authoritative index`);
      expect(validDate(claim.asOf), `${claim.claimId} has invalid asOf date`);
      expect(validDate(claim.expiry), `${claim.claimId} has invalid expiry date`);
      if (validDate(claim.asOf) && validDate(claim.expiry)) {
        expect(Date.parse(claim.expiry) >= Date.parse(claim.asOf), `${claim.claimId} expires before its asOf date`);
      }
      expect(["approved", "approved_with_qualifier", "blocked"].includes(claim.reviewStatus), `${claim.claimId} has invalid reviewStatus`);
      validateEvidenceLocations(claim.claimId, claim.evidenceLocation);
      expect(typeof claim.allowedWording === "string" && claim.allowedWording.length > 0, `${claim.claimId} lacks allowedWording`);
      expect(Array.isArray(claim.forbiddenWording), `${claim.claimId} forbiddenWording must be an array`);
      if (claim.reviewStatus === "blocked") {
        expect(claim.forbiddenWording.length > 0, `${claim.claimId} blocked claim lacks forbidden wording`);
      } else {
        const exactClaim = String(claim.exactClaim ?? "").toLowerCase();
        for (const term of claims.highRiskTerms ?? []) {
          expect(!exactClaim.includes(String(term).toLowerCase()), `${claim.claimId} approves unqualified high-risk term ${term}`);
        }
      }
    }
  }

  const faq = readJson(records.faq);
  if (faq) {
    const faqIds = new Set();
    for (const item of faq.items ?? []) {
      expect(/^FAQ-\d{3}$/.test(item.id ?? ""), `invalid FAQ id ${item.id ?? "<missing>"}`);
      expect(!faqIds.has(item.id), `duplicate FAQ id ${item.id}`);
      faqIds.add(item.id);
      expect(typeof item.answer === "string" && item.answer.length > 0, `${item.id} lacks answer`);
      expect(Array.isArray(item.evidence) && item.evidence.length > 0, `${item.id} lacks claim evidence`);
      for (const claimId of item.evidence ?? []) {
        expect(claimIds.has(claimId), `${item.id} references unknown claim ${claimId}`);
      }
    }
  }

  const glossary = readJson(records.glossary);
  if (glossary) {
    const terms = new Set();
    for (const entry of glossary.entries ?? []) {
      expect(typeof entry.term === "string" && entry.term.length > 0, `${records.glossary} contains an empty term`);
      expect(!terms.has(entry.term), `${records.glossary} contains duplicate term ${entry.term}`);
      terms.add(entry.term);
      expect(typeof entry.definition === "string" && entry.definition.length > 0, `${entry.term} lacks definition`);
    }
  }

  const localization = readJson(records.localization);
  if (localization) {
    const localeCodes = new Set();
    for (const locale of localization.languages ?? []) {
      expect(/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale.code ?? ""), `invalid locale code ${locale.code ?? "<missing>"}`);
      expect(!localeCodes.has(locale.code), `duplicate locale code ${locale.code}`);
      localeCodes.add(locale.code);
      expect(["ltr", "rtl"].includes(locale.direction), `${locale.code} has invalid direction`);
      expect(["Source", "Machine Draft"].includes(locale.translationStatus), `${locale.code} has invalid translationStatus`);
      expect(typeof locale.record === "string" && exists(locale.record), `${locale.code} references missing locale record ${locale.record ?? "<missing>"}`);
      const localeRecord = readJson(locale.record);
      validateBase(locale.record, localeRecord, canonicalCommit);
      if (localeRecord) {
        expect(localeRecord.locale === locale.code, `${locale.record} locale does not match ${locale.code}`);
        expect(localeRecord.direction === locale.direction, `${locale.record} direction does not match ${locale.direction}`);
        expect(localeRecord.status === locale.translationStatus, `${locale.record} status does not match ${locale.translationStatus}`);
      }
    }
  }

  const publicUrls = readJson(records.publicUrls);
  if (publicUrls) {
    for (const [name, record] of Object.entries(publicUrls.urls ?? {})) {
      if (record.evidence) expect(exists(record.evidence), `${records.publicUrls} ${name} references missing evidence ${record.evidence}`);
      if (record.status === "Verified") expect(typeof record.url === "string" && record.url.startsWith("https://"), `${name} Verified URL must be HTTPS`);
    }
    if (release?.states?.deployedPublic === true) {
      expect(publicUrls.urls?.site?.status === "Verified", "deployedPublic requires a Verified canonical site URL");
      for (const name of ["support", "privacy", "security", "serviceStatus"]) {
        expect(publicUrls.urls?.[name]?.status === "Verified", `deployedPublic requires Verified ${name} URL`);
      }
    }
  }

  const evidence = readJson(records.evidence);
  if (evidence) {
    const evidenceIds = new Set();
    for (const record of evidence.records ?? []) {
      expect(/^EVD-\d{3}$/.test(record.evidenceId ?? ""), `invalid evidenceId ${record.evidenceId ?? "<missing>"}`);
      expect(!evidenceIds.has(record.evidenceId), `duplicate evidenceId ${record.evidenceId}`);
      evidenceIds.add(record.evidenceId);
      validateEvidenceLocations(record.evidenceId, record.locations);
      expect(typeof record.classification === "string" && record.classification.length > 0, `${record.evidenceId} lacks classification`);
    }
  }

  const superseded = readJson(records.supersededFacts);
  if (superseded) {
    const ids = new Set();
    for (const record of superseded.records ?? []) {
      expect(/^SUP-\d{3}$/.test(record.supersededId ?? ""), `invalid supersededId ${record.supersededId ?? "<missing>"}`);
      expect(!ids.has(record.supersededId), `duplicate supersededId ${record.supersededId}`);
      ids.add(record.supersededId);
      expect(typeof record.replacement === "string" && exists(record.replacement), `${record.supersededId} has missing replacement ${record.replacement ?? "<missing>"}`);
    }
  }

  const conflictPath = "release/conflict-report.json";
  const conflicts = readJson(conflictPath);
  validateBase(conflictPath, conflicts, canonicalCommit);
  if (conflicts) {
    const conflictIds = new Set();
    for (const conflict of conflicts.conflicts ?? []) {
      expect(/^CNF-\d{3}$/.test(conflict.conflictId ?? ""), `invalid conflictId ${conflict.conflictId ?? "<missing>"}`);
      expect(!conflictIds.has(conflict.conflictId), `duplicate conflictId ${conflict.conflictId}`);
      conflictIds.add(conflict.conflictId);
      expect(Array.isArray(conflict.conflictingClaims) && conflict.conflictingClaims.length >= 2, `${conflict.conflictId} lacks conflicting claims`);
      expect(typeof conflict.recommendedCanonicalFact === "string" && conflict.recommendedCanonicalFact.length > 0, `${conflict.conflictId} lacks canonical recommendation`);
      expect(typeof conflict.owner === "string" && conflict.owner.length > 0, `${conflict.conflictId} lacks owner`);
      expect(typeof conflict.blockingStatus === "string" && conflict.blockingStatus.length > 0, `${conflict.conflictId} lacks blocking status`);
    }
  }

  for (const supplementalPath of [
    "release/evidence/public-url-probe-2026-07-25.json",
    "release/recovery-inventory-2026-07-25.json"
  ]) {
    validateBase(supplementalPath, readJson(supplementalPath), canonicalCommit);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`public disclosure gate passed: ${loaded.size} JSON records, ${requiredRecordKeys.length} authoritative fact classes, ${releaseStateKeys.length} release states\n`);
