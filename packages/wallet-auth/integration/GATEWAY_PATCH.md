# Canonical Gateway integration patch

## Conflict being removed

The current central App Gateway issues a separate ownership session from a direct `ynx1` signature plus Ed25519 device key and accepts a hashed opaque session token. That flow does not bind Product Registry, Wallet approval, callback, ordered scopes, request/approval digests or the canonical P-256 product device. It must not be accepted as a canonical Wallet Product Session.

## Merge sequence

1. Vendor `@ynx-chain/wallet-auth` or port its exact vector-verified parsers into the central language. Do not re-interpret field ordering or URL canonicalization.
2. Load `central-registry.json` from an immutable versioned deployment asset. The server selects the product by `productClientId`; request bodies cannot supply a registry entry.
3. Add the three routes in `gateway-integration.manifest.json`. Complete authorization atomically consumes request nonce, request digest and device challenge while creating the Product Session.
4. Require `YNX_PRODUCT_SESSION_HTTP_PROOF_V1` on every introspection or revoke call. Verify P-256 signature plus session, client, bundle, device key, method, canonical path, raw-body SHA-256, nonce and a maximum 60-second window.
5. Persist adapter state atomically with mode `0600`, fsync/rename semantics and encrypted backups. Proof replay digests and session/revoke state must share one transaction boundary in the production store.
6. Expose structured outcome metrics and audit IDs; never log proof signatures, Wallet signatures, raw Credentials, private keys or recovery material.

## Legacy migration and rollback

Legacy ownership sessions are not migrated into canonical Product Sessions. During a bounded compatibility window, old routes may remain isolated under their existing route namespace and must never authorize canonical routes. New clients use only `/v1/wallet/sessions/*`. Rollback disables canonical issuance, preserves revoke/replay state, and never converts new sessions into legacy tokens. Removal requires usage telemetry, user notice and all remaining legacy sessions expiring or being revoked.

## Acceptance

Run `npm test` in `packages/wallet-auth`. The Gateway adapter tests prove server-selected registry authority, disabled-product rejection, method/path/body tamper rejection, sender-constrained proof replay prevention, persisted revoke behavior and a 2,000-proof soak. Validate the published JSON test vector independently in the central implementation before setting `integratedCentral` true.
