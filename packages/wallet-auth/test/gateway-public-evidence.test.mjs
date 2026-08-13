import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizePublicGatewayIdentifierEvidence, WalletAuthError } from "../src/index.js";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const TRACE = "22222222-2222-4222-8222-222222222222";
const ERROR = "33333333-3333-4333-8333-333333333333";

test("public Gateway identifier evidence requires request/trace on every phase and error IDs only on failures", () => {
  const result = summarizePublicGatewayIdentifierEvidence(fixture());
  assert.equal(result.requestIdCompleteness, true);
  assert.equal(result.traceIdCompleteness, true);
  assert.equal(result.errorIdCompleteness, true);
  assert.equal(result.unexpectedErrorIdAbsent, true);
  assert.equal(result.allRequiredIdentifiersComplete, true);
  assert.equal(result.identifierValuesRecorded, false);
  assert.deepEqual(Object.keys(result.stages), ["completion", "introspection", "replay", "revocation", "postRevocation"]);
});

test("missing identifiers remain phase-specific false without recording identifier values", () => {
  const input = fixture();
  input.introspection.traceId = null;
  input.replay.errorId = null;
  const result = summarizePublicGatewayIdentifierEvidence(input);
  assert.equal(result.requestIdCompleteness, true);
  assert.equal(result.traceIdCompleteness, false);
  assert.equal(result.errorIdCompleteness, false);
  assert.equal(result.stages.introspection.traceIdPresent, false);
  assert.equal(result.stages.replay.errorIdExpected, true);
  assert.equal(result.stages.replay.errorIdPresent, false);
  assert.equal(JSON.stringify(result).includes(REQUEST), false);
});

test("malformed UUIDs, unexpected fields and invalid statuses fail closed", () => {
  const malformed = fixture();
  malformed.completion.requestId = "not-a-uuid";
  const result = summarizePublicGatewayIdentifierEvidence(malformed);
  assert.equal(result.stages.completion.requestIdPresent, true);
  assert.equal(result.stages.completion.requestIdValid, false);
  assert.equal(result.allRequiredIdentifiersComplete, false);
  assert.throws(() => summarizePublicGatewayIdentifierEvidence({ ...fixture(), extra: fixture().completion }), walletError());
  const invalid = fixture(); invalid.replay.status = 999;
  assert.throws(() => summarizePublicGatewayIdentifierEvidence(invalid), walletError("INVALID_PUBLIC_EVIDENCE"));
});

function fixture() {
  const success = status => ({ status, requestId: REQUEST, traceId: TRACE, errorId: null });
  const failure = status => ({ status, requestId: REQUEST, traceId: TRACE, errorId: ERROR });
  return { completion: success(200), introspection: success(200), replay: failure(409), revocation: success(200), postRevocation: failure(403) };
}
function walletError(code) { return value => value instanceof WalletAuthError && (!code || value.code === code); }
