import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizePublicGatewayIdentifierEvidence, summarizePublicGatewayMultiUserEvidence, WalletAuthError } from "../src/index.js";

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

test("public Gateway multi-user evidence proves only its bounded cleaned-up sample", () => {
  const result = summarizePublicGatewayMultiUserEvidence(multiUserFixture());
  assert.equal(result.boundedSamplePassed, true);
  assert.equal(result.intendedUsers, 4);
  assert.equal(result.publicCapacityProven, false);
  assert.equal(result.multiRegionRecoveryProven, false);
  assert.equal(result.assetMoved, false);
  assert.equal(result.secretMaterialRecorded, false);
});

test("partial lifecycle, missing cleanup and malformed multi-user evidence fail closed", () => {
  assert.equal(summarizePublicGatewayMultiUserEvidence({ ...multiUserFixture(), revoked: 3 }).boundedSamplePassed, false);
  assert.equal(summarizePublicGatewayMultiUserEvidence({ ...multiUserFixture(), cleanupComplete: false }).boundedSamplePassed, false);
  assert.equal(summarizePublicGatewayMultiUserEvidence({ ...multiUserFixture(), failures: ["RATE_LIMIT"] }).boundedSamplePassed, false);
  assert.throws(() => summarizePublicGatewayMultiUserEvidence({ ...multiUserFixture(), extra: true }), walletError());
  assert.throws(() => summarizePublicGatewayMultiUserEvidence({ ...multiUserFixture(), intendedUsers: 9 }), walletError("INVALID_PUBLIC_EVIDENCE"));
  assert.throws(() => summarizePublicGatewayMultiUserEvidence({ ...multiUserFixture(), failures: ["secret text"] }), walletError("INVALID_PUBLIC_EVIDENCE"));
});

function fixture() {
  const success = status => ({ status, requestId: REQUEST, traceId: TRACE, errorId: null });
  const failure = status => ({ status, requestId: REQUEST, traceId: TRACE, errorId: ERROR });
  return { completion: success(200), introspection: success(200), replay: failure(409), revocation: success(200), postRevocation: failure(403) };
}
function multiUserFixture() {
  return { environment: "public-testnet", intendedUsers: 4, completed: 4, distinctAccounts: 4, introspectedActive: 4, replayRejected: 4, crossSessionRejected: true, revoked: 4, postRevokeRejected: 4, cleanupComplete: true, failures: [] };
}
function walletError(code) { return value => value instanceof WalletAuthError && (!code || value.code === code); }
