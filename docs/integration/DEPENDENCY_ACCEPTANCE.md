# YNX Pay dependency acceptance

## Current checkpoint

| Dependency | Owner | Local adapter/contract | Accepted centrally | Direct evidence required |
|---|---|---:|---:|---|
| Chain settlement and finality | 01 Chain Core | Yes | No current acceptance recorded | Fresh Testnet transaction, committed block, receipt and replay rejection |
| Wallet/Auth and product session | 02 Wallet/Auth | Yes | No | Registry tuple, challenge/completion, introspection, expiry and revoke vectors |
| Explorer receipt evidence | 12 Explorer | Contract only | No | Public tx/receipt page tied to exact source commit |
| Trust dispute lifecycle | 15 Trust Center | Local case link | No | Accepted case schema, appeal and correction vector |
| Economics/fee authority | 17 Economics | Fee breakdown model | No | Accepted fee/burn/treasury schema and source version |
| Oracle/FX/stable reference | 19 Oracle | Fail-closed consumer boundary | No | Source/version/asOf/confidence/stale contract |
| Bridge lifecycle | 21 Bridge | HTTPS adapter and monotonic state tests | No | Provider/route contract plus destination confirmation vector |
| Quant evidence production | 08 Quant Lab | Signed evidence consumer and high-water-mark validator | No | Accepted evidence schema, service-reference ownership, period/equity/net-flow production vector and key-rotation policy |
| Billing ledger/events and Quant verifier | 26 Data Fabric | Audit/event payloads, Ed25519 verifier registry and independent fee calculation exist locally | No | Canonical event/ledger version, accepted public verifier key, evidence source/version/asOf/expiry contract and rotation/revocation vector |
| Website/public `/pay` | 28 Website | Public metadata exists | No | Hosted route, canonical metadata, support/privacy/security/status paths |
| Protocol freeze/shared Testnet | 29 Integration | Contract and vectors supplied | No | Signed acceptance against exact commit |
| Security/release/artifacts | 30 Security/SRE | Local scans/build evidence only | No | SBOM, provenance, hosted hash, signing class and release evidence |

## Pay-owned acceptance already met locally

- Authoritative Paid state requires complete central evidence matching.
- Wallet/Gateway assertions bind method, path, body, account, session, device, product, bundle, scopes, request digest, lifetime and nonce.
- Invoice signatures remain compatible for v1–v3; Split child Invoices use signed v4 bindings and Quant service invoices use signed v5 bindings.
- Split Plans are merchant-signed, bounded, persistent and idempotent.
- Split claims require `pay:settlement:submit`, create one child Invoice per share, reject wrong payers and redact account bindings publicly.
- Quant bills require an explicitly configured external Ed25519 verifier, reject frontend/manager PnL, remove net capital flows before performance-fee calculation, bind Invoice v5 to the evidence digest and payer, and remain unavailable when the verifier is not accepted.
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

Until the relevant owner and `29-integration` produce direct evidence, `integratedCentral`, `deployedStaging`, `deployedPublic`, `downloadHosted`, `productionSigned` and `storeReleased` remain false.
