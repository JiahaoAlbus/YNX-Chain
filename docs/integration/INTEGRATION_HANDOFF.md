# YNX Cloud integration handoff

## Authority

Product 20 owns Cloud control-plane runtime, object metadata, object-provider abstraction, Cloud client/SDK behavior, retention/export/delete controls and Cloud evidence. It does not own Wallet identity, AI provider execution, Trust adjudication, Resource Market settlement, Data Fabric canonical-event acceptance, shared Testnet deployment or public website routing.

Authoritative machine-readable contract: `release/integration/cloud-contract.json` at source commit `7759586914c3be5de1f99475f78e39cb1c2f8ad2`.

## Acceptance request

- **02 Wallet/Auth:** review the disabled Cloud native tuple and approve a multi-surface registration model without weakening exact product/client/bundle/callback binding.
- **14 AI:** accept selected-object/version context only; return honest unavailable, quota, timeout and cancellation states.
- **15 Trust:** accept bounded audit/evidence records without receiving object plaintext by default.
- **16 Resource Market:** define verified storage/egress/scan/backup capacity and settlement facts; a quote is not service completion.
- **26 Data Fabric:** freeze canonical Cloud event envelopes and billing-ledger mapping.
- **29 Integration:** run the shared Wallet → Cloud → object provider → Explorer/Monitor evidence flow.
- **30 Security/SRE:** review container, backup, restore, release, scan and deployment controls.

## Fail-closed boundaries

Central registrations remain disabled. Without an accepted central verifier, `ynx-cloudd` does not manufacture sessions. Provider absence does not upgrade bounded local persistence to production durability. Public liveness is not readiness. Local, simulator, debug-signed and CI evidence remain separate from staging, public, production-signed and store states.

## Current checkpoint

The least-privilege Docker/Server delivery was implemented in commit `6e101f9`; owner-and-product scoped content-addressed deduplication and reliable Smoke process cleanup were implemented in commit `7759586`. Fresh Race, Go, Web/SDK, static, security, canonical API, backup and restore gates passed. Both commits and the coverage checkpoint are on `origin/codex/final-cloud`. Provider-side opaque-scope enforcement, physical legacy-blob migration, central Wallet acceptance, staging and public evidence remain pending and must fail closed.
