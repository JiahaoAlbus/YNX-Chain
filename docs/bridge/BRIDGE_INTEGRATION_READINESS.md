# Bridge Integration Readiness

The repository contains a fail-closed `ynx-bridged` coordinator implementation for local engineering review. It persists transfer intents, enforces globally unique source events and exact idempotency, verifies allowlisted Ed25519 relayer attestations, requires configured finality and a threshold of at least two relayers, enforces per-transfer, UTC-daily, user-outstanding, and provider/route-outstanding limits, applies persisted large-transfer delay, exposes persistent pause/resume controls, records a hash-chained audit trail, and finalizes only local coordinator state. `make bridge-api-check` and the deployment dry-run verify the bounded runtime and package path.

The machine-readable lifecycle distinguishes `source_submitted`, `source_accepted`, `source_finalized`, `proof_attestation`, `destination_mint_release`, `destination_confirmed`, `failed`, `refund_recovery`, `dispute`, and `retry`. Schema v4 retains each coordinator-observed transition in an ordered event timeline with source, timestamp, evidence, reason, and coverage; retry no longer disappears when the operational phase resumes. Schema v5 separately records exposure as open, destination-confirmed, or refund-recovered, so a later dispute does not falsely reopen settled exposure. Schema v6 persists exact reconciliation replay results: a key remains bound to its original response after later observations and restart, while unrecoverable pre-v6 responses fail closed. Destination outcomes require an explicit evidence reference and reason code; they record operator-observed evidence but do not submit a destination transaction or prove that the evidence is authentic. Quote and user review remain consumer-owned pre-submission states and must be captured by the canonical Wallet approval flow before this coordinator accepts a source event.

The independent `sdk/bridge` package exposes only public health, transparency, and fail-closed route-catalog reads plus a lifecycle availability guard. It cannot hold Bridge credentials or mutate coordinator state. This is a locally tested consumer contract, not evidence of central integration, registry publication, or a public endpoint.

`GET /bridge/routes` reports configured route candidates with provider, classification, contracts, token metadata, fees, slippage, timing, risk, finality, refund, and destination fields. Unknown provider evidence is null and every current route is unavailable and non-executable.

`GET /bridge/assets` reports the configured token allowlist with explicit Testnet stablecoin, wrapped test asset, YNXT bridge candidate, and other Testnet candidate classes. It rejects class/canonicality conflicts and keeps unknown contract metadata null, verification false, supply authority unconfigured, and execution disabled.

`GET /bridge/status` keeps local coordinator availability separate from external Bridge readiness. It reports provider/public/execution/support/refund/emergency-exit states as unavailable, false, or null and never treats operator reconciliation as independent proof.

`GET /bridge/transparency` is intentionally public and reports coordinator-observed outstanding exposure, configured route limits, pause state, and the latest reconciliation reference. Reconciliation records publish locked, burned, minted, released, outstanding-supply, reserve-backing, difference, and balanced state. Their source is always `operator-submitted-evidence` and verification is `reference-recorded-not-independently-verified`; an unbalanced report remains visible as unbalanced. This is transparent accounting input, not proof of reserve, verified contract state, or a liquidity valuation.

This is not a live bridge. External submission is hard-disabled by route validation and reported as false by health and metrics. No external-chain transaction, mint, burn, native YNXT freeze/seizure, funded bridge account, production relayer custody, remote Bridge deployment, public Bridge endpoint, third-party integration, or stablecoin issuer support has been completed or claimed.

Provider readiness still requires independent review of chain profile, EVM compatibility, finality assumptions, validator security, RPC availability, relayer custody and rotation, gas token YNXT, message verification, canonical/represented asset boundaries, mint/burn authority, rate and liquidity limits, monitoring, upgrade and incident policy, Trust trace/lot mapping, legal controls, remote testnet evidence, and rollback. The local coordinator is one engineering input to that review, not approval by a bridge provider.

Local verification:

```bash
make bridge-api-check
GOMAXPROCS=2 make deploy-dry-run
```

Runtime configuration is documented in `.env.deploy.example`. Production installation remains fail-closed behind `YNX_BRIDGE_DEPLOY_ENABLED=false` until real relayer and route inputs are available.
