# YNX Pay decisions

1. Split is implemented as a signed payment plan plus one authoritative central child Invoice per share, not as a local UI-only allocation.
2. A share claim binds its child Invoice to the claiming canonical Wallet account. Authoritative settlement from any other payer fails closed.
3. Public Invoice/Split reads redact payer bindings; authenticated merchant state retains them for reconciliation and audit.
4. Invoice v4 is used only for Split-bound child Invoices. Existing Invoice v1, v2 and v3 signing material remains byte-compatible.
5. Split plan creation is merchant-authorized; share claim is Wallet/Gateway-authorized with `pay:settlement:submit`.
6. A Split status is derived from authoritative child Invoice states. Claiming or receiving a webhook cannot produce `committed`.
7. Central Wallet/Gateway, Testnet, public, hosted, signing and store states remain false until direct evidence exists.
8. Repository-wide failures in other product owners are recorded, not repaired by broad out-of-scope edits in 04 Pay.
