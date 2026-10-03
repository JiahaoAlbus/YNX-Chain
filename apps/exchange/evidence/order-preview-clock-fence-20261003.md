# Exchange ordinary preview clock fence

Source predecessor: `adf6330ce40773b6b9b6c3a58f90c4c8a301b0be`.

`buildOrderPreview` compared rule observation times against an unchecked
`now` argument. With NaN, both age comparisons were false, permitting an
otherwise stale observation in this advisory helper. It now requires a
nonnegative safe-integer millisecond clock before freshness checks. The default
still uses Date.now(); the exact 120-second age and five-second future tolerance
remain inclusive. No Wallet, grant, POST, signing or execution capability added.

Executed local gate:

```
node --test apps/exchange/tests/order-preview.test.mjs apps/exchange/tests/market-data.test.mjs apps/exchange/tests/candles-browser.test.mjs
git diff --check
```

44 tests PASS, 0 failures, 0 skips, 6756.989916 ms. Includes actual local Chrome
stalled-read preview recovery, conflicting market revision recovery and
desktop/mobile read-only candle controls. Controlled source/market displays are
not public source-bound runtime, real provider approval or real orders.

Formal asset graph/publication remain release-owner responsibilities. Changed
ordinary module bytes must be incorporated into that graph before publication;
do not overwrite it from this older owner checkout. Public deployment, account
approval, signatures, Exchange order execution and installed acceptance remain
unproved. Revert only this clock guard/test in an ordinary successor if needed;
no database or production state changed.
