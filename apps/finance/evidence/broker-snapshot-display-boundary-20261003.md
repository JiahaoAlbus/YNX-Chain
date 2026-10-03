# Finance broker snapshot display boundary

Inherited baseline: `90e7a26b786f6510926c267d7ddbc0a81b5a4abc`, branch `codex/exchange-sso-cookie-binding-20261002`. Scope: ordinary Finance page and direct tests only. No Finance authority, shared Wallet/Auth/SDK, Host, installer or production changes.

## Reproduction and correction

The existing snapshot check accepted missing cash/buying power, numeric rather than decimal-string values, and null position/order rows. The added regression failed before the fix (`data` instead of `unavailable`). Such responses could show undefined amounts or interrupt row rendering.

The ordinary read/display boundary now checks fields actually rendered before accepting the snapshot. Decimal strings use the existing provider contract in `internal/finance/brokerage/alpaca.go` (`providerDecimal`), without changing that service. Valid signed decimal strings remain byte-exact; no rounding, zero substitution, invented balance, or client-side authority is introduced. Invalid current responses render the existing localized unavailable/unknown state; revision/account/guest fences are preserved. This is not a complete provider authorization/schema validator.

## Executed checks

- `node --test apps/finance/tests/broker-snapshot-view-ownership.test.mjs`: 10/10 PASS, 1128.483625 ms; actual Chrome account-race case included.
- `node --test apps/finance/tests/broker-execution-browser.test.mjs`: 26/26 PASS, 17272.489084 ms; real Chrome loading shipped ordinary page against explicitly controlled local HTTP/Wallet fixtures, not real authentication/provider execution.
- Added full-page case: exact fractional cash, malformed amount/null rows become unknown with no remaining position/order rows, all 12 shipped locale options, subsequent exact 32-digit/18-fraction cash recovery, page errors 0, non-GET requests 0, one tab. First draft fixture mistakenly selected unsupported `hi`; corrected fixture enumerates the actual 12 shipped options. No product language support claim was added.
- JavaScript syntax and `git diff --check`: PASS.
- Broader first run of snapshot + browser + contracts: 47/48 PASS. Existing `contracts.test.mjs` Standard Wallet source-marker check fails at `discoverWalletProviders`. `git show 90e7a26b:apps/finance/web/wallet-auth.js` confirms this marker was already absent before these changes. Do not waive this failure or modify shared Wallet consumption from this slice; route to the current integration audit.

## Integration and honest remaining gates

Integrate only the ordinary app.js hunk and direct tests into A's current coherent source graph, not this whole inherited checkout. Historical manifest pins must not be silently rewritten. Product deployment/installer/real account approval/signature/trading/public readback of this change are NOT VERIFIED. Public runtime/source mismatch and the pre-existing Wallet marker test failure remain separate integration items.

Rollback: revert this ordinary display validation and its direct tests in a successor commit; no persisted data, migration, secret, server command or irreversible operation was performed.
