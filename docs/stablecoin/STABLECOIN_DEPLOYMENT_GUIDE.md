# Stablecoin Deployment Guide

This guide does not authorize a stablecoin deployment. YNX Chain currently has a local issuer-control service with execution disabled and does not claim issuer support.

Before enabling `YNX_STABLECOIN_DEPLOY_ENABLED`, require all of the following:

1. A named issuer candidate with independently reviewable registry and contact evidence.
2. A governance request and decision record whose evidence can be checked outside `ynx-stablecoind`.
3. A non-native contract asset profile with explicit canonical/represented boundary, decimals, supply ceiling, mint/burn policy, legal-review status, reserve/redemption model, and incident policy.
4. Separate custody and rotation controls for any future contract administrator or issuer signer. The current service creates and holds no signer.
5. A backup/restore and rollback drill for `/var/lib/ynx-chain/stablecoin/state.json` and the future token runtime.
6. Monitoring, reconciliation, user disclosure, appeal/contact, upgrade, depeg, insolvency, and emergency communication procedures.
7. Independent security, legal, custody, and disclosure approval for the exact release and asset.

Package/config verification:

```bash
make stablecoin-issuer-check
GOMAXPROCS=2 make deploy-dry-run
```

If separately approved, configure a unique `YNX_STABLECOIN_API_KEY`, keep `YNX_STABLECOIN_HTTP_ADDR` loopback-only, set the deploy gate to `true`, and run the normal safeguarded deployment. Verify mode-`0600` env/state files, `--check-config`, systemd health, build identity, restart persistence, mutation freeze, and rollback before considering ingress. Health must still report `issuerSupportEstablished=false` and `externalExecutionEnabled=false`; changing those claims requires a different implementation plus live external evidence.
