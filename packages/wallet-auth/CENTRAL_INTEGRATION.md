# Central Wallet Auth integration contract

The executable integration adapter is `src/gateway-adapter.js`; the merge manifest, versioned state schema and central patch instructions are in `integration/`. `testdata/product-session-http-proof-v1.json` is the deterministic P-256 sender-constrained HTTP proof vector. These artifacts supersede any assumption that possession of a session binding or legacy opaque token is sufficient for canonical introspection.

This is the merge-ready central protocol candidate implemented and tested by `@ynx-chain/wallet-auth`. It is **not** evidence of central review, central integration, staging deployment, or public deployment. The candidate registry therefore keeps every product disabled.

## Canonical registry

`central-registry.json` is the only 25-product candidate inventory. The top-level schema is exact: `registryVersion`, `chainId`, `products`. It requires version `1`, chain `ynx_6423-1`, exactly 25 alphabetically sorted products, and globally unique client IDs, bundle IDs, and callbacks.

Each product registration uses exact schema v3 fields:

```json
{
  "schemaVersion": 3,
  "productId": "social",
  "displayName": "YNX Social",
  "reviewState": "pending-review",
  "enabled": false,
  "productClientId": "ynx-social-v1",
  "requestingProduct": "social",
  "bundleId": "com.ynx.social",
  "callbacks": ["ynx-social://com.ynx.social"],
  "scopes": ["account:read", "profile:link"],
  "maxScopes": 2,
  "productDeviceAlgorithms": ["p256-sha256"],
  "sessionDurationSeconds": 240,
  "revocationPolicy": {"session":true,"approval":true,"device":true,"accountAllDevices":true}
}
```

`reviewState` is `approved`, `pending-review`, or `disabled`; `enabled` must be true exactly when approved. `centralRegistrationByProduct` and `centralProtocolEntry` reject disabled entries by default. Callers may pass `{requireEnabled:false}` only for review tooling and tests, never for session issuance. No wildcard scope, callback, client, or bundle is allowed.

Schema v2 remains the exact protocol projection consumed by the verifier: `schemaVersion`, `productClientId`, `requestingProduct`, `bundleId`, `callbacks`, `scopes`, `maxScopes`, and `productDeviceAlgorithms`. `migrateCentralRegistryEntry` converts the exact legacy single-callback v1 shape to v2 and rejects extra fields.

`registry-conflict-evidence.json` records known identity and central implementation conflicts. It must be reviewed with the owning product worktrees before any product is marked approved.

## Canonical envelope and verifier

Authorization transport is `ynxwallet://authorize?request=<base64url(canonical JSON)>`. The response callback has exactly one `response` query field. The canonical request and approval bind:

- `ynx_6423-1`, requesting product, client ID, bundle/package, callback;
- compressed P-256 product device public key and algorithm;
- native `ynx1` account and secp256k1 account public key;
- exact ordered scopes, nonce, human-readable purpose, request digest, issue time, and expiry.

After Wallet approval, Gateway issues the exact short-lived challenge. The product device signs `YNX_PRODUCT_SESSION_CHALLENGE_V1\n<canonical challenge JSON>` with ECDSA P-256/SHA-256 and canonical DER encoding. Gateway then calls:

```ts
const session = verifyCentralWalletSession({
  registryEntry,
  authorizationRequest,
  walletApproval,
  gatewayCompletion,
}, now);
```

The returned session additionally binds `sessionBinding`, `approvalDigest`, and `deviceBinding`. It can be accepted only by the exact client, bundle, product device key, and granted scopes.

## Transactional lifecycle

`CentralWalletSessionStore` is the executable reference lifecycle. `complete` verifies the whole envelope, then consumes nonce, request digest, and Gateway challenge and writes the session as one state transition. Any error restores the prior snapshot. A restart revalidates exact snapshot fields, consumed-record coverage, session schemas, and the hash-chained audit log.

Gateway should implement the same transaction in its durable database, not use this in-memory reference as production storage:

1. Lock/read the reviewed enabled registration and revocation state.
2. Verify Wallet approval and product-device proof.
3. Reject an already consumed nonce, request digest, challenge, or session binding.
4. Persist all three consumption tombstones, the session, and audit event atomically.
5. Commit; never emit a session before commit.

Before each use, either call `store.introspect(sessionBinding, exactContext, now)` or:

```ts
assertCentralWalletSessionActive(session, {
  revokedSessionBindings,
  revokedApprovalDigests,
  revokedDeviceBindings,
  accountLogoutRecords,
}, now);
```

The four controls revoke one session, every session from one approval, every session on one product device, or every session for an account issued at/before an all-devices logout. Lists and records are exact, sorted, unique, and bounded. Expiry, future issuance, cross-App reuse, missing scopes, and every revocation fail closed.

## Required central rollout

1. Resolve `registry-conflict-evidence.json` with each product owner; approve exact tuples individually.
2. Import this package without forking canonical JSON, digest domains, schemas, or vectors.
3. Implement durable transactional challenge/session/revocation persistence and authenticated endpoints for completion, introspection, session revoke, approval revoke, device revoke, and account all-devices logout.
4. Run all package tests and vectors in central Gateway CI, including replay, restart, audit tamper, callback interception, scope mutation, cross-App reuse, and all four revocations.
5. Deploy registry and verifier atomically to staging, record registry version/hash and deployment evidence, then run real Wallet↔product tests.

Until those steps are complete, truthful status is `implemented-local` and `tested-local`, not `integrated-central` or `deployed-staging`.
