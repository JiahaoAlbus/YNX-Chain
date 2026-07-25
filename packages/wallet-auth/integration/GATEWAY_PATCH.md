# Canonical Gateway integration patch

## Conflict being removed

The current central App Gateway issues a separate ownership session from a direct `ynx1` signature plus Ed25519 device key and accepts a hashed opaque session token. That flow does not bind Product Registry, Wallet approval, callback, ordered scopes, request/approval digests or the canonical P-256 product device. It must not be accepted as a canonical Wallet Product Session.

## Executable merge surface

Source commit `d89ec9da11a3ec0e4bcec12edae09ec7a2e4fe2e` exports `CanonicalWalletGatewayHttpKernel` from `@ynx-chain/wallet-auth`. The kernel is the executable HTTP boundary around the canonical adapter; the central owner should mount it behind its own listener and durable transaction layer rather than reinterpret Wallet semantics.

1. Load `central-registry.json` from an immutable, versioned deployment asset. The kernel parses and freezes it at construction; callers cannot inject or mutate registry authority after startup.
2. Pass the exact method, canonical path, exact `application/json` content type, raw canonical JSON body and separately decoded Product Session proof header to `dispatch`.
3. Do not place the proof in the business body. The proof signs the SHA-256 digest of the exact canonical business body, so embedding it would create a self-reference and break the protocol binding.
4. Persist `kernel.snapshot()` with compare-and-swap or one database transaction after every response where `mutated` is true. Persist the returned `stateDigest` with the same transaction and verify it on reload.
5. Mount all twelve routes declared in `gateway-integration.manifest.json`, including session/approval/device revoke, Wallet-only account logout-all, and every StrategyMandate control.
6. Preserve request atomicity: failures must retain the pre-request snapshot. Never consume a Product Session proof when a later mandate validation or state transition fails.
7. Store state with least privilege, encrypted backups and restore verification. Product proof replay state, Product Sessions, revocations, StrategyMandates, action nonces and terminal controls share one transaction boundary.
8. Emit structured outcome metrics and audit IDs; never log proof signatures, Wallet signatures, raw Credentials, private keys, seed/recovery material or full provider secrets.

## Required transport mapping

- HTTP method: `POST` only.
- Content type: exactly `application/json` after the host normalizes and validates the header.
- Body: canonical JSON business payload, maximum 1,048,576 UTF-8 bytes.
- Product proof: separate decoded header object, or `null` only for session completion.
- Response: canonical JSON, `Cache-Control: no-store`, stable status/error code and state digest.
- Path: exact registered path without query, fragment, trailing slash, duplicate slash or percent-encoded alias.

## Legacy migration and rollback

Legacy ownership sessions are not migrated into canonical Product Sessions. During a bounded compatibility window, old routes may remain isolated under their existing namespace and must never authorize canonical routes. New clients use only `/v1/wallet/sessions/*` and `/v1/wallet/mandates*`. Rollback disables canonical issuance, preserves all replay/revoke/mandate state, and never converts a new session into a legacy token. Removal requires usage telemetry, user notice and all legacy sessions expiring or being revoked.

## Acceptance

Run the commands in `gateway-integration.manifest.json`. Current local evidence is Wallet/Auth 84/84, Browser SDK 7/7, JS SDK 5/5, `npm pack --dry-run` passed and `go test ./...` passed. The tests cover immutable registry authority, request-level rollback, canonical JSON, proof-header/body binding, replay, restart, state digest, scope/device/path/body substitution and mandate proof atomicity. Validate the shared vectors independently in the central implementation before setting `integratedCentral` true.
