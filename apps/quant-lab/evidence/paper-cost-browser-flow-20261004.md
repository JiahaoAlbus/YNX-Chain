# Quant Paper costs — owned API/browser/local engine integration

Source `2f4cb335a9e05550e877adf13c9ee2fa7019c1c5`, tree
`dc8ab6d8a2016e5b30bbf5afbda3f816b855ffc7`.

## Implemented interface and confirmation

The existing owned `POST /v1/paper/orders` accepts optional `executionCosts`:

```json
{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":10,"slippageBPS":5}
```

All three keys are required when provided. Null/missing/unknown/duplicate keys,
unknown policy, noninteger or out-of-bounds rates fail closed before settlement.
No object retains the old zero-cost contract; existing pending envelopes are not
silently upgraded. Same-key recovery binds exact policy and rates.

The ordinary browser form offers explicit legacy or V1 model selection, fee and
slippage BPS. Confirmation discloses exact rates, adverse rounding, volume cap,
simulation-only provenance and that the service reads market at submission.
This is NOT a guaranteed/executable price quote. There are no real funds, gas,
Exchange writes or chain transfers. Twelve-language selected-model disclosure,
validation and receipt labels are implemented; old legacy wording remains only
for the legacy selection. Daily-loss copy now describes settled costs accurately.

After confirmation the exact selected model is fenced, persisted with the intent
and recovered on reload. Changed model cannot retry an uncertain outcome.
Receipt policy/rates must match the submitted model, and BigInt recomputes its
execution price, executed notional and fee; inconsistent/null amounts cannot
clear pending state or claim a recorded order. Valid exact amounts are displayed.

V1 daily risk is calculated again on the prospective settled balance before
mutation. A cost-induced limit breach refuses the entire settlement without
recording hypothetical balances/loss. Accepted settlement immediately reports
actual fee/slippage marked loss. Legacy settlement remains unchanged.

## Executed tests, including corrected fixture failure

- Initial new HTTP fixture returned 403 because it omitted the original local
  preview header/loopback request boundary. Added those same original fixture
  conditions; no server authorization bypass. Focused strict HTTP test then
  PASS 2.050s, including invalid input/no state change, 409 changed-cost replay,
  201 mathematical receipt and restart/offline exact recovery.
- Final `go test -race ./internal/quantlab ./apps/quant-lab/server -count=1`:
  PASS 5.840s / 1.882s. Includes the original tests, cost concurrency, immediate
  daily-cost loss, and cost-induced loss refusal with unchanged state/audit.
  No new PostgreSQL run is claimed by this invocation.
- `node --test apps/quant-lab/tests/business-flow.test.mjs
  apps/quant-lab/tests/cache-version-browser.test.mjs`: 119 PASS, 0 FAIL,
  0 SKIP, 1485.269167ms. New costs tests cover all locales, invalid rates,
  cancellation, changed-confirmation input, mathematically inconsistent receipts
  and pending model recovery. Cache test uses real local Chrome.
- Final extended `research-recovery-browser.test.mjs`: 1 PASS, 0 FAIL,
  0 SKIP, 19571.882417ms. Actual original Go runtime + controlled tape + real
  headless Chrome, two independent browser profiles and four clean SIGTERM
  service stops. No fixture account or proof is granted.
- Syntax, gofmt and diff checks PASS.

In the actual-browser test, cancelled confirmation sends no Paper request. The
first original engine return is deliberately lost after execution. Reload
restores exact V1/10/5; changing 10 to 11 sends no retry. Restoring 10 returns the
same exact original receipt with identical request bytes and only one cost
debit: execution price 1047524, fee 1048, marked loss 1572. Second browser has no
Paper order or risk leakage; fill/cost/kill state survives service restart.

## Retained local artifacts (not installers/release candidates)

Final local test root:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-160EUJ`.
Local QA binary 11517090B SHA256
`48418fe95eb5bed135908c409a16df32e544d39f0703ec0313866f5e23ab41aa`.
It was compiled from the precommit working tree for the test, not frozen as a
source-bound formal release. Do not relabel it as the final commit or installer.

Committed screenshots under `paper-cost-flow-20261004/`:

- `local-chrome-en.png`: 166512B SHA256
  `0ef29ad56927b6effe3534c7fb29546e9f7adbc50a862e9d986a0beafb5e5ab1`.
- `local-chrome-ar.png`: 138870B SHA256
  `276e65e128d91d940ab120037cf71e9a16ff990a9b2b5eda2063c2d184826bf2`.

These are local Playwright/headless Chrome screenshots, NOT macOS Computer
Control or public provider evidence. Mobile-width English/Arabic flow asserts
no document horizontal overflow; no blank tabs or page errors were observed.

## Exact release handoff / remaining gates

Release owner A must adopt the same API/engine and Web sources together. New
frontend alone on old API would reject the model. App SHA256
`96bc622cf1d5367595b9e3f98356b112d6a577befa451f6739ce9baf7636ba79`
is bound in index.html; index SHA256
`85640b59afb7a1bffe1404e1f9201d69b3cace0a34600128a4eed3a73ed7e252`.
No shared protocol, generated bundle, formal composition/installer/Host/public
release mutation was performed. Public/installed/source-bound release, native
mandate execution, real wallet approval/sign/transactions and Product Session
acceptance remain unproved. The full financial ecosystem goal remains active.
