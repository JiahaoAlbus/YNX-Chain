# Central Wallet Auth integration contract

The executable integration boundary is `src/gateway-http.js`, backed by `src/gateway-adapter.js`; `src/gateway-node-host.js` adds fail-closed local persistence and bounded observability. The merge manifest, versioned state schema and central patch instructions are in `integration/`. `testdata/product-session-http-proof-v1.json` is the deterministic P-256 sender-constrained HTTP proof vector. These artifacts supersede any assumption that possession of a session binding or legacy opaque token is sufficient for canonical introspection. Source commit `2eb3198a99fcd98a1c6d56e3e99e97166ceab7f6` is the current locally tested candidate.

This is the merge-ready central protocol candidate implemented and tested by `@ynx-chain/wallet-auth`. It is **not** evidence of central integration, staging deployment, or public deployment. Product approval in this file means only that the exact Testnet identity and least-privilege scope tuple has passed product-owned review; it does not mean that a central Gateway or an installed end-to-end flow is live.

## Canonical registry

`central-registry.json` is the only 29-registration candidate inventory. The top-level schema is exact: `registryVersion`, `chainId`, `products`. It requires version `2`, chain `ynx_6423-1`, exactly 29 alphabetically sorted registrations, and globally unique product IDs, client IDs, bundle IDs, and callbacks. Registry v1 migrates only through the exact deterministic migration that replaces the obsolete generic Browser tuple with four disabled platform-bound Browser registrations and adds disabled, pending-review Quant.

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

## Approved Testnet product bindings

`calendar`, `developer`, `exchange`, `finance`, `quant`, and `shop` have approved
Testnet bindings. Each approval is restricted to the exact client, bundle,
callback, algorithms, duration, and least-privilege scopes listed in
`central-registry.json`. The Developer binding is specifically
`ynx-developer-v1` / `com.ynxweb4.developer.testnetpreview` /
`ynxdeveloper://wallet-auth/callback` with `account:read` and
`developer:deploy`; the Wallet app tests that exact deep link and refuses tuple or
scope substitution.

Approval is not transaction authority. Exchange actions, Quant mandates,
Calendar recovery, Developer deployment, and every other signed action remain
separate human-review and Gateway boundaries. The public Web Developer cannot
receive the native `ynxdeveloper://` callback, and the central Gateway lifecycle
is not deployed or attested; those flows must remain unavailable instead of
falling back to a bearer token, browser-injected signer, or simulated success.
All other products remain disabled until equivalent product-owned evidence exists.

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

## Executable HTTP boundary

`CanonicalWalletGatewayHttpKernel` accepts one strict host-normalized request object: `method`, `path`, exact `contentType`, raw canonical JSON `body`, and a separately decoded `proof` header object. Completion requires `proof: null`; authenticated routes require the exact P-256 Product Session proof outside the body. This avoids a self-referential body digest while still binding the signature to method, path and SHA-256 of the exact business payload.

The kernel freezes the parsed registry at construction, rejects alternate JSON encodings and unknown fields, enforces a 1 MiB body bound, restores the pre-request snapshot on every failure, and returns canonical JSON plus a deterministic state digest. The supplied Node host adds loopback health/readiness/version/metrics, generated request/trace/error IDs, exact remote build identity, atomic local file persistence and redacted canonical JSON events with event-sink failure isolation. Central deployment remains responsible for TLS/ingress, durable compare-and-swap storage, distributed tracing, accepted audit/event publication, rate limits and process supervision. It must persist `snapshot()` only after a successful state transition and must never convert the kernel into bearer-token compatibility.

## Required central rollout

1. Resolve `registry-conflict-evidence.json` with each product owner; approve exact tuples individually.
2. Import this package without forking canonical JSON, digest domains, schemas, vectors or proof transport.
3. Mount all twelve routes in `integration/gateway-integration.manifest.json`, including session, approval and product-device self-revoke plus canonical Wallet-only account logout-all.
4. Persist Gateway snapshot v2 atomically with Product Sessions, proof replay state, every revocation cutoff, StrategyMandates, action nonces and terminal controls; publish the canonical events only after the same durable commit succeeds.
5. Run all package tests and vectors in central Gateway CI, including canonical-body rejection, immutable registry authority, request rollback, replay, restart, audit tamper, callback interception, scope mutation, cross-App reuse, mandate limits, all revocations, exact build identity, ID headers, bounded metrics, event redaction and sink-failure isolation.
6. Deploy registry, kernel host and durable state migration atomically to staging; record registry hash, source commit, release, canonical build time, deployment ID and restore evidence, then run real Wallet↔product flows.
7. Have Monitor accept the bounded metric/event contract, prove dashboard and alert behavior, and correlate request/error IDs to authoritative audit IDs without logging custody or proof material.

Gateway Node state envelope v2 adds `registrySha256` and rejects a same-version
Registry substitution at startup and before every dispatch. Legacy v1 envelopes
require explicit one-time `allowLegacyStateMigration`; operators must perform that
migration against a copied state file, verify the v2 Registry digest, and disable
the flag before staging or public service. Replacing a v2 file with v1 while the
flag is disabled returns `LEGACY_STATE_MIGRATION_REQUIRED` without rewriting it.

Current focused verification on 2026-08-10 is Wallet/Auth 105/105, Wallet app
39/39, and Wallet app TypeScript typecheck, all passing. Earlier Node host,
Browser SDK, JS SDK, loopback CLI, package, and Go evidence remains subject to
its recorded source identity. Until central merge and direct Testnet/public
evidence exist, truthful status remains `implemented-local` and `tested-local`,
not `integrated-central` or `deployed-staging`.

The Node host `/version` response now binds its exact validated canonical
registry using `registrySha256` and the sorted `enabledProductClientIds`. Product
gateways must require both values, not infer enablement from process health or a
source commit. This attestation is runtime evidence for the loaded registry; it
does not by itself prove ingress routing or an installed Wallet-to-product flow.
