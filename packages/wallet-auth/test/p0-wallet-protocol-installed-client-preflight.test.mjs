import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const evidence = JSON.parse(readFileSync(new URL("../integration/p0-wallet-protocol-installed-client-preflight-20260820.json", import.meta.url), "utf8"));

test("installed-client preflight rejects local shortcuts and simulators without inflating client truth", () => {
  assert.equal(evidence.status, "PRECHECK_REJECTED_NO_ELIGIBLE_INSTALLED_CLIENT");
  assert.equal(evidence.macos.rejectedShortcut.edgeAdhocFlag, true);
  assert.equal(evidence.macos.rejectedShortcut.signatureClass, "adhoc");
  assert.equal(evidence.macos.rejectedShortcut.systemAssessment, "rejected");
  assert.equal(evidence.android.connectedTargets.every((target) => target.eligible === false), true);
  assert.equal(evidence.computerControl.clientLaunched, false);
  assert.equal(evidence.leaseExecution.orphanAuthorityCreated, false);
  assert.equal(Object.values(evidence.releaseTruth).every((value) => value === false), true);
});
