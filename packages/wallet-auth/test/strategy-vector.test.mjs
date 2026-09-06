import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  authorizeStrategyAction,
  strategyActionNonceKey,
  strategyMandateDigest,
  WalletAuthError,
} from "../src/index.js";

const vector = JSON.parse(readFileSync(new URL("../testdata/strategy-mandate-v2.json", import.meta.url), "utf8"));
const at = new Date(vector.protocol.generatedAt);

function code(expected) {
  return error => error instanceof WalletAuthError && error.code === expected;
}

test("published StrategyMandate v2 vector is deterministic and authorizes exactly one bounded action", () => {
  assert.equal(vector.protocol.strategyMandateSchemaVersion, 2);
  assert.equal(vector.protocol.strategyActionSchemaVersion, 1);
  assert.equal(strategyMandateDigest(vector.mandate), vector.mandateDigest);
  const result = authorizeStrategyAction(vector.mandate, vector.action, at);
  assert.deepEqual(result, vector.authorization);
  assert.equal(strategyActionNonceKey(vector.action.nonceDomain, vector.action.nonce), vector.actionNonceKey);
});

test("published StrategyMandate v2 negative vectors fail with their canonical error codes", () => {
  for (const negative of vector.negativeCases) {
    const candidateMandate = negative.target === "mandate" ? { ...vector.mandate, ...negative.patch } : vector.mandate;
    const candidateAction = negative.target === "action" ? { ...vector.action, ...negative.patch } : vector.action;
    assert.throws(
      () => authorizeStrategyAction(candidateMandate, candidateAction, at),
      code(negative.expectedCode),
      negative.name,
    );
  }
});
