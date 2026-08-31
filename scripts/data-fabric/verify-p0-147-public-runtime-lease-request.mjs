#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requestPath = path.join(root, "docs/data-fabric/P0_147_PUBLIC_RUNTIME_LEASE_REQUEST.json");

function fail(message) {
  throw new Error(`P0-147 public runtime lease request is invalid: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readRequest() {
  try {
    return JSON.parse(readFileSync(requestPath, "utf8"));
  } catch (error) {
    fail(`cannot parse request JSON: ${error.message}`);
  }
}

const request = readRequest();
assert(request.schemaVersion === 1, "schemaVersion must be 1");
assert(request.requestId === "P0-147-data-fabric-public-runtime-lease-request", "requestId is unexpected");
assert(request.status === "REQUESTED_NOT_AUTHORIZED", "request must remain unauthorized until Central approves it");
assert(request.scope?.dataFabricOnly === true, "scope must remain Data-Fabric-only");
assert(request.deploymentAuthorization?.productionMutationAllowed === false, "production mutation must remain forbidden");
assert(request.deploymentAuthorization?.leaseId === null, "leaseId must remain unset");
assert(request.deploymentAuthorization?.leaseSha256 === null, "leaseSha256 must remain unset");
assert(request.deploymentAuthorization?.singleUse === true, "lease must remain single-use");
assert(request.deploymentAuthorization?.noRetryWithoutFreshLease === true, "retry must require a fresh lease");

const fabric = request.authoritativeTopology?.fabric;
for (const field of ["publicBaseUrl", "healthUrl", "versionUrl", "metricsUrl", "operatorConsoleUrl", "tlsApprovalId"]) {
  assert(fabric?.[field] === null, `fabric ${field} must remain unset`);
}

const dependencies = request.authoritativeTopology?.dependencies;
for (const field of [
  "postgresTlsEndpointPresent",
  "postgresCredentialSecretReferencePresent",
  "jetstreamTlsEndpointPresent",
  "jetstreamCredentialSecretReferencePresent",
  "eventKeySecretReferencePresent",
  "deploymentIdentityPresent",
]) {
  assert(dependencies?.[field] === false, `dependency ${field} must remain false`);
}
assert(dependencies?.bftPayOrigin === null, "BFT/Pay origin must remain unset");

const service = request.authoritativeTopology?.service;
assert(service?.unit === "ynx-data-fabricd", "service unit is unexpected");
assert(service?.bridgeUnit === "ynx-pay-data-fabric-bridge", "bridge unit is unexpected");
for (const field of ["currentRelease", "currentArchiveSha256", "currentConfigSha256"]) {
  assert(service?.[field] === null, `service ${field} must remain unset`);
}

const mapping = request.requiredCurrentAndRollbackMapping;
assert(mapping?.currentMappingApproved === false, "current mapping must remain unapproved");
assert(mapping?.rollbackMappingApproved === false, "rollback mapping must remain unapproved");
assert(typeof mapping?.rollbackInvariant === "string" && mapping.rollbackInvariant.includes("retain committed Outbox records"), "rollback must retain the Outbox");
assert(request.secrets?.valuesInThisRequest === false, "request must not contain secret values");
assert(request.secrets?.allowedDelivery === "Access-controlled secret-manager references only", "secret delivery boundary is unexpected");

console.log(JSON.stringify({
  status: "verified",
  requestId: request.requestId,
  productionMutationAllowed: request.deploymentAuthorization.productionMutationAllowed,
  publicEndpointBound: request.authoritativeTopology.fabric.publicBaseUrl !== null,
}));
