import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const candidate = JSON.parse(await readFile(new URL("../docs/integration/DEVELOPER_DESKTOP_ENDPOINT_MANIFEST_CANDIDATE_20260821.json", import.meta.url), "utf8"));

test("desktop endpoint candidate remains unaccepted and fail-closed", () => {
  assert.equal(candidate.status, "CANDIDATE_UNACCEPTED_NETWORK_DISABLED");
  assert.equal(candidate.defaultPolicy, "deny");
  assert.equal(candidate.basis.chainId, "0x1917");
  assert.equal(candidate.acceptanceRequired.detachedSignature, true);
  assert.equal(candidate.acceptanceRequired.rejectUnknownFields, true);
  assert.equal(candidate.hardReject.fallbackToLocalhost, true);
  assert.deepEqual(candidate.hardReject.hosts, ["localhost", "127.0.0.1", "::1"]);
});

test("desktop endpoint candidate is exact HTTPS-only and bounds every route", () => {
  assert.deepEqual(candidate.requestedEndpoints.map((entry) => entry.origin), ["https://developer.ynxweb4.com", "https://rpc.ynxweb4.com"]);
  for (const entry of candidate.requestedEndpoints) {
    const origin = new URL(entry.origin);
    assert.equal(origin.protocol, "https:");
    assert.equal(origin.pathname, "/");
    assert.ok(entry.pathPrefixes.length > 0);
    assert.equal(entry.redirects, "forbidden");
  }
  assert.match(candidate.consumerProposal.failureMode, /network=false/);
});
