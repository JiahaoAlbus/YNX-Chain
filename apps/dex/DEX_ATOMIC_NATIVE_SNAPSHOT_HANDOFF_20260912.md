# DEX atomic native snapshot consumer

Source-only candidate; no public deployment, installed Wallet approval, signature,
native transaction, Product Session or BFT-finality completion is claimed.

## Exact dependency

- Core source: `28d30b4b9ac983811f1e6a87f7620ec3bf3f8316`
- Core tree: `6b8a378e38e460c6110177d08407f3f1e3b38967`
- Contract: `docs/api/native-finance-snapshot-v1.md`, blob
  `fb384a8089abd8864b765cb9636994054cd0168d`.
- Owner predecessor: `f4aaa1103d5519d257ba887f4bd697ceada5f3ff`, tree
  `354e0fd877cf3fce1591dd16e71fae436858d103`.
- The two unchanged Core golden JSON files under `src/fixtures/` are synthetic
  isolated-ledger test fixtures, not public receipts or runtime fallback data.
  Snapshot: 5524 B, SHA256
  `5d7a0c321eb82bd7c81ee832f69232e8dc14163dbd02cc9001498ebcc3b3e5bf`.
  Receipt (reserved for the next transaction-status consumer): 1979 B, SHA256
  `7a754deb1a613b635c672b73f6f5e06be31de7f90a9449a4e06165cf3f25e14d`.

## Actual implementation

`src/native-snapshot.ts` consumes only
`GET /v1/native-snapshot[?account=<canonical-address>]`. It requires the exact
`ynx-native-finance-snapshot-v1` schema, decimal-string integers, complete account/
asset/balance/LP/event coverage, matching requested owner, explicit zero entries,
native YNXT once, nonce=current+1 (uint64 exhaustion remains null), matching
transaction aliases, complete LP share totals, and an atomic observation.
Amounts/reserves/shares remain strings/BigInt; UI block-height conversion rejects
unsafe numbers rather than rounding. JSON-number signer nonce input also rejects
values whose next nonce is unsafe. Address conversion delegates to Wallet and
does not grant signing authority or merge whole YNXT with EVM wei.

My Positions now obtains all balances and LP proportional reserves in one read,
replacing the four ABCI-v13 reads in the predecessor. The market/quote consumer
uses that same schema, with no silent old-ledger fallback. Asset registration is
not described as owner review or safety endorsement. Unknown event fee totals
are null, not fabricated zero. Candles exclude pending events; included event
history and current reserves do not claim BFT finality. Snapshot identity is an
opaque projection identifier, not a locally verified AppHash or signature.
The independent durable checkpoint is never substituted for the current
observation identity or claimed to prove all values are durable.

Account and market reads omit credentials, disable cache, have an eight-second
deadline, support manual/online Retry, and fence stale or disconnected responses.
Locale changes translate existing ledger errors without another account read.
All 12 portfolio boundary translations explicitly distinguish current pending
state from finality. Wallet standard connection does not depend on these reads.

## Checks

From `apps/dex`: `npm test -- --reporter=dot`, `npm run build`,
`npm run verify:canonical-authorize`, `npm run verify:legacy-route-quarantine`;
plus `git diff --check`. 99/99 tests in 11 files pass, including exact Core
golden consumption, two owners, large integers/exhausted nonce, wrong version/
owner/coverage/aliases, omitted/duplicate balances, LP coverage, pending state,
stale/future observation, read races, timeout/reconnect, and locale-switch errors.
Typecheck and production-mode Vite build pass; canonical scan covers 20 sources.
Node emits an experimental localStorage warning; test storage is supplied by
jsdom, and this is not a real installed-provider or browser acceptance claim.

Local build inventory (not a public release or installer):

| File | Bytes | SHA256 |
| --- | ---: | --- |
| dist/index.html | 931 | 681715968eb52190d13bd36eb742ed887e48c399db84c404d65245ea1261bacc |
| dist/assets/index-CB6E2I1v.js | 357589 | 160420e498f96fc13f4d609a4a4634897a4dd32bd4dba01b2e59a1c6a3388196 |
| dist/assets/index-D1zW4_Sh.css | 25524 | 7acf4148f07e1e010d5829eaec739b0929a141ee06c20a2ff82f88cfa979afe7 |
| dist/assets/index-CB6E2I1v.js.map | 1575863 | d556f7046484c5537f551633a5505a6101e937f3d57d26745756a88918040ee7 |

## Integration and next work

The new coordinator task `01a094cc-0ba3-7901-bcd5-56fce8330c0d` owns publication
coordination. Publish this DEX candidate only with a compatible, source-bound
Core snapshot runtime at the configured same-origin gateway. At handoff the
Core change is source-pushed but not evidenced as the public snapshot runtime.
Old schema yields an honest validation error, never a zero portfolio.

No DB migration or shared Website/Wallet/Core file changed. No server command or
old August lease was used. No public runtime changed, so no production rollback
is needed; source rollback is an ordinary reviewed revert of this owner change.
The next independent owner slice consumes fixed Wallet SDK `c97f85e9` and the
transaction-status API. Native DEX action review/signing remains a Wallet-owned
dependency. Do not unlock Swap/liquidity from provider/account detection alone.
The earlier explicit public DEX browser access denial remains respected; local
source tests and earlier desktop/mobile guest observations do not override it.
