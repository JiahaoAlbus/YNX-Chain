import { WalletAuthError, exactFields } from "./canonical.js";

const STAGES = ["completion", "introspection", "replay", "revocation", "postRevocation"];
const MULTI_USER_FIELDS = ["environment", "intendedUsers", "completed", "distinctAccounts", "introspectedActive", "replayRejected", "crossSessionRejected", "revoked", "postRevokeRejected", "cleanupComplete", "failures"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function summarizePublicGatewayIdentifierEvidence(input) {
  exactFields(input, STAGES, "Public Gateway identifier evidence");
  const stages = {};
  for (const stage of STAGES) stages[stage] = summarizeStage(input[stage]);
  const values = Object.values(stages);
  return Object.freeze({
    stages: Object.freeze(stages),
    requestIdCompleteness: values.every((value) => value.requestIdValid),
    traceIdCompleteness: values.every((value) => value.traceIdValid),
    errorIdCompleteness: values.filter((value) => value.errorIdExpected).every((value) => value.errorIdValid),
    unexpectedErrorIdAbsent: values.filter((value) => !value.errorIdExpected).every((value) => !value.errorIdPresent),
    allRequiredIdentifiersComplete: values.every((value) => value.requestIdValid && value.traceIdValid && (!value.errorIdExpected || value.errorIdValid)),
    identifierValuesRecorded: false,
  });
}

export function summarizePublicGatewayMultiUserEvidence(input) {
  exactFields(input, MULTI_USER_FIELDS, "Public Gateway multi-user evidence");
  if (input.environment !== "public-testnet") fail("INVALID_PUBLIC_EVIDENCE", "Public Gateway multi-user evidence environment is invalid");
  const intendedUsers = boundedCount(input.intendedUsers, "intendedUsers", 2, 8);
  const counts = {};
  for (const key of ["completed", "distinctAccounts", "introspectedActive", "replayRejected", "revoked", "postRevokeRejected"]) counts[key] = boundedCount(input[key], key, 0, intendedUsers);
  if (typeof input.crossSessionRejected !== "boolean" || typeof input.cleanupComplete !== "boolean") fail("INVALID_PUBLIC_EVIDENCE", "Public Gateway multi-user evidence booleans are invalid");
  if (!Array.isArray(input.failures) || input.failures.length > intendedUsers || input.failures.some(value => typeof value !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(value))) fail("INVALID_PUBLIC_EVIDENCE", "Public Gateway multi-user failures are invalid");
  const boundedSamplePassed = Object.values(counts).every(value => value === intendedUsers)
    && input.crossSessionRejected && input.cleanupComplete && input.failures.length === 0;
  return Object.freeze({
    environment: input.environment,
    intendedUsers,
    ...counts,
    crossSessionRejected: input.crossSessionRejected,
    cleanupComplete: input.cleanupComplete,
    failures: Object.freeze([...input.failures]),
    boundedSamplePassed,
    publicCapacityProven: false,
    multiRegionRecoveryProven: false,
    assetMoved: false,
    userClaimed: false,
    providerClaimed: false,
    secretMaterialRecorded: false,
    identifierValuesRecorded: false,
  });
}

function summarizeStage(value) {
  exactFields(value, ["status", "requestId", "traceId", "errorId"], "Public Gateway response identifiers");
  if (!Number.isSafeInteger(value.status) || value.status < 100 || value.status > 599) fail("INVALID_PUBLIC_EVIDENCE", "Public Gateway response status is invalid");
  for (const key of ["requestId", "traceId", "errorId"]) if (value[key] !== null && typeof value[key] !== "string") fail("INVALID_PUBLIC_EVIDENCE", `Public Gateway ${key} is invalid`);
  const errorIdExpected = value.status >= 400;
  return Object.freeze({
    status: value.status,
    requestIdPresent: value.requestId !== null,
    requestIdValid: uuid(value.requestId),
    traceIdPresent: value.traceId !== null,
    traceIdValid: uuid(value.traceId),
    errorIdExpected,
    errorIdPresent: value.errorId !== null,
    errorIdValid: uuid(value.errorId),
  });
}

function uuid(value) { return typeof value === "string" && UUID.test(value); }
function boundedCount(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_PUBLIC_EVIDENCE", `Public Gateway ${label} is invalid`);
  return value;
}
function fail(code, message) { throw new WalletAuthError(code, message); }
