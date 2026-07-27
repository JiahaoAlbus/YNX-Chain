# YNX Card Dependency Acceptance

Source commit: `13f90c5f6dae6fb002560574b4c481b5e1477f9d`

No dependency below is represented as centrally accepted or deployed merely
because a local adapter or test exists.

| Dependency owner | Required contract | Local evidence | Acceptance state | Fail-closed behavior | Next acceptance action |
|---|---|---|---|---|---|
| 02 Wallet/Auth | Exact Card registry tuple, device-bound approval and server Gateway assertion | Wallet callback and assertion negative tests pass | Pending | Card requests return unauthorized on any binding mismatch | Run `CARD-WALLET-*` vectors against the accepted central implementation |
| 14 AI | POST-body review-only decline/fee/support draft workflow | AI review cannot mutate Card state or controls | Local adapter only | Provider unavailable/error remains visible; no Card action occurs | Freeze workflow, data classes, retention and audit fields |
| 15 Trust Center | Opaque dispute/appeal evidence handoff | Local dispute creation exists | Not integrated | Card keeps dispute local and does not expose sensitive fields | Accept `CARD-TRUST-DISPUTE-001` and define status mapping |
| 26 Data Fabric | Canonical Card event envelope and Billing Ledger authority | Event model and audit chain exist locally | Not integrated | No external settlement, reward or revenue fact is emitted | Freeze event names, envelope and idempotency rules |
| 13 Monitor | Health/readiness/version and alert semantics | `/health`, `/ready`, `/version` tested | Local only | Issuer outage returns degraded health and readiness 503 | Define scrape schema and provider-outage alert |
| 28 Website | `/card` metadata, support/privacy/security/status paths and hosted artifacts | `apps/card/public-product-metadata.json` exists with truthful false release flags and no fabricated URLs | Local metadata prepared; not consumed | Public URLs, websitePublished and downloadHosted remain empty/false | Validate and consume metadata only after 29 Integration freeze; add hosted artifacts only after direct evidence |
| 29 Integration | Unique contract freeze and shared Testnet E2E | Contract and vectors prepared | Pending | `integratedCentral=false` | Review owner conflicts and run shared Testnet vectors |
| 30 Security/SRE | Threat model, SBOM, provenance, deployment and secure signing | Product security check passes; no signing material in Git | Partial local evidence | Production signing and deployment remain disabled | Complete security/release gates before any signing request |
| Official issuer provider | Sandbox program, `ynx.card.provider.capabilities.v1`, provider-specific webhook signature and secure display | Provider-neutral interface, fail-closed capability conformance, deterministic test sandbox, bounded webhook key rotation and event-order vectors | Not selected | Default provider mode is unavailable and readiness is 503; unknown/retired webhook keys and invalid event relationships are rejected | Complete provider bake-off and map the selected official signature contract before any credential request |

## Acceptance rule

A dependency moves to accepted only when its owner records the exact contract
version and source commit, all applicable positive and negative vectors pass,
and the result is integrated on the shared Testnet. Local files, mocks,
interfaces, HTTP 200 responses or candidate branches are insufficient.
