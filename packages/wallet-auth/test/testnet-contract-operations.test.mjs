import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const OPERATIONS = new URL("../integration/smart-account-testnet-operations.json", import.meta.url);
const PAYMASTER = new URL("../../../contracts/wallet/YNXSponsorPaymaster.sol", import.meta.url);

test("public Smart Account operations contract is fail-closed and never describes deletion as rollback", async () => {
  const plan = JSON.parse(await readFile(OPERATIONS, "utf8"));
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.chainId, 6423);
  assert.equal(plan.contractsImmutableAfterDeployment, true);
  assert.equal(plan.rollback.canDeleteOrReplaceDeployedCode, false);
  assert.equal(plan.rollback.partialDeploymentMayBePublished, false);
  assert.equal(plan.rollback.websiteMetadataMayLeadVerification, false);
  assert.deepEqual(plan.paymaster.initialState, { sponsorshipEnabled: false, depositWei: "0" });
  assert.deepEqual(plan.paymaster.riskOfficerAllowed, ["disableProduct(bytes32)", "setSponsorshipEnabled(false)"]);
  assert.deepEqual(plan.paymaster.riskOfficerForbidden, ["setSponsorshipEnabled(true)", "setPolicySigner(address)", "setRiskOfficer(address)"]);
  assert.equal(plan.monitoring.deployedPublic, false);
  assert.equal(plan.releaseClaims.deployedPublic, false);
});

test("operations authority names stay bound to the Paymaster implementation", async () => {
  const source = await readFile(PAYMASTER, "utf8");
  for (const fragment of [
    "function disableProduct(bytes32 productId)",
    "function setSponsorshipEnabled(bool enabled)",
    "function setPolicySigner(address newSigner) external onlyOwner",
    "function setRiskOfficer(address newOfficer) external onlyOwner",
    "msg.sender != owner() && msg.sender != riskOfficer",
  ]) assert.equal(source.includes(fragment), true, fragment);
});
