import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const probe = JSON.parse(readFileSync(new URL("../integration/p0-wallet-protocol-public-probe-20260820.json", import.meta.url), "utf8"));

test("public probe preserves direct negative evidence and does not elevate the candidate", () => {
  assert.equal(probe.walletGateway.version.candidateMatch, false);
  assert.equal(probe.walletGateway.corsPreflight.status, 405);
  assert.equal(probe.walletGateway.corsPreflight.candidateRequirementMet, false);
  assert.equal(probe.appGateway.version.error, "DEPLOYMENT_NOT_FOUND");
  assert.equal(probe.releaseTruth.deployedPublic, false);
  assert.equal(probe.releaseTruth.publicCorsVerified, false);
  assert.match(probe.nextOwnerAction, /exact accepted candidate/);
});
