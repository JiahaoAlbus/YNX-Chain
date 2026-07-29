import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveInside, verifyCleanCheckout } from "./security-clean-checkout.mjs";

test("clean-checkout verifier rejects ambiguous source commits", () => {
  assert.throws(
    () => verifyCleanCheckout({ sourceCommit: "short" }),
    /full Git SHA/,
  );
});

test("clean-checkout paths must remain inside their declared root", () => {
  const base = resolve("/tmp/ynx-clean-checkout-test");
  assert.equal(
    resolveInside(base, "release/artifact.json", "artifact path"),
    resolve(base, "release/artifact.json"),
  );
  assert.throws(
    () => resolveInside(base, "../outside.json", "artifact path"),
    /must stay inside/,
  );
  assert.throws(
    () => resolveInside(base, "/tmp/outside.json", "artifact path"),
    /must stay inside/,
  );
});
