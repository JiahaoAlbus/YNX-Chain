# Blockers

No execution-infrastructure blocker is active.

## PAY-INTEGRATION-001

- Owner: `29-integration`, with dependencies on `02-wallet-auth` and the App Gateway owner
- Reason: the Pay contract and vectors are local, but central registry/routes and acceptance are not yet proven on a shared Testnet.
- Evidence: `release/integration/pay-contract.json`, `docs/pay/INTEGRATION_HANDOFF.md`, owner validation PR `#29`.
- Prepared: local implementation, fail-closed adapters, test vectors, migration/recovery evidence and PR integration candidate.
- Minimal external input: accepted central contract/version and deployment target; no secret is requested in chat.
- Recovery condition: accepted dependency record plus deployed central routes.
- First action after recovery: run the fresh two-account invoice/payment/sponsorship/refund/dispute flow and capture authoritative receipts.

## PAY-PUBLIC-001

- Owner: `28-website` and `30-security-sre-release`
- Reason: `/pay` is currently a generic SPA fallback, and the public Pay runtime reports an older SHA.
- Evidence: live probes recorded in `CURRENT_STATE.md`.
- Prepared: public metadata, release record, integration handoff and local Web/PWA export.
- Minimal external input: Website-owner deployment of the Pay route and release-owner deployment of the current source-bound runtime/artifacts.
- Recovery condition: Pay-specific canonical page and health/version response bound to the accepted source SHA.
- First action after recovery: verify content, canonical, JSON-LD, health, version, artifact digest, install and cold launch.
