import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DERIVATIVES_POLICY_VERSION,
  OracleClient,
  OracleValidationError,
  parseAndValidatePrice,
  parsePrice,
} from "../dist/index.js";

const vectorPath = new URL("../../../../integration/oracle/v1/consumer-test-vectors.json", import.meta.url);
const vectors = JSON.parse(await readFile(vectorPath, "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyChange(target, pointer, value) {
  const parts = pointer.replace(/^\//, "").split("/");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function policy() {
  return {
    requestedMarket: vectors.consumerPolicy.requestedMarket,
    requestedType: vectors.consumerPolicy.requestedType,
    expectedVersion: "weighted-median-mad-v1",
    now: vectors.consumerPolicy.now,
    maximumAgeMs: vectors.consumerPolicy.maximumAgeSeconds * 1_000,
    minimumConfidencePpm: vectors.consumerPolicy.minimumConfidencePpm,
    minimumCoveragePpm: vectors.consumerPolicy.minimumCoveragePpm,
  };
}

test("TypeScript SDK matches canonical consumer vectors", async (t) => {
  for (const vector of vectors.cases) {
    await t.test(vector.id, () => {
      const candidate = clone(vectors.base);
      for (const change of vector.changes) applyChange(candidate, change.path, change.value);
      if (vector.accept) {
        const price = parseAndValidatePrice(candidate, policy());
        assert.equal(price.market, vectors.consumerPolicy.requestedMarket);
      } else {
        assert.throws(() => parseAndValidatePrice(candidate, policy()), OracleValidationError);
      }
    });
  }
});

test("strict parser rejects unknown top-level and nested fields", () => {
  const topLevel = clone(vectors.base);
  topLevel.legacyPrice = 1;
  assert.throws(() => parsePrice(topLevel), /unknown field legacyPrice/);

  const nested = clone(vectors.base);
  nested.quality.assumedHealthy = true;
  assert.throws(() => parsePrice(nested), /unknown field assumedHealthy/);
});

test("derived funding validation binds exact policy and adjustment", () => {
  const funding = {
    ...clone(vectors.base),
    type: "funding_reference",
    value: -200,
    version: DERIVATIVES_POLICY_VERSION,
    observationIds: ["premium-a", "premium-b", "premium-c", "basis-a", "basis-b", "basis-c"],
    observationHashes: ["a", "b", "c", "d", "e", "f"].map((value) => value.repeat(64)),
    derivation: {
      method: "premium_plus_basis_with_governance_clamp",
      policyVersion: DERIVATIVES_POLICY_VERSION,
      componentTypes: ["premium_reference", "basis_reference"],
      componentLineageHashes: ["1".repeat(64), "2".repeat(64)],
      fundingWindowSeconds: 28_800,
      premiumPpm: -100,
      basisPpm: -100,
      rawAdjustmentPpm: -200,
      appliedAdjustmentPpm: -200,
      clampPpm: 5_000,
      clamped: false,
    },
  };
  const parsed = parseAndValidatePrice(funding, {
    ...policy(),
    requestedType: "funding_reference",
    expectedVersion: DERIVATIVES_POLICY_VERSION,
  });
  assert.equal(parsed.value, -200);

  funding.derivation.appliedAdjustmentPpm = -201;
  assert.throws(() => parsePrice(funding), /unsafe|does not match/);
});

test("client rejects remote plain HTTP and invalid limits", () => {
  assert.throws(() => new OracleClient("http://192.0.2.1"), /plain HTTP/);
  assert.throws(() => new OracleClient("https://oracle.example?token=secret"), /invalid Oracle base URL/);
  assert.throws(() => new OracleClient("https://oracle.example", { timeoutMs: 0 }), /positive integers/);
});

test("client fetches strict bounded price response", async () => {
  let requested;
  const client = new OracleClient("https://oracle.example/v1/", {
    fetch: async (input, init) => {
      requested = { url: input.toString(), init };
      return new Response(JSON.stringify(vectors.base), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const price = await client.price("YNXT/YUSD_TEST", "spot_price");
  assert.equal(price.value, 1_000_000);
  const url = new URL(requested.url);
  assert.equal(url.pathname, "/v1/prices");
  assert.equal(url.searchParams.get("market"), "YNXT/YUSD_TEST");
  assert.equal(url.searchParams.get("type"), "spot_price");
  assert.equal(requested.init.headers.accept, "application/json");
});

test("client rejects oversized and non-success responses", async () => {
  const oversized = new OracleClient("https://oracle.example", {
    maximumResponseBytes: 32,
    fetch: async () => new Response(JSON.stringify(vectors.base), { status: 200 }),
  });
  await assert.rejects(() => oversized.price("YNXT/YUSD_TEST", "spot_price"), /size limit/);

  const unavailable = new OracleClient("https://oracle.example", {
    fetch: async () => new Response("unavailable", { status: 503 }),
  });
  await assert.rejects(() => unavailable.price("YNXT/YUSD_TEST", "spot_price"), /HTTP 503/);
});
