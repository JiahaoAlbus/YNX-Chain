# Bridge Integration Readiness

The repository now contains a first real `ynx-bridged` coordinator implementation for local engineering review. It persists transfer intents, enforces globally unique source events and exact idempotency, verifies allowlisted Ed25519 relayer attestations, requires configured finality and a threshold of at least two relayers, records a hash-chained audit trail, and finalizes only local coordinator state. `make bridge-api-check` and the deployment dry-run verify the bounded runtime and package path.

This is not a live bridge. External submission is hard-disabled by route validation and reported as false by health and metrics. No external-chain transaction, mint, burn, native YNXT freeze/seizure, funded bridge account, production relayer custody, remote Bridge deployment, public Bridge endpoint, third-party integration, or stablecoin issuer support has been completed or claimed.

Provider readiness still requires independent review of chain profile, EVM compatibility, finality assumptions, validator security, RPC availability, relayer custody and rotation, gas token YNXT, message verification, canonical/represented asset boundaries, mint/burn authority, rate and liquidity limits, monitoring, upgrade and incident policy, Trust trace/lot mapping, legal controls, remote testnet evidence, and rollback. The local coordinator is one engineering input to that review, not approval by a bridge provider.

Local verification:

```bash
make bridge-api-check
GOMAXPROCS=2 make deploy-dry-run
```

Runtime configuration is documented in `.env.deploy.example`. Production installation remains fail-closed behind `YNX_BRIDGE_DEPLOY_ENABLED=false` until real relayer and route inputs are available.
