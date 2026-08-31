import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const directory = path.join(root, "release/wallet-cli/readiness");
const sha256 = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
const readJSON = name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
const manifest = readJSON("download-manifest.json");
const sbom = readJSON("sbom.spdx.json");
const request = readJSON("operator-lease-request.json");
const sums = new Map(fs.readFileSync(path.join(directory, "SHA256SUMS"), "utf8").trim().split("\n").map(line => line.split("  ").reverse()));

assert.equal(manifest.sourceCommit, "68b68bbcbc7a301c113db82a2183537191976ff0");
assert.equal(manifest.artifacts.length, 6);
for (const artifact of manifest.artifacts) {
  const body = fs.readFileSync(path.join(root, "release/wallet-cli/artifacts", artifact.filename));
  assert.equal(body.length, artifact.bytes);
  assert.equal(sha256(body), artifact.sha256);
  assert.equal(sums.get(artifact.filename), artifact.sha256);
  assert.equal(artifact.officialDownloadURL, null);
  assert.equal(artifact.downloadHosted, false);
  assert.equal(artifact.deployedPublic, false);
  assert.equal(artifact.productionSigned, false);
}
assert.equal(manifest.behavior.chainId, 6423);
assert.equal(manifest.behavior.evmChainId, "0x1917");
assert.equal(manifest.behavior.legacyExitCode, 78);
assert.equal(sbom.spdxVersion, "SPDX-2.3");
assert.equal(sbom.files.length, 6);
assert.equal(sbom.packages.length, 2);
assert.equal(sbom.relationships.filter(entry => entry.relationshipType === "CONTAINS").length, 6);
assert.equal(request.status, "awaiting-new-lease");
assert.equal(request.handling.containsSecrets, false);
assert.equal(request.handling.submitSecretsInChat, false);
assert.equal(request.execution.publish, false);
assert.equal(request.execution.sign, false);
assert.equal(request.execution.signedSuccessorRequiresNewManifestAndLease, true);
assert.ok(request.authorityRequested.signing.every(entry => entry.outputRequiresNewSha256AndContentAddressedPath && !entry.outputPublicationAuthorizedByThisRequest));
assert.equal(request.authorityRequested.publicationPaths.length, 6);
assert.ok(request.authorityRequested.publicationPaths.every(entry => !entry.authorized && entry.overwriteAllowed === false));
assert.ok(Object.values(request.releaseState).every(value => value === false));
const install = fs.readFileSync(path.join(directory, "INSTALL.md"), "utf8");
for (const token of ["ynx_6423-1", "6423", "0x1917", "YNXT", "WRONG_CHAIN", "exit code 78", "unsigned"]) assert.ok(install.includes(token));
console.log(`wallet CLI release readiness verified: source=${manifest.sourceCommit} artifacts=6 hosted=false signed=false`);
