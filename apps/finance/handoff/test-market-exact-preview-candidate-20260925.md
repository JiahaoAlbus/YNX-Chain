# Finance test-market exact preview candidate

This Finance-owned source change is a local, read-only preview of the pinned
`TEST-AAPL`/`tUSD`/`TestDvP` QA contract at source
`6663df43e2f973a90a591cc88fc120a540df7f4a`. It is not an order, quote,
Wallet approval, public 6423 deployment, balance, transaction, or a security.

The browser uses integer arithmetic at the contracts' six-decimal precision.
It bounds stock shares at 1,000,000 and quote plus the contract's maximum 500
basis-point fee at the 10,000,000 tUSD test cap. The visible fee is a maximum
bound, not a live deployed fee. Zero-amount, noncanonical, fractional-overflow,
and cap-exceeding drafts fail closed. The guest page makes no account request or
write. YNX-owned accounts are described with native `ynx` addresses; an EVM
`0x` account remains separate absent an explicit verified link.

Focused checks: `node --test apps/finance/tests/product-catalog.test.mjs
apps/finance/tests/broker-execution-browser.test.mjs` passed 26/26;
`go test ./internal/finance/...` passed. The full Finance Node suite is **not
green**: its immutable Wallet verifier manifest still binds the predecessor
`finance-locale.js` and `product-catalog.js` bytes, so the review gate correctly
returns `FINANCE_WALLET_FILE_INTEGRITY_MISMATCH`. Do not bypass the gate or
publish this candidate. Independent review and a new exact manifest pin are
required before a source-bound release; production remains at its prior source.

Candidate asset identities before independent review:

| Finance file | Bytes | SHA-256 |
| --- | ---: | --- |
| `web/product-catalog.js` | 7,281 | `dc98fedb9734207a2688f0a5ce154a16b0be11240947a4910414bb212eed9088` |
| `web/finance-locale.js` | 38,181 | `a09bbc90aeed1d45feb857b820ddf986887c3daedc0e199ceda5314dbb1f7ee4` |

Separately, the public 6423 runtime rejects arbitrary contract CREATE. The
test-market artifact has only local Hardhat receipts; Chain Core must own any
runtime/consensus capability decision and record real chain receipts before
Finance can enable issuance, redemption, transfer or DvP execution. No
private credentials, genesis edits, production writes, or cross-owner changes
were made in this candidate.
