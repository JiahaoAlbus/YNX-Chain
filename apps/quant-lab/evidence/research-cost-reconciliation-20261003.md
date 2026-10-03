# Quant research cost reconciliation — 2026-10-03

Ordinary owned research engine/page correction, continuing clean owner
`72e362935707955a4427ccfb6237f624254a267b`.

## Reproduced failure

Actual simulateDetailed regression, constant OOS execution prices, three
fills completing a round trip, fee=1bps and slippage=1bps:

- Price5000: cash/net lost4 micro-units but reported fee1+slippage1=2.
  Reported realized=-2, unrealized=-2, alpha=-2, reconciled=true despite closure.
- Price9999: net lost5, reported fee1+slippage1=2, fictitious unrealized/alpha=-3.
- Fee7/slippage3 reproduced the same unexplained2/3-unit differences.
- Service-level persisted receipt test reproduced the price5000 inconsistency.

All these are isolated synthetic research regression inputs, not published
prices, actual trades, real accounts or capital-execution evidence.

## Implemented policy and boundary

The previous cash path rounded the combined fee/slippage rate while attribution
rounded each independently. New calculations use the independently floored
positive micro-unit components for both cash and attribution. Sum with the
existing checked arithmetic. Per fill: fee=floor(abs(notional)*feeBPS/10000),
slippage=floor(abs(notional)*slippageBPS/10000), debit=fee+slippage.

This intentionally corrects newly calculated micro-unit costs and results;
do not claim they are byte-identical to the former incorrect model. Signals,
quantities, fill prices, permission gates and business routes are not changed.
No costs are promised as real Exchange fees. No actual capital execution enabled.

New attribution has additive optional `costRoundingPolicy`:
`independent_cost_component_floor_micro_v1`. Current page shows that reported
policy in all12 existing languages. Unknown/missing policy remains unavailable,
never inferred from assumptions. Historical attribution decode/re-encode test
preserves old amounts and omits the new field; old receipts are not migrated,
relabeled or recomputed on replay. Same accepted receipt/tenant fences retained.

## Executed verification

- All15 independent price/rate cases: equity/net/realized=-reported costs,
  unrealized=0 and alpha=beta=0 on closed constant-price fixtures.
- Full Service new receipt/state-reload plus historical omission regression PASS.
- Existing idempotent replay, restart, concurrent instance/tenant-isolation PASS.
- Complete Go race internal/quantlab3.040s / cmd/ynx-quant-desktop1.188s PASS;
  Go vet, gofmt, Node syntax, git whitespace PASS. Optional external PostgreSQL
  remains separate; no production database/capacity claim from these fixtures.
- Product business-flow53/53 PASS, including12 languages and missing/unknown
  policy never receiving the new explanation.
- Actual controlled local Chrome full browser21/21 PASS, including mobile
  known policy localization and absent old policy, no overflow/extra request.
- Full Quant npm63tests=62PASS/1 retained QUANT_ASSET_HASH_MISMATCH:styles.css.
  No formal pin was modified and this release gate was not waived.

## Exact ordinary integration inputs

| Path | Blob | Bytes | SHA256 |
| --- | --- | --- | --- |
| internal/quantlab/service.go | c20a69041c180cd321fc22f9a2fb9af286ae5ff5 | 70487 | ef7cf7a9df03d65a37abbdde7d99027b4c3e62bcf10ed282634abe2e8b9c0776 |
| apps/quant-lab/web/app.js | daf6b793ed15e106e95a220c2b15b616b90e3678 | 141286 | 0dd3178ec39d9a2b9d13d24f917e2e2df509eccb04df4ccc6cbc21d7c33281ce |
| apps/quant-lab/web/index.html | 2e238dc70cc4e7617a04dfdd211ece029cda2c10 | 28512 | 83b9e7b9df56827958144287c73ac487fd24e4ab27727ead10ae62f5566fe0ed |

Unique issuer must combine ordinary deltas with the complete matching formal
Wallet/authority graph, not deploy the older owner checkout wholesale. Include
previous drawdown and formula fixes; re-freeze final assets/build/source and
verify public/backend/UI/install independently. Shared SDK/authority/Host and
other owners untouched. Current artifacts/tests do not prove public deployment,
installed accounts, private session, real strategy orders or transactions.
