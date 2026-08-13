# YNX Calendar dependency acceptance

Runtime source: `55587bb6cc8c7c49202e4fc3222b69772dd05b5f`
Calendar status: **ACTIVE / FREEZE**

| Dependency owner | Calendar requirement | Current evidence | Acceptance state | Recovery condition |
|---|---|---|---|---|
| 02 Wallet/Auth | Product registry, exact bundle/callback, device challenge, session verification/introspection, recovery, expiry, revoke | Public canonical verifier plus two-user lifecycle, restart persistence and 100/100 authenticated concurrent reads pass | Accepted for current public Calendar flow | Preserve exact registry/verifier binding and rerun negative/recovery vectors after any Wallet release change |
| 14 AI | Authenticated JSON POST and bounded SSE, provider/model/cost, cancellation, no private query context | Local adapter and privacy/failure tests pass | Pending owner acceptance | Accepted endpoint and direct Testnet evidence for preview/approve/reject/cancel/provider outage |
| 20 Cloud | Versioned attachment/notes object references and access revocation | No Calendar adapter yet | Not started | Accepted object-reference contract, access scopes, retention, delete, export, outage, and revoke semantics |
| 25 Mail | Invitation, update, RSVP, cancellation, and reminder delivery envelope | Local Calendar invitation/reminder state only | Pending contract | Accepted schema, idempotency key, privacy class, delivery/audit IDs, bounce/failure/retry behavior |
| 26 Data Fabric | Canonical Calendar events with replay protection and privacy-safe transport | Proposed event names in Calendar contract | Pending contract | Accepted owner/version, envelope, retention, billing boundary, replay and backward-compatibility vectors |
| 28 Website | Consume Calendar metadata, status, downloads, FAQ and structured data | `/dapp/calendar`, release registry and direct runtime are public and source-bound to `55587bb6`; support/privacy/security/status route probes remain separate | Accepted for product publication | Keep registry synchronized and add direct auxiliary-route evidence before claiming those routes verified |
| 29 Integration | Freeze unique Calendar contract and execute shared Testnet vectors | Local contract and vectors are proposed | Pending acceptance | Conflict review, accepted schema/version, shared Testnet report, and central owner sign-off |
| 30 Security/SRE | Threat, secret/dependency/license scans, SBOM/provenance, artifact/install/public gates, encrypted backup retention and key escrow | Calendar local boundary/build gates and authenticated isolated restore drill pass; backup encryption, independent key escrow and release-grade package are missing | Pending acceptance | Current-source artifact set, scans, SBOM/provenance, immutable hashes, install proof, encrypted offsite retention, escrow recovery and production-scale restore evidence |
| 12 Explorer | Public/auditable Calendar integration evidence where canonical events are appropriate | No canonical Data Fabric events accepted | Blocked by Data Fabric | Accepted event transport and privacy-safe index fields |
| 13 Monitor | Health/ready/version, metrics, traces, SLO and alerts | Public health and exact build identity exist; structured metrics/traces/alerts are not accepted | In progress | Structured telemetry, Monitor contract, alert tests and status linkage |
| 15 Trust | Trust evidence for identity/session and release claims, without exposing private event data | No accepted Calendar Trust evidence | Not started | Privacy-safe evidence schema and accepted Wallet/Release proofs |

## Fail-closed policy

A dependency is not considered accepted because an adapter compiles, a mock passes, or a proposal exists. Calendar keeps the corresponding release state false until the owner supplies direct accepted commit, deployed endpoint or artifact, health/version, and applicable negative vectors.

After two real endpoint or contract failures, Calendar records the raw failure and continues local adapters, migrations, negative vectors, recovery, security, platform, and release preparation. It does not replace a central owner with a production mock.

## Repository baseline

`go test ./...` currently fails outside Calendar ownership in consensus signer-permission checks, missing IDE contract artifacts, Faucet signer permissions, and Trust signer permissions. Calendar packages pass. Integration must rerun the full gate after those owners repair their baselines.
