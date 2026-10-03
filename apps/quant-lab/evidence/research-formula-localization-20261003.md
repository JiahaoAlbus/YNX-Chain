# Quant service-bound formula localization — 2026-10-03

Continuation from clean pushed owner checkpoint
`5f0c571c3f7732c5147a5f2717784b0f96a91149`, not a new product or engine.

The existing run-details view localized labels but displayed every service
formula verbatim, leaving the current five metric explanations in English
after a language change. The ordinary product page now translates byte-exact
known engine definitions in all twelve existing languages. A permanent test
checks this translation registry against the actual five definitions in the
owned Go research service. Unknown/historical definitions remain original
text; absent definitions remain unavailable. Neither translated formulas nor
missing metadata can create a metric or a completed research receipt.

No new API, shared protocol, authority, cache pin, installer or Host change.
No raw HTML rendering: unknown text remains assigned through textContent.

## Executed evidence

- Business-flow tests: 52/52 pass, including all-language formulas, exact
  service binding, unknown/missing preservation, existing receipt/request
  binding and permission isolation.
- Actual controlled local Chrome full browser suite: 21/21 pass, zero skip.
  Added mobile 390px all-language formula test preserves numerical results,
  no horizontal overflow, no extra tabs and no extra request on locale change;
  a literal script-shaped unknown formula renders as text, not executable HTML.
- Local screenshot retained in owner Git evidence:
  `apps/quant-lab/evidence/research-localized-service-formulas-local-qa-20261003.png`,
  182721 bytes, SHA256
  `261d7a2b38454c5be621c12af33dd0288ec66f07013558493e27336984abcffc`.
  UI receipts used by that browser test are explicitly controlled fixtures,
  not a public backtest, approved account or real transaction.
- Full Quant npm test: 62 tests, 61 pass, 1 existing failure
  `QUANT_ASSET_HASH_MISMATCH:styles.css`, zero skip. No gate waived.
- Full Go race: internal/quantlab 3.001s, cmd/ynx-quant-desktop 1.309s, PASS.
- Node syntax and git diff whitespace checks: PASS.

## Formal integration

Current ordinary `web/app.js` is 138036 bytes, blob
`72ee1b168a235bbf85b16f255c0e1888dadec197`, SHA256
`29b21c0945358ce99a5ad790d5e1d96201bd25e33b5ebe582639d0079f19309a`.

Issuer A must preserve the existing formal graph/shared authority and include
the already-delivered marked-equity drawdown fix together with this product
page delta, then freeze actual final assets/build/public identity. Do not
publish a whole older owner checkout, copy an old bundle over this page or waive
the asset gate. A formal integration request has been sent to the successor
audit thread; source/public/installed/backend/provider/user acceptance remain
separate. No new public deployment or real account/private-session/strategy
execution/signature/transaction is asserted by this evidence.
