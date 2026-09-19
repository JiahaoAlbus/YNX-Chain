import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = new URL("../integration/shop-client-retirement-owner-record-audit-20260820.json", import.meta.url);

test("Shop retirement owner audit preserves the shared-identity blocker and every public false gate", async () => {
  const audit = JSON.parse(await readFile(path, "utf8"));
  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.centralAssignment.status, "PROTOCOL_CAPABILITY_ACCEPTED_OWNER_RECORDS_PENDING");
  assert.equal(audit.centralAssignment.executionLeaseIssued, false);
  assert.deepEqual(audit.shopOwnerReadOnlyAudit.observedSharedIdentity.usedBy, ["android", "ios", "web"]);
  assert.equal(audit.shopOwnerReadOnlyAudit.observedSharedIdentity.productClientId, "ynx-shop-v1");
  assert.equal(audit.shopOwnerReadOnlyAudit.observedSharedIdentity.callback, "ynxshop://wallet-auth/callback");
  assert.equal(audit.websiteOwnerReadOnlyAudit.publicAndroidArtifactStillListed, true);
  assert.equal(audit.missingOwnerRecords.length, 12);
  assert.ok(Object.values(audit.truth).every((value) => value === false));
  for (const group of [audit.shopOwnerReadOnlyAudit.files, audit.websiteOwnerReadOnlyAudit.files]) {
    assert.ok(group.length > 0);
    for (const file of group) assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
});
