import test from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  authorizeBreakGlass,
  breakGlassPolicyDigest,
  breakGlassSigningPayload,
} from "./security-break-glass.mjs";

const sourceCommit = "a".repeat(40);
const now = new Date("2026-07-26T10:05:00.000Z");

function keyFingerprint(publicKey) {
  return `sha256:${createHash("sha256").update(
    publicKey.export({ type: "spki", format: "der" }),
  ).digest("hex")}`;
}

function signer(id, role) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    id,
    role,
    privateKey,
    publicKeyFingerprint: keyFingerprint(publicKey),
    publicKeyJwk: publicKey.export({ format: "jwk" }),
  };
}

function fixtures() {
  const security = signer("security-approver", "security");
  const sre = signer("sre-approver", "sre");
  const request = {
    schemaVersion: 1,
    requestId: "bg-20260726-0001",
    incidentId: "inc-20260726-0001",
    policyId: "ynx-break-glass-production-v1",
    sourceCommit,
    requestedBy: "incident-commander",
    operatorIdentity: "isolated-operator",
    product: "30-security-platform",
    environment: "production",
    scope: "secret-manager:rotate",
    resourceId: "deploy-production",
    resourceReferenceSha256: "b".repeat(64),
    reason: "Emergency credential rotation after confirmed compromise",
    createdAt: "2026-07-26T10:00:00.000Z",
    expiresAt: "2026-07-26T10:15:00.000Z",
    nonce: "break-glass-nonce-20260726-0001",
  };
  const policy = {
    schemaVersion: 1,
    policyId: request.policyId,
    sourceCommit,
    status: "active",
    environment: "production",
    minimumApprovals: 2,
    minimumDistinctRoles: 2,
    maxAuthorizationSeconds: 900,
    allowedScopes: [
      "secret-manager:rotate",
      "service-identity:revoke",
    ],
    approvers: [security, sre].map((entry) => ({
      id: entry.id,
      role: entry.role,
      publicKeyFingerprint: entry.publicKeyFingerprint,
      publicKeyJwk: entry.publicKeyJwk,
      allowedScopes: policyScopes(entry.role),
      environments: ["production"],
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: null,
    })),
  };
  return { request, policy, signers: [security, sre] };
}

function policyScopes(role) {
  return role === "security"
    ? ["secret-manager:rotate", "service-identity:revoke"]
    : ["secret-manager:rotate"];
}

function approval(request, policyId, entry, overrides = {}) {
  const payload = breakGlassSigningPayload(request);
  return {
    schemaVersion: 1,
    policyId,
    requestDigest: createHash("sha256").update(payload).digest("hex"),
    approverId: entry.id,
    keyFingerprint: entry.publicKeyFingerprint,
    signedAt: "2026-07-26T10:04:00.000Z",
    signatureBase64: sign(null, payload, entry.privateKey).toString("base64"),
    ...overrides,
  };
}

function authorize({ mutateRequest, mutatePolicy, mutateApprovals } = {}) {
  const fixture = fixtures();
  const request = mutateRequest ? mutateRequest(fixture.request) : fixture.request;
  const policy = mutatePolicy ? mutatePolicy(fixture.policy) : fixture.policy;
  let approvals = fixture.signers.map((entry) => approval(
    fixture.request,
    fixture.policy.policyId,
    entry,
  ));
  if (mutateApprovals) approvals = mutateApprovals(approvals, fixture);
  return authorizeBreakGlass({
    request,
    policy,
    approvals,
    sourceCommit,
    trustedPolicySha256: breakGlassPolicyDigest(policy),
    now,
  });
}

test("two independent roles authorize a bounded break-glass receipt", () => {
  const result = authorize();
  assert.equal(result.action, "break-glass-authorization");
  assert.equal(result.sourceCommit, sourceCommit);
  assert.equal(result.confidence, "cryptographically-verified-against-pinned-policy");
  assert.equal(result.approvals.length, 2);
  assert.equal(new Set(result.approvals.map((entry) => entry.role)).size, 2);
  assert.equal(result.oneTimeUseRequired, true);
  assert.equal(result.oneTimeUseEnforcedByThisReceipt, false);
  assert.equal(result.consumptionLedgerRequired, true);
  assert.equal(result.automaticExecutionAllowed, false);
  assert.equal(result.secretValueIncluded, false);
  assert.equal(result.expiresAt, "2026-07-26T10:15:00.000Z");
  assert.equal(result.approvals.every((entry) => /^[0-9a-f]{64}$/.test(entry.signatureSha256)), true);
  assert.equal("reason" in result, false);
  assert.equal("publicKeyJwk" in result, false);
  assert.equal(JSON.stringify(result).includes("signatureBase64"), false);
});

