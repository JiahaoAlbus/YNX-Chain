import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyBundleRecord,
  immutableInstallName,
  redactHome,
} from "../scripts/install-macos-evidence.mjs";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

test("redactHome removes the evidence-host home prefix", () => {
  assert.equal(
    redactHome(
      "/Users/example/Applications/YNX.app",
      "/Users/example",
    ),
    "~/Applications/YNX.app",
  );
  assert.equal(
    redactHome("/Applications/YNX.app", "/Users/example"),
    "/Applications/YNX.app",
  );
});

test("immutableInstallName binds source commit and executable hash", () => {
  assert.equal(
    immutableInstallName(
      "49c9ba14057b79076c36f2ee83f77a7dd9bdfb56",
      "cae76c48e0acb8241f3501115cee118865c3d2b54ee945b7091d4894208943a9",
    ),
    "YNX Browser Testnet Preview-49c9ba14057b-cae76c48e0ac.app",
  );
});

test("classifyBundleRecord distinguishes source, reviewed install and collisions", () => {
  const source = path.resolve("/tmp/source.app");
  const installed = path.resolve("/tmp/install.app");
  const shared = {
    sourcePath: source,
    installedPath: installed,
    sourceSha256: "a".repeat(64),
  };

  assert.equal(
    classifyBundleRecord({
      ...shared,
      appPath: source,
      binarySha256: "a".repeat(64),
    }).role,
    "source-artifact",
  );
  assert.equal(
    classifyBundleRecord({
      ...shared,
      appPath: installed,
      binarySha256: "a".repeat(64),
    }).role,
    "reviewed-install",
  );
  const matchingCopy = classifyBundleRecord({
    ...shared,
    appPath: "/Applications/Matching.app",
    binarySha256: "a".repeat(64),
  });
  assert.equal(matchingCopy.role, "matching-copy");
  assert.equal(matchingCopy.matchesReviewedBinary, true);

  const collision = classifyBundleRecord({
    ...shared,
    appPath: "/Applications/Other.app",
    binarySha256: "b".repeat(64),
  });
  assert.equal(collision.role, "collision");
  assert.equal(collision.matchesReviewedBinary, false);
});

test("published metadata binds the exact local macOS install evidence without widening release claims", () => {
  const evidence = readJson("apps/browser/evidence/macos-install-2beece6.json");
  const product = readJson("apps/browser/product-release.json");
  const windowEvidence = readJson("apps/browser/evidence/macos-window-d8c1ad24bc88/manifest.json");
  const contract = readJson("release/integration/browser-contract.json");
  const publicMetadata = readJson("release/browser/public-product-metadata.json");

  assert.equal(evidence.sourceCommit, product.verifiedThisCheckpoint.macosInstall.sourceCommit);
  assert.equal(windowEvidence.sourceCommit, product.verifiedThisCheckpoint.macosTestnetPreview.windowVisualQa.sourceCommit.slice(0, 12));
  assert.equal(windowEvidence.passed, true);
  assert.equal(product.sourceCommit, contract.sourceCommit);
  assert.equal(product.sourceCommit, publicMetadata.sourceCommit);
  assert.equal(product.sourceCommit, product.verifiedThisCheckpoint.macosTestnetPreview.sourceCommit);
  assert.match(product.verifiedThisCheckpoint.macosTestnetPreview.zipSha256, /^[0-9a-f]{64}$/);
  assert.match(product.verifiedThisCheckpoint.macosTestnetPreview.binarySha256, /^[0-9a-f]{64}$/);
  assert.equal(evidence.verifiedStates.installedLocalMacosEvidenceHost, true);
  assert.equal(evidence.install.exactArtifactHash, true);
  assert.equal(evidence.launchServices.exactReviewedBinaryHash, true);
  assert.equal(product.releaseStates.installedLocal, false);
  assert.equal(contract.releaseStates.installedLocal, false);
  assert.equal(product.releaseStates.integratedCentral, true);
  assert.equal(contract.releaseStates.integratedCentral, true);
  assert.equal(product.verifiedThisCheckpoint.macosInstall.binarySha256, evidence.reviewedArtifact.executableSha256);
  assert.equal(product.verifiedThisCheckpoint.macosInstall.evidence, "apps/browser/evidence/macos-install-2beece6.json");

  for (const state of [evidence.verifiedStates, product.releaseStates]) {
    assert.equal(state.downloadHosted, false);
    assert.equal(state.productionSigned, false);
    assert.equal(state.storeReleased, false);
  }
  assert.equal(publicMetadata.status.publiclyAvailable, false);
  assert.deepEqual(publicMetadata.downloads, []);
});
