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
| Billing ledger/events | 26 Data Fabric | Audit/event payloads exist locally | No | Canonical event and ledger acceptance |
| Website/public `/pay` | 28 Website | Public metadata exists | No | Hosted route, canonical metadata, support/privacy/security/status paths |
| Protocol freeze/shared Testnet | 29 Integration | Contract and vectors supplied | No | Signed acceptance against exact commit |
| Security/release/artifacts | 30 Security/SRE | Local scans/build evidence only | No | SBOM, provenance, hosted hash, signing class and release evidence |

## Pay-owned acceptance already met locally

- Authoritative Paid state requires complete central evidence matching.
- Wallet/Gateway assertions bind method, path, body, account, session, device, product, bundle, scopes, request digest, lifetime and nonce.
- Invoice signatures remain compatible for v1–v3; Split child Invoices use signed v4 bindings.
- Split Plans are merchant-signed, bounded, persistent and idempotent.
- Split claims require `pay:settlement:submit`, create one child Invoice per share, reject wrong payers and redact account bindings publicly.
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
