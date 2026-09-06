import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = new URL("../integration/p0-wallet-protocol-public-readback-20260820T1125Z.json", import.meta.url);

test("fresh public readback proves the prior runtime without elevating the current owner candidate", async () => {
  const evidence = JSON.parse(await readFile(path, "utf8"));
  assert.equal(evidence.probeMode, "READ_ONLY_GET_AND_OPTIONS");
  assert.equal(evidence.health.httpStatus, 200);
  assert.equal(evidence.ready.httpStatus, 200);
  assert.equal(evidence.version.httpStatus, 200);
  assert.equal(evidence.version.sourceCommit, "49e30d999e9a9cbdd2c565021009f2cab0dc125c");
  assert.equal(evidence.registeredOriginPreflight.httpStatus, 204);
  assert.equal(evidence.registeredOriginPreflight.allowOriginExact, true);
  assert.equal(evidence.transportObservation.boundedRetrySucceeded, true);
  assert.equal(evidence.transportObservation.classifiedAsRuntimeFailure, false);
  assert.equal(evidence.truth.previousOriginBindingRuntimeStillPublic, true);
  for (const [key, value] of Object.entries(evidence.truth)) {
    if (key !== "previousOriginBindingRuntimeStillPublic") assert.equal(value, false, key);
  }
});
