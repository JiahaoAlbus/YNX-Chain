# Native Paper explicit-cost integration

Owned continuation from `87ae9a1ef0e5b1a517b842a170b4fc2020a3d815`; no shared Wallet/Auth/SDK source changes, Host action, real account request or transaction.

The native-owner POST `/v1/wallet/paper/orders` now consumes the original engine's `executionCosts:{policy,feeBPS,slippageBPS}` contract through the same strict parser as browser-local Paper. Policy is `adverse_price_ceil_fee_micro_v1`; fee is integer 0..10000bps, slippage integer 0..9999bps. Explicit null/missing model fields, unknown fields/policy, duplicate body keys and unsafe values fail closed. Omitted costs remain original legacy settlement for compatibility with exact historical pending requests, not a new default offered by the native UI.

Native authorization still chooses the durable native owner workspace. No caller-supplied tenant/account selects another workspace; real Standard Wallet alone does not authorize native Paper. The original engine reads attributed market price/volume, enforces saved strategy/risk limits, caps fills, settles and persists the same idempotent receipt. No second matching, cost or permission engine.

New native UI signals require explicit reviewed rates (initial visible assumptions 10/5bps, editable; not venue tariffs). Buy adverse price/notional round up; sell down; fees round up in quote micro-units and debit actual fills. It is not an executable quote or a fill guarantee. No gas, real funds, Testnet or scheduling authority is implied. Twelve language explanations and separately accurate backtest copy avoid describing new signals as fee-free.

Rates are part of preview, durable request and exact replay identity. Edited rates invalidate preview; even an inert background edit is rechecked at confirm. UNKNOWN retains exact rates/key/body across refresh/reload; changed rates cannot supersede it. Legacy UNKNOWN retains its original no-cost body, locks the rate inputs and shows the legacy explanation instead of silently adding costs. Silent local storage write/removal failure cannot claim completion. Receipts must bind cost policy/rates and safe execution/notional/fee values before clearing the journal.

Executed focused checks: ten controller tests, plus actual controlled Chrome native Paper flow (eleven total passed) cover no-write preview/cancel/blank rates, edited-preview refusal, full captured parameters, UNKNOWN reload exact replay and multilingual explanations. These are local controlled SDK/API fixtures, not real Wallet approval or public lifecycle evidence.

Go race passed `./internal/quantlab` 9.871s and `./apps/quant-lab/server` 1.432s. Extended native HTTP test executes original engine cost settlement, malformed input refusal, changed rates 409 and cold restart/offline exact receipt replay. Existing original engine suites cover concurrent instances, overflow, conservative rounding, fill caps and daily-risk refusal. Old typed-reader/legacy rollback tests remain intact. The extended test intentionally consumes the current saved strategy hash after old-version research replaces that same strategy ID; it does not relax the server's stale-strategy rejection.

Final full Node suite: 315 total, 314 PASS, zero FAIL, one Hosted Wallet environment SKIP; duration 108479.403209ms. Versioned asset gate PASS six assets; JavaScript syntax and Git diff checks passed.

Public/installed/source-bound shared producer/Linux execution/real approval/Product Session lifecycle/Testnet/signature/ComputerControl remain NOT VERIFIED. Native scheduling and full publication remain separate unfinished requirements. Immutable runtime identities follow in a separate evidence freeze.
