import test from "node:test";
import assert from "node:assert/strict";
import {requirePackageSourceCommit} from "../src/package-source-identity.js";

test("release packaging accepts only a full lowercase source commit", () => {
  const commit = "60a756991fbe07311c9d2b0dbade8a9d670dab04";
  assert.equal(requirePackageSourceCommit(commit), commit);
});

test("release packaging rejects missing, placeholder, abbreviated, and malformed identities", () => {
  for (const value of [undefined, "", "uncommitted-source-tree", "60a75699", "60A756991FBE07311C9D2B0DBADE8A9D670DAB04", "g".repeat(40)]) {
    assert.throws(() => requirePackageSourceCommit(value), error => error?.code === "PACKAGE_SOURCE_COMMIT_REQUIRED");
  }
});
