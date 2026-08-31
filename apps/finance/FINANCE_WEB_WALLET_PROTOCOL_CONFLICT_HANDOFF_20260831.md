# Finance Web Wallet protocol conflict — 2026-08-31

Finance Web must not be promoted or deployed from this source state. The active
HTML loads `wallet-auth.js`, built from `wallet-auth-entry.js`; that entry is a
legacy browser deep-link and Product Session implementation. In contrast,
`verify-wallet-connect.mjs` reads a nonexistent `wallet-connect-entry.js`, so
its result cannot verify the served code.

The product has no executable `9102` or `0x238e` references; YNX Testnet is
correctly `6423` / `0x1917`. The blocker is Wallet protocol ownership, not a
chain-ID mismatch.

Central Wallet/Auth must supply the accepted Finance Web root factory/import
path, Product Session degradation contract, and a path-scoped migration lease.
Finance will then replace the active legacy entry with the accepted
EIP-6963/EIP-1193 consumer, retain guest mode, and separately prove the public
provider lifecycle. Until then, all Wallet approval, callback, session,
signing, transaction, and deployment claims remain false.
