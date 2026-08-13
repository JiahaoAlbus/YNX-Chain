import { WalletAuthError, exactFields } from "./canonical.js";

const STAGES = ["completion", "introspection", "replay", "revocation", "postRevocation"];
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
function fail(code, message) { throw new WalletAuthError(code, message); }
