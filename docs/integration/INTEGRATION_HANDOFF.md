# YNX Cloud integration handoff

## Authority

Product 20 owns Cloud control-plane runtime, object metadata, versioned storage lifecycle, object-provider abstraction, Cloud client/SDK behavior, retention/export/delete controls and Cloud evidence. It does not own Wallet identity, AI provider execution, Trust adjudication, Resource Market settlement, Data Fabric canonical-event acceptance, shared Testnet deployment or public website routing.

Authoritative machine-readable contract: `release/integration/cloud-contract.json` at source commit `d11c382da10ab0629c7d322c83c9ddef24925328`.

## Acceptance request

- **02 Wallet/Auth:** review the disabled Cloud native tuple and approve a multi-surface registration model without weakening exact product/client/bundle/callback binding; lifecycle mutation and retry require exact Account + Product + Scope binding.
- **14 AI:** accept selected-object/version context only; return honest unavailable, quota, timeout and cancellation states.
- **15 Trust:** accept bounded audit/evidence records without receiving object plaintext by default.
- **16 Resource Market:** define verified storage/egress/scan/backup/lifecycle capacity and settlement facts; a quote or requested transition is not service completion.
- **26 Data Fabric:** freeze canonical Cloud event envelopes and billing-ledger mapping, including requested/completed/failed storage-transition facts.
- **29 Integration:** run the shared Wallet → Cloud → object provider → Explorer/Monitor evidence flow, including cross-product rejection and provider-failure retry.
- **30 Security/SRE:** review container, lifecycle retry/idempotency, backup, restore, image scan, release and deployment controls.

## Fail-closed boundaries

Central registrations remain disabled. Without an accepted central verifier, `ynx-cloudd` does not manufacture sessions. A Cloud session cannot mutate or retry a Docs lifecycle transition even when the Wallet account is identical. Provider absence or a mismatched lifecycle response records failed truth and preserves the prior version class. Pending or failed transitions block permanent deletion and product erasure until a bound retry completes. Provider absence does not upgrade bounded local persistence to production durability. Public liveness is not readiness. Local, simulator, debug-signed and CI evidence remain separate from staging, public, production-signed and store states.

## Current checkpoint

The least-privilege Docker/Server delivery was implemented in commit `6e101f9`; owner-and-product scoped content-addressed deduplication in `7759586`; and schema-v7 versioned hot/cold/archive lifecycle in `d11c382`. Fresh Cloud, Race, Vet, Web/SDK, static, security, canonical API, migration, backup and restore gates passed. GitHub Actions run `30275578270` succeeded for exact SHA `d11c382da10ab0629c7d322c83c9ddef24925328`, including the least-privilege image build/cold-start. Provider-side opaque-scope/lifecycle enforcement, CDN/replication, image scan, physical legacy-blob migration, central Wallet acceptance, staging and public evidence remain pending and must fail closed.
