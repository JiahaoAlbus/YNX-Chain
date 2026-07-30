# Bridge Data Lifecycle

## Scope and authority

YNX Bridge persists coordinator-observed transfer, source-event uniqueness, idempotency, relayer attestation, lifecycle, safety, reconciliation, data-rights request, and hash-chained audit records. These are YNX coordinator records, not complete source-chain, destination-chain, Wallet, provider, or legal-case histories. Provider retention is not inferred; the currently inspected CCTP candidate is unavailable for YNX and no provider data is held.

The protected export and deletion routes are operator-service controls pending canonical App Gateway integration. They are not public self-service endpoints. The Bridge API key must never be given to a browser or consumer product.

## Export

`GET /bridge/data-exports/{account}` returns a versioned export with `source`, `asOf`, `coverage`, the configured retention policy, exact matching coordinator transfers, and related deletion requests. Empty results are valid and do not claim that other systems hold no data. Exports are `Cache-Control: no-store` and remain behind the protected coordinator boundary.

## Retention and deletion

`YNX_BRIDGE_RETENTION_PERIOD` defaults to seven 365-day years and is constrained to 24 hours through ten 365-day years. Production policy requires legal approval before changing it.

`POST /bridge/data-deletion-requests` records an idempotent request. Any transfer outside `destination_confirmed` or `refund_recovery` produces `safety_hold` with no eligibility date. Terminal records produce `pending_retention` until the latest matching transfer update plus the configured period. `POST /bridge/data-deletion-requests/{id}/execute` is a separate idempotent operator action and fails closed while either condition remains.

Eligible execution replaces matching sender/recipient identities with deterministic `redacted:sha256:` pseudonyms and marks every request for the same account digest complete. It preserves transfer ID, source event, source and destination chains/assets, amount, finality, evidence references, reconciliation, and audit continuity. The account digest and pseudonym are linkable and therefore pseudonymized, not anonymous. They exist to preserve duplicate/replay, solvency, dispute, accounting, and security evidence. Legal hold, sanctions, court order, unresolved dispute, or incident procedures may require a separately approved longer retention policy; no such external hold system is integrated locally.

## Service cessation and user exit

Before stopping Bridge service:

1. Persistently pause new transfer creation and local finalization; publish the exact coordinator/public-route status without claiming an externally live bridge.
2. Inventory every nonterminal transfer and route exposure. Do not shut down while recovery, refund, dispute, or destination confirmation remains unresolved unless an approved emergency owner accepts the case handoff.
3. Record a final source-qualified reconciliation and preserve any imbalance visibly.
4. Keep protected read/export access available for an announced export window, subject to canonical identity and support approval.
5. Produce mode-0600 state and audit backups, SHA-256/byte manifests, restore proof, and the exact source/build identity. Verify the archive before destroying online copies.
6. Revoke API, relayer, provider, signer, monitoring, and deployment credentials after transfer and support handoff. Never publish or transmit those secrets in an export.
7. Remove ingress and mutation capacity, retain only the approved evidence archive for the documented period, and publish the final support/status location when externally authorized.

This local candidate cannot execute an external emergency exit, mint, release, refund, or provider withdrawal. A real route must supply and test those procedures before deployment; local pause and export functionality must not be described as asset recovery.
