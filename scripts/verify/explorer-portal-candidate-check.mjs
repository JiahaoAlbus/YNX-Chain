#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const manifestPath = process.argv[2] || "release/evidence/explorer-portal-source-candidate-2026-08-31.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fail = message => { throw new Error(`explorer portal candidate: ${message}`); };

if (manifest.schemaVersion !== "1.0.0" || manifest.recordClass !== "source-bound-local-candidate") fail("unexpected record schema");
if (manifest.network?.cosmosChainId !== "ynx_6423-1" || manifest.network?.numericChainId !== 6423 || manifest.network?.evmChainId !== "0x1917" || manifest.network?.nativeSymbol !== "YNXT") fail("6423 identity is incomplete");
for (const key of ["deployedStaging", "deployedPublic", "publicWalletEndpoint", "downloadHosted", "productionSigned", "storeReleased"]) {
  if (manifest.states?.[key] !== false) fail(`${key} must remain false without separate evidence`);
}
if (manifest.states?.implementedLocal !== true || manifest.states?.testedLocal !== true || manifest.states?.sourcePushed !== true) fail("local candidate states are incomplete");
if (!/scope-bound deployment authorization/.test(manifest.deploymentBlocker || "")) fail("deployment blocker is not precise");

const source = manifest.source || {};
if (!/^[0-9a-f]{40}$/.test(source.portalCommit || "") || !/^[0-9a-f]{40}$/.test(source.portalTree || "")) fail("source commit or tree is not immutable");
if (git("rev-parse", `${source.portalCommit}^{tree}`) !== source.portalTree) fail("portal tree does not match source commit");
git("merge-base", "--is-ancestor", source.portalCommit, "HEAD");
git("merge-base", "--is-ancestor", source.portalCommit, `origin/${source.branch}`);
for (const file of source.files || []) {
  if (!file.path || !/^[0-9a-f]{64}$/.test(file.sha256 || "")) fail("file digest entry is invalid");
  const bytes = execFileSync("git", ["show", `${source.portalCommit}:${file.path}`]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== file.sha256) fail(`digest mismatch for ${file.path}`);
}
if (!/^[0-9a-f]{40}$/.test(manifest.rollback?.sourceCommit || "")) fail("rollback source is not immutable");
git("merge-base", "--is-ancestor", manifest.rollback.sourceCommit, source.portalCommit);

console.log(`explorer portal candidate verified: ${source.portalCommit}`);
