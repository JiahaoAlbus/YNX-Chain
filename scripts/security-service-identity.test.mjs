import test from "node:test";
import assert from "node:assert/strict";
import { validateServiceIdentity } from "./security-service-identity.mjs";

const now = new Date("2026-07-25T07:00:00.000Z");

function fixture() {
  const identity = {
    serviceId: "oracle-reporter",
    productId: "19-oracle",
    environment: "testnet",
    workloadIdentity: "spiffe://ynx.test/testnet/19-oracle/oracle-reporter",
    certificateSubject: "oracle-reporter",
    certificateIssuer: "YNX Test CA",
    trustDomain: "ynx.test",
    sanUri: "spiffe://ynx.test/testnet/19-oracle/oracle-reporter",
    audiences: ["data-fabric"],
    scopes: ["market-data:publish"],
    notBefore: "2026-07-25T06:59:00.000Z",
    expiresAt: "2026-07-25T08:00:00.000Z",
    rotationDueAt: "2026-07-25T07:30:00.000Z",
    serialNumber: "01AB",
    revoked: false,
    owner: "19-oracle",
  };
  const peer = {
    authorized: true,
    serialNumber: "01AB",
    subjectCN: "oracle-reporter",
    issuerCN: "YNX Test CA",
    subjectAltName: "URI:spiffe://ynx.test/testnet/19-oracle/oracle-reporter",
  };
  const policy = {
    environment: "testnet",
    trustDomain: "ynx.test",
    trustedIssuers: ["YNX Test CA"],
    expectedServiceId: "oracle-reporter",
    expectedProductId: "19-oracle",
    clockSkewSeconds: 60,
    replayWindowSeconds: 300,
    revokedSerials: [],
  };
  const request = {
    audience: "data-fabric",
    requiredScopes: ["market-data:publish"],
    issuedAt: now.toISOString(),
    nonce: "nonce-000000000001",
  };
  return { identity, peer, policy, request };
}

function decide(overrides = {}, replayCache = new Set()) {
  const base = fixture();
  return validateServiceIdentity({
    identity: { ...base.identity, ...(overrides.identity ?? {}) },
    peer: { ...base.peer, ...(overrides.peer ?? {}) },
    policy: { ...base.policy, ...(overrides.policy ?? {}) },
    request: { ...base.request, ...(overrides.request ?? {}) },
    replayCache,
    now,
  });
}

test("valid service identity is allowed with bounded audit metadata", () => {
  const result = decide();
  assert.equal(result.allow, true);
  assert.equal(result.audit.serviceId, "oracle-reporter");
  assert.equal(result.audit.audience, "data-fabric");
  assert.deepEqual(result.audit.scopes, ["market-data:publish"]);
});

test("wrong service, product, environment, audience, and scope fail closed", () => {
  assert.equal(decide({ policy: { expectedServiceId: "bridge-relayer" } }).errorCode, "SERVICE_IDENTITY_INVALID");
  assert.equal(decide({ policy: { expectedProductId: "21-bridge" } }).errorCode, "SERVICE_IDENTITY_INVALID");
  assert.equal(decide({ policy: { environment: "production" } }).errorCode, "SERVICE_ENVIRONMENT_MISMATCH");
  assert.equal(decide({ request: { audience: "treasury" } }).errorCode, "SERVICE_AUDIENCE_MISMATCH");
  assert.equal(decide({ request: { requiredScopes: ["treasury:write"] } }).errorCode, "SERVICE_SCOPE_DENIED");
});

test("certificate subject, SAN, issuer, expiry, staleness, and revocation are enforced", () => {
  assert.equal(decide({ peer: { subjectCN: "other-service" } }).errorCode, "SERVICE_IDENTITY_INVALID");
  assert.equal(decide({ peer: { subjectAltName: "URI:spiffe://ynx.test/testnet/other" } }).errorCode, "SERVICE_IDENTITY_INVALID");
  assert.equal(decide({ identity: { certificateIssuer: "Other CA" }, peer: { issuerCN: "Other CA" } }).errorCode, "CERTIFICATE_ISSUER_UNTRUSTED");
  assert.equal(decide({ identity: { expiresAt: "2026-07-25T06:58:00.000Z" } }).errorCode, "CERTIFICATE_EXPIRED");
  assert.equal(decide({ identity: { rotationDueAt: "2026-07-25T06:59:59.000Z" } }).errorCode, "CERTIFICATE_STALE");
  assert.equal(decide({ identity: { revoked: true } }).errorCode, "CERTIFICATE_REVOKED");
  assert.equal(decide({ policy: { revokedSerials: ["01AB"] } }).errorCode, "CERTIFICATE_REVOKED");
});

test("nonce replay, stale requests, and excessive future clock skew are rejected", () => {
  const replayCache = new Set();
  assert.equal(decide({}, replayCache).allow, true);
  assert.equal(decide({}, replayCache).errorCode, "REPLAY_DETECTED");
  assert.equal(decide({ request: { issuedAt: "2026-07-25T06:53:00.000Z" } }).errorCode, "REQUEST_STALE");
  assert.equal(decide({ request: { issuedAt: "2026-07-25T07:02:00.000Z" } }).errorCode, "CLOCK_SKEW_EXCEEDED");
});
