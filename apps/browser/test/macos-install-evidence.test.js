import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  classifyBundleRecord,
  immutableInstallName,
  redactHome,
} from "../scripts/install-macos-evidence.mjs";

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
