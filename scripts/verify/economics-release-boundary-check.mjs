import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const integration = JSON.parse(readFileSync("release/economics-integration-manifest.json", "utf8"));
const request = JSON.parse(readFileSync("release/operator-inputs.request.json", "utf8"));
const security = JSON.parse(readFileSync("release/security-scan-evidence.json", "utf8"));
const release = JSON.parse(readFileSync("product-release.json", "utf8"));
assert.equal(integration.schemaVersion, 1);
assert.equal(request.schemaVersion, 1);
assert.equal(integration.sourceCommit, request.sourceCommit);
assert.match(integration.sourceCommit, /^[0-9a-f]{40}$/);
execFileSync("git", ["cat-file", "-e", `${integration.sourceCommit}^{commit}`]);
for (const key of ["installedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"]) {
  assert.equal(integration.states[key], false, `${key} cannot be promoted without direct evidence`);
}
assert.equal(integration.currentAuthority.feeBurnActive, false);
assert.equal(integration.currentAuthority.dynamicIssuanceActive, false);
assert.equal(integration.currentAuthority.stakingRewardsActive, false);
assert.equal(integration.currentAuthority.slashingActive, false);
assert.equal(integration.currentAuthority.treasuryExecutionActive, false);
assert.ok(integration.handoffs.length >= 6);
assert.ok(request.inputs.length >= 8);
assert.equal(security.npmAudit.result, "unresolved");
assert.ok(security.npmAudit.high > 0);
assert.equal(security.failure, true);
assert.ok(release.knownGaps.some((gap) => gap.includes("Hardhat")), "unresolved tooling vulnerability must remain a release gap");
const serialized = JSON.stringify(request).toLowerCase();
for (const forbidden of ["privatekeyvalue", "seedphrase", "pemcontent", "apikeyvalue", "validatorsecret"]) assert.equal(serialized.includes(forbidden), false);
console.log(`economics release boundary verified: source=${integration.sourceCommit} handoffs=${integration.handoffs.length} inputs=${request.inputs.length}`);
