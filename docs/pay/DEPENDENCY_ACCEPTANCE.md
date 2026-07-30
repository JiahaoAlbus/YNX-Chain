# YNX Pay dependency acceptance

## Current checkpoint

- Integration candidate: `6cbac9f4654b5715d32f1e561819e593c868a6f1`
- Owner validation: draft pull request `#29`; exact-source CI run `30575350364` passed all three jobs.
- Public runtime observation: `pay.ynxweb4.com/health` reports `98a18815d4ee`, so it does not accept or deploy the current candidate.

| Dependency | Owner | Local adapter/contract | Accepted centrally | Direct evidence required |
|---|---|---:|---:|---|
| Chain settlement and finality | 01 Chain Core | Yes | Yes — source `324f376d`, central `329092c1` | Fresh Pay Testnet transaction, committed block, receipt and replay rejection |
| Wallet/Auth and product session | 02 Wallet/Auth | Yes | Yes — source `f28b0aa2`, central `94acfece` | Pay registry tuple, challenge/completion, introspection, expiry and revoke vectors |
| Explorer receipt evidence | 12 Explorer | Contract only | No | Public tx/receipt page tied to exact source commit |
| Trust dispute lifecycle | 15 Trust Center | Local case link | No | Accepted case schema, appeal and correction vector |
| Economics/fee authority | 17 Economics | Fee breakdown model | No | Accepted fee/burn/treasury schema and source version |
| Oracle/FX/stable reference | 19 Oracle | Fail-closed consumer boundary | Yes — source `a059d573`, central `d364f995` | Pay-bound source/version/asOf/confidence/stale vector |
| Bridge lifecycle | 21 Bridge | HTTPS adapter and monotonic state tests | Yes — source `01e0961b`, central `244d1c3e` | Pay-bound provider/route contract plus destination confirmation vector |
| Quant evidence production | 08 Quant Lab | Signed evidence consumer and high-water-mark validator | No | Accepted evidence schema, service-reference ownership, period/equity/net-flow production vector and key-rotation policy |
| Billing ledger/events and Quant verifier | 26 Data Fabric | Audit/event payloads, Ed25519 verifier registry and independent fee calculation exist locally | Yes — source `2a09d745`, central `01131b46` | Pay-bound canonical event/ledger version, public verifier key, evidence source/version/asOf/expiry contract and rotation/revocation vector |
| Website/public `/pay` | 28 Website | Public metadata exists | No | Hosted route, canonical metadata, support/privacy/security/status paths |
| Protocol freeze/shared Testnet | 29 Integration | Contract and vectors supplied | No | Signed acceptance against exact commit |
| Security/release/artifacts and recovery | 30 Security/SRE | Local build plus source-bound backup/restore contract and fixture drill | Yes — source `e670749b`, central `a472d588` | Pay artifact acceptance, immutable encrypted retention target, production-volume RTO/RPO drill and release evidence |

## Pay-owned acceptance already met locally

- Authoritative Paid state requires complete central evidence matching.
- Wallet/Gateway assertions bind method, path, body, account, session, device, product, bundle, scopes, request digest, lifetime and nonce.
- Invoice signatures remain compatible for v1–v3; Split child Invoices use signed v4 bindings and Quant service invoices use signed v5 bindings.
- Split Plans are merchant-signed, bounded, persistent and idempotent.
- Split claims require `pay:settlement:submit`, create one child Invoice per share, reject wrong payers and redact account bindings publicly.
- Quant bills require an explicitly configured external Ed25519 verifier, reject frontend/manager PnL, remove net capital flows before performance-fee calculation, bind Invoice v5 to the evidence digest and payer, and remain unavailable when the verifier is not accepted.
- Store snapshots reject unsupported future versions; immutable backups bind SHA-256/bytes/records; restore uses one verified source read, preserves valid rollback or corrupt quarantine artifacts, and fails closed for wrong keys or corrupt sources.
- Refund, dispute, webhook retry/dead-letter/manual replay, sponsorship, route and bridge paths fail closed under missing authority.

## Non-acceptance rules

The following do not constitute dependency acceptance:

- a local adapter compiling;
- HTTP 200 from a generic health endpoint;
- an old historical Testnet proof;
- a route quote, webhook or UI success state;
- a mock provider or unapproved contract address;
- an unsigned/test-signed artifact;
- a local scan described as external audit.

Dependency-owner acceptance is not Pay end-to-end acceptance. Until `29-integration` merges this exact Pay source and produces Pay-specific direct evidence, `integratedCentral`, `deployedStaging`, `deployedPublic`, `downloadHosted`, `productionSigned` and `storeReleased` remain false.
