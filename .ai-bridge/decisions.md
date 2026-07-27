# YNX Pay decisions

1. Split is implemented as a signed payment plan plus one authoritative central child Invoice per share, not as a local UI-only allocation.
2. A share claim binds its child Invoice to the claiming canonical Wallet account. Authoritative settlement from any other payer fails closed.
3. Public Invoice/Split reads redact payer bindings; authenticated merchant state retains them for reconciliation and audit.
4. Invoice v4 is used only for Split-bound child Invoices. Existing Invoice v1, v2 and v3 signing material remains byte-compatible.
5. Split plan creation is merchant-authorized; share claim is Wallet/Gateway-authorized with `pay:settlement:submit`.
6. A Split status is derived from authoritative child Invoice states. Claiming or receiving a webhook cannot produce `committed`.
7. Quant/service billing accepts only an externally signed ledger envelope from an explicitly configured Ed25519 verifier key; frontend and manager-declared PnL are never payment authority.
8. Performance fees use net-flow-adjusted high-water-mark arithmetic with whole-YNXT-unit floor rounding. Deposits cannot become performance profit, and overflow or stale evidence fails closed.
9. Invoice v5 binds the Quant bill ID, external evidence digest and public payer hash while the raw payer remains private for authoritative settlement matching.
10. The Pay client independently verifies the accepted Quant public key, evidence digest/signature, every calculation and Invoice v5 binding before Wallet review.
11. Central Wallet/Gateway, Quant verifier acceptance, Testnet, public, hosted, signing and store states remain false until direct evidence exists.
12. Repository-wide failures in other product owners are recorded, not repaired by broad out-of-scope edits in 04 Pay.
13. Backup artifacts are immutable: the operator CLI refuses to overwrite an existing output path, and every receipt binds SHA-256, bytes and record count.
14. Restore validates and uses one source read to avoid a validation/use race. A valid destination becomes a verified hash-addressed rollback artifact; an invalid destination is preserved only as quarantine evidence.
15. Unknown future snapshot versions, wrong integrity keys, corrupt sources and ambiguous short-Hex key encodings fail closed.
16. Restore is offline. No production-volume RTO/RPO, remote-retention or Windows directory-fsync claim is made from the local fixture drill.
