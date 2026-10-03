# Quant ordinary research localization and public gap

Inherited owner base: `18f06d09d5b4f18e2222dae286d067cb2dee9336`, branch `codex/exchange-sso-cookie-binding-20261002`. This is not a product completion or deployment receipt.

## Direct public observation before this source change

Personally opened `https://quant.ynxweb4.com` in Codex IAB and submitted one normal guest/stateless out-of-sample backtest, without account authorization, signing, funds or execution. The public result displayed 0 bps OOS return, -50 bps buy/hold, 0 bps drawdown, Sharpe 0.440 and measured strategy/benchmark curves. Experiments showed 6 trades, 6 partial fills and explicit costs. This proves only that public stateless research flow, not persisted saved strategy, provider approval, Paper orders, Product Session or live capital.

At 390×844, Arabic changed navigation/private copy and document direction to RTL, but research boundary and experiment headings remained English. Public page width did not exceed viewport; one tab, no warning/error console entries observed. Screenshot 04 was recaptured after language paint; the earlier stale English capture was rejected.

Accepted screenshot files: `/tmp/ynx-financial-public-flow-20261003-TWig1A/01-quant-research.jpg`, `02-quant-public-result.jpg`, `03-quant-experiments.jpg`, `04-quant-mobile-arabic.jpg`. Browser viewport override was reset and the temporary tab closed.

Public `/api/version`: source `664b80b00ac576317524f25b49fc01d1c0db7196`, HTTP 200, 274 bytes, SHA256 `f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df`.

Public `/api/health`: HTTP 200, 462 bytes, SHA256 `9f20f70d5719359683c2f2e4a0dabacd7003072d01b16e1930520ea79b01b4cb`; file snapshot storage, multiInstance=false, production database required. Public app.js bytes=46133, SHA256 `21d33863bbe8c3f49db5dcb6c3f97f774f96e438c3806bdd36b141363ddf40bc`, not current owner source.

## Actual source correction

Translate ordinary research name/window labels, experiment headings and stateless/authority boundary across all 12 supported languages. Reuse existing cost/metric translations. Translate spans rather than entire labels to preserve inputs and draft values. No shared SDK/Auth/grant, Wallet brand, release pins or runtime graph changes. Remaining Wallet English strings and other ordinary strategy/leakage copy are not claimed corrected by this checkpoint.

## Verification

- `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/browser.test.mjs`: 70/70 PASS, 0 skipped, 47027.335625 ms. This ran before the boundary-copy addition; the final focused run below covers that addition.
- Final `node --test --test-name-pattern='translates research fields' apps/quant-lab/tests/browser.test.mjs`: 1/1 PASS, 0 skipped, 1947.642292 ms. Actual local Chrome + Go server exercises every locale, Arabic RTL, exact label/catalog values, retained draft values, six intact inputs, no page overflow, no POST and one tab. This is local controlled validation, not public adoption.
- `node --check` i18n and browser test; `git diff --check`: PASS.

## Publication and rollback handoff

Formal SDK/served graph/pins/build/public/Host belong to wallet_release_owner under current consolidation scope. Central must adopt this owner source together with Quant lost-return recovery `96de9718fc79fbdaf00fd3bb0b0af2920741ca54`, regenerate graph/pins and publish as one source-bound release. Preserve prior exact served release as rollback target; do not mutate shared release registry from this owner branch. Latest runtime mismatch and shared action-verifier dependency have been reported only to `接续测试网生态审计工作`.

Public adoption of this correction=false; real provider approval/signature/transaction=false; installed evidence=false; multi-instance DB validation=false; overall completion=false. No SSH/deploy occurred.
