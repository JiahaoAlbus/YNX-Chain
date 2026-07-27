# YNX Card Dependency Acceptance

Source commit: `bdd5ca02ad42b712db66a5173ecfad09340aa42c`

No dependency below is represented as centrally accepted or deployed merely
because a local adapter or test exists.

| Dependency owner | Required contract | Local evidence | Acceptance state | Fail-closed behavior | Next acceptance action |
|---|---|---|---|---|---|
| 02 Wallet/Auth | Exact Card registry tuple, device-bound approval and server Gateway assertion | Wallet callback and assertion negative tests pass | Pending | Card requests return unauthorized on any binding mismatch | Run `CARD-WALLET-*` vectors against the accepted central implementation |
| 14 AI | POST-body review-only decline/fee/support draft workflow | AI review cannot mutate Card state or controls | Local adapter only | Provider unavailable/error remains visible; no Card action occurs | Freeze workflow, data classes, retention and audit fields |
| 15 Trust Center | Opaque dispute/appeal evidence handoff | Local dispute creation exists | Not integrated | Card keeps dispute local and does not expose sensitive fields | Accept `CARD-TRUST-DISPUTE-001` and define status mapping |
| 26 Data Fabric | Canonical Card event envelope and Billing Ledger authority | Event model and audit chain exist locally | Not integrated | No external settlement, reward or revenue fact is emitted | Freeze event names, envelope and idempotency rules |
| 13 Monitor | Health/readiness/version and alert semantics | `/health`, `/ready`, `/version` tested | Local only | Issuer outage returns degraded health and readiness 503 | Define scrape schema and provider-outage alert |
| 28 Website | `/card` metadata, support/privacy/security/status paths and hosted artifacts | No public package yet | Not started | Public URLs and downloadHosted remain empty/false | Consume metadata only after staging/artifact evidence exists |
| 29 Integration | Unique contract freeze and shared Testnet E2E | Contract and vectors prepared | Pending | `integratedCentral=false` | Review owner conflicts and run shared Testnet vectors |
| 30 Security/SRE | Threat model, SBOM, provenance, deployment and secure signing | Product security check passes; no signing material in Git | Partial local evidence | Production signing and deployment remain disabled | Complete security/release gates before any signing request |
| Official issuer provider | Sandbox program, capability contract, webhook and secure display | Provider-neutral interface and deterministic test sandbox | Not selected | Default provider mode is unavailable and readiness is 503 | Complete provider bake-off and conformance suite before credential request |

## Acceptance rule

A dependency moves to accepted only when its owner records the exact contract
version and source commit, all applicable positive and negative vectors pass,
and the result is integrated on the shared Testnet. Local files, mocks,
interfaces, HTTP 200 responses or candidate branches are insufficient.
