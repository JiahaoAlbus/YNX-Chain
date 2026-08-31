# Finance public guest-runtime audit — 2026-08-31

## Scope and safety boundary

This is a direct, read-only browser audit of `https://finance.ynxweb4.com/`.
No connection control was clicked.  No account was requested, selected,
approved, signed, transmitted, or used for a transaction.

## Direct browser observations

The guest page opened successfully with the title **YNX Finance** and showed
the public-testnet guest surface, including the YNX Wallet download action and
the MetaMask action.  Its loaded script list was exactly:

1. `https://finance.ynxweb4.com/wallet-auth.js`
2. `https://finance.ynxweb4.com/app.js`
3. `https://finance.ynxweb4.com/read-sources.js`

The page did **not** load either `wallet-connect.js` or
`wallet-auth-entry.js`.  In the live guest page, both
`window.YNXFinanceWebWallet` and `window.YNXFinanceWallet` evaluated to
`undefined`; no injected `window.ethereum` provider was present in this
browser session.

This means the current public guest runtime is not bound to the newer
provider-discovery interface observed in the Finance P0-304 owner worktree.
The visible download and MetaMask controls do not constitute a verified
provider selection, account approval, chain switch, callback, or Product
Session lifecycle.

## Public endpoint truth

The most recent direct `/version` read returned HTTP 200, 130 bytes and
SHA-256 `39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226`.
Repeated direct script/health probes during this audit encountered transient
TLS connection timeouts, so no new script or health digest is asserted here.

## Required release gate

Before Finance can be called publicly Wallet-connected, Central must bind an
exact P0-304 source/runtime package and rollback target, deploy it under a new
single-use Finance lease, and independently prove all of the following on the
actual public URL:

- YNX Wallet and MetaMask provider discovery/identity remain distinct.
- User-approved account plus `0x1917` add/switch/readback is visible.
- The chooser closes without opening a blank tab; refresh, account/chain
  changes and disconnect behave correctly.
- Private Product Session degradation does not remove the Standard Wallet
  connection.

Until then, `deployedPublic`, Wallet approval, callback, Product Session,
signing and transaction truth all remain false.

