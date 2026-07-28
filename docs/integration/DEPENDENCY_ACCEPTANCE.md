# YNX Exchange dependency acceptance

Runtime source commit: `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`.

No dependency below is considered integrated merely because an adapter, fixture or request file exists. Acceptance requires direct owner evidence against the frozen tuple and cross-product vectors.

| Dependency | Owner | Exchange local boundary | Acceptance evidence required | Current status | Recovery condition |
|---|---|---|---|---|---|
| Wallet product registry | 02 Wallet/Auth | `apps/exchange/integration/wallet-registry-entry.json`; disabled pending review | Accepted exact product/client/bundle/callback/scopes/device algorithms and revocation policy | external blocked | Registry entry enabled by owner without scope widening |
| Session introspection | 02 Wallet/Auth / Gateway | Bearer header only; exact verifier/client/account/public key/scope/expiry | Valid plus wrong-product/bundle/device/scope/expiry/revoke vectors | external blocked | Owner endpoint passes EX-WALLET-001/002 |
| Protected action verification | 02 Wallet/Auth / Gateway | Domain-separated Wallet signatures and idempotency; no local substitute | Canonical action-verification response binding product, account, device, payload digest, expiry and revoke | external blocked | Owner contract accepted and negative vectors pass |
| Chain finality | 01 Chain Core | Chain reader interface; fixed `ynx_6423-1` identity | Finality/version contract and committed receipt proof | external blocked | Accepted Chain contract and shared Testnet receipt |
| Custody address | Operator / Security | No deposit credit without configured address | Approved address, network, ownership/control class and rotation procedure | external blocked | Operator input through secure deployment path |
| Indexer transfer proof | Chain/Indexer owner | Exactly-once credit only after committed confirmations | Versioned transfer schema with source/asOf/finality/reorg behavior | external blocked | EX-CUSTODY-013 passes against real Testnet |
| Withdrawal broadcaster | Operator / Security | Exchange stops at `reviewed_pending_operator_broadcast` | Approved broadcaster, allowlist, signer boundary, receipt/failure/retry contract | external blocked | Receipt and negative vectors accepted |
| Oracle/mark/index facts | Oracle owner | Not used for current Spot matching; no fabricated source | Versioned source/confidence/staleness/failure contract before margin/perp/router use | not started | Native risk products remain disabled until accepted |
| Data Fabric canonical events/billing | Data Fabric owner | Exchange owns local execution sequence only | Canonical mapping, dedupe keys, fee/billing ownership and replay contract | external blocked | Mapping accepted by 29 Integration |
| Quant research engine | Quant Lab owner | Exchange exposes execution adapter only; no second Quant engine | Mandate/method contract and sequence reconciliation acceptance | implemented local, central pending | Owner runs shared adapter vectors |
| Explorer/Finance/Monitor evidence | Relevant owners | Local source metadata only | Same-commit transaction/fill/fee/risk/health evidence | external blocked | Shared Testnet acceptance run |
| Security release gate | 30 Security/SRE | Local tests, SBOM and unsigned build evidence | SAST/DAST/artifact scan, provenance, reproducibility, signing, backup/restore and alert review | external blocked | Security release acceptance |
| Stateful staging/public hosting | 30 Security/SRE / operator | Local server only | Immutable deployment source, public health/version, persistence, TLS, monitoring and rollback | external blocked | Authorized deployment with same source commit |
| Website product page | 28 Website | `public-product-metadata.json`; no direct Website edits | Consumed metadata, accepted assets, truthful booleans, canonical/SEO/public probe | external blocked | Website and public runtime statuses recorded separately |

## Accepted local dependencies

- Go module graph required by the source-bound server build: secp256k1 v4.4.0, gorilla/websocket v1.5.3, x/crypto v0.33.0 and x/sys v0.30.0.
- Local filesystem persistence with fsync, atomic rename, directory sync and whole-state integrity verification.
- Current browser test runtime for the responsive Web Pro surface.

These local acceptances do not establish production support, hosted availability or legal approval.

## Conflict rule

If another owner publishes a conflicting scope, event, error, asset status, fee or release fact, Exchange must not permanently support both definitions. Record the conflict, provide a migration proposal and let `29-integration` freeze one authoritative version before shared Testnet execution.
