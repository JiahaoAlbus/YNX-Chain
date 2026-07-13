# Stablecoin Issuer Readiness

YNX Chain does not claim USDT, USDC, or any other issuer-supported stablecoin. No issuer approval, token deployment, reserve attestation, mint/burn authority, public endpoint, exchange support, wallet support, or partnership is established by this repository.

## Implemented Local Control Plane

`ynx-stablecoind` now provides a persistent, authenticated issuer-control surface for review engineering:

- issuer applications, approve/reject decisions, and revocation;
- issuer-bound canonical or represented asset profiles;
- origin chain, contract reference, decimals, supply ceiling, reported supply, and legal-review status;
- mint/burn policy and SHA-256 evidence references;
- asset approve/reject decisions and revocation;
- exact-idempotent, supply-bounded mint/burn intent records;
- hash-chained audit, transparency counts, health, and metrics;
- atomic mode-`0600` JSON persistence with restart and integrity checks.

The service stores intent only. Every intent has `status=recorded_not_executed` and `executionEnabled=false`. It has no adapter, signer, contract call, external-chain transaction, mint, burn, freeze, seize, blacklist, or fund-movement implementation.

Native YNXT, wrapped/native YNXT identifiers, gas/resource balances, validator stake/bond, and protocol treasury state are rejected from issuer control. Issuer-token policy must never be presented as a YNX native protocol action.

## Local Verification

```bash
make stablecoin-issuer-check
```

The check covers lifecycle, governance evidence, issuer and asset revocation, exact replay/conflict, concurrent replay, restart persistence, supply bounds, native/protocol asset rejection, strict HTTP auth/JSON, audit/transparency, tamper rejection, truthful health/metrics, and file modes.

## Deployment Boundary

The binary, dedicated env contract, systemd unit, state/backup paths, config check, and optional health check are included in the deployment package. `YNX_STABLECOIN_DEPLOY_ENABLED` defaults to `false`; the real deployment environment does not enable the service, and no ingress is configured.

Remote deployment requires separate approval after a real issuer candidate, independent legal/custody review, operator credential policy, reserve and redemption evidence model, incident/rollback exercise, and public disclosure review. A governance request ID or evidence hash stored by the control plane is a bound reference, not independent proof that an external review occurred.
