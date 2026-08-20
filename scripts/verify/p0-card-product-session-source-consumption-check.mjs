#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, p))).digest("hex");
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/card-product-session-source-consumption-e935b760-20260820.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.truth.cardMigratedV2, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.localHandlerIsPublicRouteEvidence, false);
  assert.equal(candidate.truth.visibleInstalledOrBrowserVerified, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
};

assert.equal(acceptance.ownerSourceCommit, "e935b760413898cd1b206f4f816e1eb0e15b4663");
assert.equal(acceptance.acceptedWalletAuthSource, "203be5e108be468350591615a64d5d36ab87a8f1");
assert.equal(fs.statSync(path.join(root, acceptance.sourceEvidence.path)).size, acceptance.sourceEvidence.bytes);
assert.equal(sha256(acceptance.sourceEvidence.path), acceptance.sourceEvidence.sha256);
assert.equal(evidence.ownerSource.remoteReadbackExact, true);
assert.equal(evidence.acceptedDependency.origin, "https://wallet-auth.ynxweb4.com");
assert.equal(evidence.acceptedDependency.vendorArchive.bytes, 123903);
assert.equal(evidence.acceptedDependency.vendorArchive.sha256, "8d0e8e35d8f387948d44666efdc6322e9b57968b5987728dffbddd11b54928eb");
assert.equal(evidence.acceptedSourceBehavior.rootFactoryConsumed, true);
assert.equal(evidence.acceptedSourceBehavior.endpointInjectionRejected, true);
assert.equal(evidence.acceptedSourceBehavior.callbackInjectionRejected, true);
assert.equal(evidence.acceptedSourceBehavior.originInjectionRejected, true);
assert.equal(evidence.acceptedSourceBehavior.sessionInjectionRejected, true);
assert.equal(evidence.acceptedSourceBehavior.privateV2SessionSeparatedFromLegacyCardApiSession, true);
assert.equal(evidence.centralVerification.runtimeTestsPassed, 24);
assert.equal(evidence.centralVerification.typecheckPassed, true);
assert.equal(evidence.evidenceBoundary.localHandlerOnly, true);
assert.equal(evidence.evidenceBoundary.publicCardV2RouteVerified, false);
assert.equal(evidence.evidenceBoundary.visibleInstalledOrBrowserVerified, false);
assert.equal(evidence.evidenceBoundary.legacyCardApiSessionIsProductSessionV2, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-025");
assert.ok(task);
assert.equal(task.status, "CARD_V2_SOURCE_CONSUMED_PUBLIC_AND_VISIBLE_BLOCKED");
assert.equal(task.productsMigrated, 0);
if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.cardMigratedV2 = true; },
    (a) => { a.truth.productsMigratedV2 = 1; },
    (a) => { a.truth.localHandlerIsPublicRouteEvidence = true; },
    (a) => { a.truth.visibleInstalledOrBrowserVerified = true; },
    (a) => { a.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 Card promotion mutations rejected");
}
console.log("PASS Card consumed exact Wallet/Auth root factory source; public v2, visible platform and migration gates remain false");