test("tampered request and signature are rejected", () => {
  assert.throws(
    () => authorize({
      mutateRequest: (request) => ({ ...request, resourceId: "treasury-production" }),
    }),
    /request digest does not match/,
  );
  assert.throws(
    () => authorize({
      mutateApprovals: (approvals) => approvals.map((entry, index) => (
        index === 0
          ? { ...entry, signatureBase64: Buffer.alloc(64, 7).toString("base64") }
          : entry
      )),
    }),
    /signature verification failed/,
  );
});

test("threshold requires independent approvers and distinct roles", () => {
  assert.throws(
    () => authorize({
      mutateApprovals: (approvals) => [approvals[0]],
    }),
    /approval threshold was not met/,
  );
  assert.throws(
    () => authorize({
      mutatePolicy: (policy) => ({
        ...policy,
        approvers: policy.approvers.map((entry) => ({ ...entry, role: "security" })),
      }),
    }),
    /distinct-role threshold was not met/,
  );
});

test("requester and isolated operator cannot approve their own request", () => {
  const approveRequest = (request) => {
    const fixture = fixtures();
    return authorizeBreakGlass({
      request,
      policy: fixture.policy,
      approvals: fixture.signers.map((entry) => approval(
        request,
        fixture.policy.policyId,
        entry,
      )),
      sourceCommit,
      trustedPolicySha256: breakGlassPolicyDigest(fixture.policy),
      now,
    });
  };
  const first = fixtures();
  assert.throws(
    () => approveRequest({ ...first.request, requestedBy: "security-approver" }),
    /cannot approve their own/,
  );
  const second = fixtures();
  assert.throws(
    () => approveRequest({ ...second.request, operatorIdentity: "sre-approver" }),
    /cannot approve their own/,
  );
});

test("wildcard, excessive lifetime, expiry, and source drift fail closed", () => {
  assert.throws(
    () => authorize({
      mutateRequest: (request) => ({ ...request, scope: "secret-manager:*" }),
    }),
    /scope is not permitted/,
  );
  assert.throws(
    () => authorize({
      mutateRequest: (request) => ({
        ...request,
        expiresAt: "2026-07-26T11:00:01.000Z",
      }),
    }),
    /exceeds the policy lifetime/,
  );
  assert.throws(
    () => authorize({
      mutateRequest: (request) => ({
        ...request,
        expiresAt: "2026-07-26T10:04:59.000Z",
      }),
    }),
    /request is expired/,
  );
  const fixture = fixtures();
  assert.throws(
    () => authorizeBreakGlass({
      request: fixture.request,
      policy: fixture.policy,
      approvals: fixture.signers.map((entry) => approval(
        fixture.request,
        fixture.policy.policyId,
        entry,
      )),
      sourceCommit: "c".repeat(40),
      trustedPolicySha256: breakGlassPolicyDigest(fixture.policy),
      now,
    }),
    /policy sourceCommit does not match/,
  );
});

test("authorization requires an externally pinned policy digest", () => {
  const fixture = fixtures();
  assert.throws(
    () => authorizeBreakGlass({
      request: fixture.request,
      policy: fixture.policy,
      approvals: fixture.signers.map((entry) => approval(
        fixture.request,
        fixture.policy.policyId,
        entry,
      )),
      sourceCommit,
      trustedPolicySha256: "f".repeat(64),
      now,
    }),
    /does not match the trusted digest/,
  );
});

test("approver registry rejects private material, shared keys, and revoked identities", () => {
  assert.throws(
    () => authorize({
      mutatePolicy: (policy) => ({
        ...policy,
        approvers: policy.approvers.map((entry, index) => (
          index === 0 ? { ...entry, privateMaterial: "forbidden" } : entry
        )),
      }),
    }),
    /unknown fields: privateMaterial/,
  );
  assert.throws(
    () => authorize({
      mutatePolicy: (policy) => ({
        ...policy,
        approvers: policy.approvers.map((entry, index) => (
          index === 1
            ? {
              ...entry,
              publicKeyFingerprint: policy.approvers[0].publicKeyFingerprint,
              publicKeyJwk: policy.approvers[0].publicKeyJwk,
            }
            : entry
        )),
      }),
    }),
    /keys must be independent/,
  );
  assert.throws(
    () => authorize({
      mutatePolicy: (policy) => ({
        ...policy,
        approvers: policy.approvers.map((entry, index) => (
          index === 0 ? { ...entry, revokedAt: "2026-07-25T00:00:00.000Z" } : entry
        )),
      }),
    }),
    /approver is not active/,
  );
});
