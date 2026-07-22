# Bridge Integration Readiness

The repository contains a fail-closed `ynx-bridged` coordinator implementation for local engineering review. It persists transfer intents, enforces globally unique source events and exact idempotency, verifies allowlisted Ed25519 relayer attestations, requires configured finality and a threshold of at least two relayers, enforces per-transfer and route-outstanding limits, exposes persistent pause/resume controls, records a hash-chained audit trail, and finalizes only local coordinator state. `make bridge-api-check` and the deployment dry-run verify the bounded runtime and package path.

The machine-readable lifecycle distinguishes `source_submitted`, `source_accepted`, `source_finalized`, `proof_attestation`, `destination_mint_release`, `destination_confirmed`, `failed`, `refund_recovery`, `dispute`, and `retry`. Destination outcomes require an explicit evidence reference and reason code; they record operator-observed evidence but do not submit a destination transaction or prove that the evidence is authentic. Quote and user review remain consumer-owned pre-submission states and must be captured by the canonical Wallet approval flow before this coordinator accepts a source event.

`GET /bridge/transparency` is intentionally public and reports coordinator-observed outstanding exposure, configured route limits, pause state, and the latest reconciliation reference. Reconciliation records publish locked, burned, minted, released, outstanding-supply, reserve-backing, difference, and balanced state. Their source is always `operator-submitted-evidence` and verification is `reference-recorded-not-independently-verified`; an unbalanced report remains visible as unbalanced. This is transparent accounting input, not proof of reserve, verified contract state, or a liquidity valuation.

This is not a live bridge. External submission is hard-disabled by route validation and reported as false by health and metrics. No external-chain transaction, mint, burn, native YNXT freeze/seizure, funded bridge account, production relayer custody, remote Bridge deployment, public Bridge endpoint, third-party integration, or stablecoin issuer support has been completed or claimed.

Provider readiness still requires independent review of chain profile, EVM compatibility, finality assumptions, validator security, RPC availability, relayer custody and rotation, gas token YNXT, message verification, canonical/represented asset boundaries, mint/burn authority, rate and liquidity limits, monitoring, upgrade and incident policy, Trust trace/lot mapping, legal controls, remote testnet evidence, and rollback. The local coordinator is one engineering input to that review, not approval by a bridge provider.

Local verification:

```bash
make bridge-api-check
GOMAXPROCS=2 make deploy-dry-run
```

Runtime configuration is documented in `.env.deploy.example`. Production installation remains fail-closed behind `YNX_BRIDGE_DEPLOY_ENABLED=false` until real relayer and route inputs are available.
