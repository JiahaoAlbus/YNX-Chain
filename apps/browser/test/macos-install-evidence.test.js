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

test("published metadata binds the central macOS preview without widening release claims", () => {
  const evidence = readJson("apps/browser/evidence/macos-public-preview-96dfc52.json");
  const product = readJson("apps/browser/product-release.json");
  const contract = readJson("release/integration/browser-contract.json");
  const publicMetadata = readJson("release/browser/public-product-metadata.json");

  assert.equal(evidence.sourceCommit, product.sourceCommit);
  assert.equal(evidence.artifact.sameHostReproducibility, "pass");
  assert.equal(evidence.application.codesignVerify, "pass");
  assert.equal(evidence.application.signingClass, "adhoc");
  assert.equal(evidence.application.gatekeeper, "rejected");
  assert.equal(product.releaseStates.installedLocal, false);
  assert.equal(contract.releaseStates.installedLocal, false);
  assert.equal(product.verifiedThisCheckpoint.macosInstall.binarySha256, evidence.application.executableSha256);
  assert.equal(product.verifiedThisCheckpoint.macosTestnetPreview.zipSha256, evidence.artifact.sha256);

  for (const state of [product.releaseStates, contract.releaseStates]) {
    assert.equal(state.downloadHosted, false);
    assert.equal(state.productionSigned, false);
    assert.equal(state.storeReleased, false);
  }
  assert.equal(publicMetadata.status.publiclyAvailable, false);
  assert.deepEqual(publicMetadata.downloads, []);
});
