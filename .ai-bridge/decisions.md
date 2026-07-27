# Decisions

## D-001 — Internet provider boundary

Use a provider-neutral Mail interface with a concrete Resend HTTPS adapter. This avoids embedding a second central gateway inside Mail while retaining a replaceable provider boundary.

## D-002 — Delivery truth

Provider API acceptance is `provider_accepted`, not `delivered`. A verified delivery webhook means the receiving mail server accepted the message. Provider open/click telemetry is never promoted to YNX user-read state.

## D-003 — Webhook integrity

Verify the raw bounded webhook body before JSON interpretation, enforce a five-minute timestamp tolerance, compare HMAC in constant time and persist provider event IDs for restart-safe replay protection.

## D-004 — Retry identity

Each explicit retry increments a delivery attempt and receives a distinct idempotency key. Old provider message IDs and event timestamps are cleared before the new attempt.

## D-005 — Release truth

Current-source artifacts are not marked installed or hosted. Historical 0.2.0 artifacts are retained only as historical evidence and are explicitly identified as not containing the current Internet Bridge.

## D-006 — Ownership

Shared `go test ./...` failures in consensus, Developer artifacts, Faucet and Trust key permissions are recorded but not repaired in the Mail worktree.

## D-007 — Suppression and recovery privacy

Verified complaint, permanent-bounce and provider-suppression events create a persistent recipient-hash suppression record and block future provider calls. Dead letters are sender-scoped, capped at 1000 records and omit internal sender identity from API responses. Unsuppression remains unavailable until a centrally authorized Trust/Monitor policy exists.

## D-008 — Backup boundary and restore semantics

The self-contained backup contains the Mail state HMAC key and sender identity key, so it is sensitive operator material and is valid only inside an approved encrypted backup boundary. Restore validates the exact bytes later installed, requires mode `0700`/`0600`, rejects undeclared files and inconsistent Ed25519 keys, and reserves the destination with no-replace semantics. This evidence proves local integrity and recovery under that storage boundary; it is not an external-signature or hostile-storage authenticity claim.

## D-009 — Security gate truth

A validation script that cannot run its scanner dependency is not a passing gate. The current shared placeholder and secret scripts print success and exit 0 when `rg` is absent; Mail records those runs as invalid and leaves repair ownership with 30 Security/SRE.
