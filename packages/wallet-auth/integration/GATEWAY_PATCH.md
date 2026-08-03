# Canonical Gateway integration patch

## Conflict being removed

The current central App Gateway issues a separate ownership session from a direct `ynx1` signature plus Ed25519 device key and accepts a hashed opaque session token. That flow does not bind Product Registry, Wallet approval, callback, ordered scopes, request/approval digests or the canonical P-256 product device. It must not be accepted as a canonical Wallet Product Session.

## Executable merge surface

Source commit `2eb3198a99fcd98a1c6d56e3e99e97166ceab7f6` provides `CanonicalWalletGatewayHttpKernel` plus the source-bound `CanonicalWalletGatewayNodeHost`. The kernel remains the executable protocol boundary; the Node host adds fail-closed persistence and bounded observability. The central owner should mount or faithfully wrap these boundaries behind its durable transaction and ingress layer rather than reinterpret Wallet semantics.

1. Load `central-registry.json` from an immutable, versioned deployment asset. The kernel parses and freezes it at construction; callers cannot inject or mutate registry authority after startup.
2. Pass the exact method, canonical path, exact `application/json` content type, raw canonical JSON body and separately decoded Product Session proof header to `dispatch`.
3. Do not place the proof in the business body. The proof signs the SHA-256 digest of the exact canonical business body, so embedding it would create a self-reference and break the protocol binding.
4. Persist `kernel.snapshot()` with compare-and-swap or one database transaction after every response where `mutated` is true. Persist the returned `stateDigest` with the same transaction and verify it on reload.
5. Mount all twelve routes declared in `gateway-integration.manifest.json`, including session/approval/device revoke, Wallet-only account logout-all, and every StrategyMandate control.
6. Preserve request atomicity: failures must retain the pre-request snapshot. Never consume a Product Session proof when a later mandate validation or state transition fails.
7. Store state with least privilege, encrypted backups and restore verification. Product proof replay state, Product Sessions, revocations, StrategyMandates, action nonces and terminal controls share one transaction boundary.
8. Preserve generated request/trace/error IDs, bounded route/error metric labels and canonical redacted events. Never log request bodies, Product Session proofs, authorization headers, Wallet signatures, raw Credentials, private keys, seed/recovery material, state paths or provider secrets. Event-sink failure must not fail authorization and must increment the drop metric.
9. Require a full lowercase source commit, bounded release identifier and canonical UTC build time before any process is classified `remoteDeployed=true`; do not infer staging/public status from process health.

## Required transport mapping

- HTTP method: `POST` only.
- Content type: exactly `application/json` after the host normalizes and validates the header.
- Body: canonical JSON business payload, maximum 1,048,576 UTF-8 bytes.
- Product proof: separate decoded header object, or `null` only for session completion.
- Response: canonical JSON, `Cache-Control: no-store`, stable status/error code, state digest, request/trace IDs and an error ID on rejection.
- Path: exact registered path without query, fragment, trailing slash, duplicate slash or percent-encoded alias.
- Administrative probes: loopback-only `GET /health`, `/ready`, `/version` and `/metrics`; they are not canonical business routes and must remain outside bearer compatibility.
- Readiness: `runtimeReady` and `publicDeploymentReady` are separate facts; `/version` must expose the exact deployed build identity.

## Legacy migration and rollback

Legacy ownership sessions are not migrated into canonical Product Sessions. During a bounded compatibility window, old routes may remain isolated under their existing namespace and must never authorize canonical routes. New clients use only `/v1/wallet/sessions/*` and `/v1/wallet/mandates*`. Rollback disables canonical issuance, preserves all replay/revoke/mandate state, and never converts a new session into a legacy token. Removal requires usage telemetry, user notice and all legacy sessions expiring or being revoked.

## Acceptance

Run the commands in `gateway-integration.manifest.json`. Current local evidence is Wallet/Auth 94/94, Node host 8/8, Browser SDK 7/7, JS SDK 5/5, a real loopback CLI smoke, `npm pack --dry-run` passed and `umask 0022; go test ./...` passed. The tests cover immutable registry authority, request-level rollback, canonical JSON, proof-header/body binding, replay, restart, state digest, scope/device/path/body substitution, mandate proof atomicity, exact build identity, ID headers, bounded metrics, event redaction and sink-failure isolation. Validate the shared vectors independently in the central implementation before setting `integratedCentral` true.
