# Central Gateway integration contract

This document defines the exact interface implemented by `@ynx-chain/wallet-auth`. It is an integration request, not evidence that central Gateway or registry deployment has occurred.

## Registry schema v2

The registry entry is exact JSON; unknown or missing fields fail closed:

```json
{
  "schemaVersion": 2,
  "productClientId": "ynx-social-v1",
  "requestingProduct": "social",
  "bundleId": "com.ynxweb4.social",
  "callbacks": ["ynxsocial://wallet-auth/callback"],
  "scopes": ["account:read", "profile:link"],
  "maxScopes": 2,
  "productDeviceAlgorithms": ["p256-sha256"]
}
```

Arrays must be non-empty where required, unique, sorted, and canonical. The only version 1 product-device algorithm is `p256-sha256`; its key is a canonical unpadded base64url 33-byte compressed SEC1 P-256 point. Central registry is responsible for publishing this entry atomically with the product bundle/package and callback allow-list.

Legacy schema v1 has exact fields `schemaVersion`, `productClientId`, `requestingProduct`, `bundleId`, `callback`, `scopes`, and `maxScopes`. Call `migrateCentralRegistryEntry(v1)` once; it converts the single callback to `callbacks` and binds `productDeviceAlgorithms` to `p256-sha256`. It rejects extra fields and is idempotent for v2.

## Verifier transaction

The Gateway must call one entry point after receiving the product's device-signed completion:

```ts
const session = verifyCentralWalletSession({
  registryEntry,
  authorizationRequest,
  walletApproval,
  gatewayCompletion,
}, now);
```

The input object and every nested protocol object use exact schemas. The call performs, in order:

1. Parse the v2 registry and authorization request against the exact product, bundle, callback, algorithm, scope allow-list, issue time, expiry, and `ynx_6423-1` network.
2. Recompute the request digest and verify the Wallet compact secp256k1 approval, native `ynx1` account derivation, bindings, scopes, and lifetime.
3. Verify the Android-compatible SHA-256/ECDSA P-256 DER product-device proof over `YNX_PRODUCT_SESSION_CHALLENGE_V1\n<canonical challenge JSON>`.
4. Require exact request digest, client, bundle, algorithm/key, account, ordered scopes, and an expiry no later than the Wallet approval.
5. Return product-limited session claims. No Wallet secret or recovery material is accepted by this interface.

Before every session use, call:

```ts
assertCentralWalletSessionActive(session, {
  revokedSessionBindings,
  revokedRequestDigests,
}, now);
```

`revokedSessionBindings` revokes one product session. `revokedRequestDigests` revokes the Wallet approval and every session derived from it. Both arrays are exact, sorted 64-character lowercase hex digests. Expired and revoked sessions fail closed.

The registry read, challenge consume, replay consume, session write, and revocation read must occur in one central transactional boundary. A callback must not create a session before both the Wallet approval and device proof have passed this shared verifier. Do not fork the canonical JSON implementation or signing domains.

## Migration and rollout

1. Load v1 entries through `migrateCentralRegistryEntry`; compare the v2 output with the reviewed product inventory.
2. Dual-read v1/v2 registry storage but emit v2 only. Do not accept Ed25519 or SPKI hashes under `p256-sha256`.
3. Run `packages/wallet-auth/test/integration.test.mjs`, signer vectors, replay, tamper, scope, expiry, callback interception, and cross-App tests in Gateway CI.
4. Deploy the shared package and v2 registry atomically; reject unknown verifier versions.
5. After all clients are v2, remove the v1 storage reader. Keep the migration test and published vectors permanently.
