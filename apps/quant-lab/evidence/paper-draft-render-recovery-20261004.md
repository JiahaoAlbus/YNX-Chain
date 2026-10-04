# Quant Paper draft render recovery — local source evidence

Inherited base: 4da4fbc50a9e7364fc1f850e2416375feca41e8d, tree a15f1add925da4b2c6e913c221b95f150ca86e09.

Confirmed defect: renderPaperStrategies treated every blank dropdown as a request to restore the durable uncertain Paper intent. Refresh and language changes therefore reselected its strategy and replaced edited side/amount/cost fields. Corrected fixture uses the existing adverse_price_ceil_fee_micro_v1 model; original source still failed 0/1 (100.350875 ms), expected blank strategy but received the saved hash.

Correction is ordinary UI only: restore saved fields once on startup, consume initial selection once when strategies arrive, abandon initial selection if draft fields change before the response, and require the existing explicit Restore action for subsequent restoration. No journal, authority, engine, risk, permission or shared Wallet changes. Existing legacy and versioned exact replay remain supported. HTML app pin is the actual source SHA256 5feb20e86f5f6434039ea9d4439dd58aef486d30889932c2d39f506e3d3d4915.

Tests executed:

- `node --test apps/quant-lab/tests/business-flow.test.mjs`: 136 PASS, 0 fail, 965.652375 ms. Includes legacy/versioned draft retention through twelve locales, explicit exact Restore and delayed cold-start read after editing.
- `node --test apps/quant-lab/tests/paper-draft-browser.test.mjs`: 1 PASS, 0 fail, 6244.910416 ms. Actual isolated Chrome for Testing, unchanged local HTML/assets with controlled read-only snapshot. Four contexts: 390/1280 widths × legacy/versioned requests; twelve language changes and refreshes each; exact journal bytes unchanged; explicit recovery; zero writes, stable URL, one tab per context, zero page errors. External requests aborted. No mock is represented as public market/provider evidence.
- JavaScript syntax checks and `git diff --check`: PASS.

Historical recovery-consumer-inputs-20261004.json remains bound to 24157759, not this correction. Publisher must take only these new ordinary hunks, preserve its current shared dependency graph and regenerate final pins; old custody evidence must not be relabelled as current source.

Formal build, public deployment, installer, actual Wallet approval, Product Session, capital execution and product completion: NOT VERIFIED. No account request/signature/Testnet order/deployment executed. Publication remains the unique wallet_release_owner responsibility. This local read-only draft regression is not a production acceptance envelope.
