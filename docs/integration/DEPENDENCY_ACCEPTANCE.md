# YNX Cloud dependency acceptance

| Dependency owner | Required contract | Current evidence | Acceptance state | Recovery condition |
| --- | --- | --- | --- | --- |
| 02 Wallet/Auth | Exact product/client/bundle/callback/device/scopes verification, expiry and revoke | Local verifier adapter and negative vectors pass | pending | Reviewed enabled registrations and shared staging vectors |
| 14 AI | Selected object/version context, consent, cancellation and honest failure | Local adapter and job-state tests pass | pending remote | Configured gateway staging run |
| 15 Trust Center | Bounded audit/evidence intake without default plaintext transfer | Local sink/adapter tests pass | pending remote | Accepted schema and staging receipt |
| 16 Resource Market | Verified capacity, usage facts, SLA, exit and migration | Provider abstraction and metering exist | pending | Provider contract and settlement vector accepted |
| 26 Data Fabric | Canonical event and billing-ledger envelopes | Cloud event list frozen in contract | pending | Schema acceptance and replay test |
| 29 Integration | Shared Testnet sequencing and public proof | Local end-to-end smoke passes | pending | Wallet, provider and deployment gates available |
| 30 Security/SRE | Container, scan, backup, restore and release controls | Least-privilege container candidate and local gates exist | pending CI/remote | Green image cold-start/scan plus remote recovery drill |

All unresolved dependencies fail closed. No pending dependency is treated as integrated, deployed, durable, production-signed or publicly verified.
