# Direct public Quant stateless research and accurate training split

Owner predecessor `31f900262897ec853ecf83e22b3cf7ba3b955454`.
UTC observation 2026-10-03T16:23:34.901Z (Asia/Shanghai 2026-10-04).

## Direct API evidence

Canonical `https://quant.ynxweb4.com/api/v1/public/status`: 200, 475 bytes SHA256 `0efcbf79681e6c8d7ee5086d1cefd69928b9a84eb28d712553bac60ca60ea518`, identifies public source `664b80b00ac576317524f25b49fc01d1c0db7196`. Public stateless research reports 30 traceable test-venue observations and research available; Paper, Testnet execution and live funds capabilities are false. This is not a saved workspace grant.

Executed `node apps/quant-lab/scripts/verify-public-research.mjs --run-stateless`, exit 0. Exactly one API POST in this invocation to the public CPU-only historical backtest route, no private/saved/Paper/execution routes. Source receipt was printed before semantic verification to prevent losing already-executed response evidence if a later assertion fails.

`/api/v1/public/research/backtests/from-market`: 201, 4576 bytes SHA256 `0ebc2c7a946adf86c79aff1d46d22d1fc7833c0bf716b15d84946795f85cd856`; returned id experiment-000001 and status completed_oos. Request id `ma-56b9eab1-0f73-425a-91f9-8bb5c9fa1d7c`, name Public CPU-only provenance verification, seed7, fast3/slow8, fee10bps, slippage5bps, latency1, participation1000bps, training24, walk-forward3. Exact strategy ID/name/seed/parameters and every assumption matched the response. Source is the service's Exchange tape adapter, not synthetic bars. Split `train[0:24), out-of-sample[24:30), walk-forward=3`; six equity points. Returned metrics: ReturnBPS0, BuyHoldBPS-50, MaxDrawdownBPS0, SharpeMilli440, VolatilityBPS0, Trades6, PartialFills6, DataGaps0, NoTradefalse. These are short-sample model outputs, not real fills, investment advice or promised performance.

`/api/ready`: 503, 283 bytes SHA256 `4592a6896439bfde9243868675ccb91625e3701a2389a895e2d693de36520655`; filesystem_json_snapshot, multiInstance=false, productionDatabaseRequired=true. Public stateless research works independently; durable/private production readiness remains false.

## Browser boundary and ordinary implementation

Real public Chrome initially opened root 200, default en, visible Research form and no uncaught page errors. The first browser-form backtest probe did not freeze a complete result: reading `#latest-result` timed out after observing a response, and process exited1. No response bytes/hash/status from that probe were retained, so it is NOT a proved visible run. The subsequent direct API probe above is separately recorded, not a reconstruction of missing browser evidence. Authentication navigation and visible private lifecycle remain separate unresolved gates; no account approval/signing was performed.

Actual response proves training24 on a30-record dataset (80%, not50%). Existing local and public leakage labels nevertheless claimed First50%/Held-out50%. Owned source now removes that claim, displays the exact configured training observation count, and uses twelve-language remaining-observations copy rather than a fixed percentage. A single constant binds displayed training count to both ordinary backtest and saved research schedule request builders; no engine/model, authority or Host change.

## Local correction gates

- Business-flow/UI cohort: 91/91 PASS, zero skips, 610.611208 ms. New case verifies all twelve selected copies, training24 and actual request body; existing parameter/cost/provenance/recovery/tenant guards preserved.
- Actual Go-served Chrome 390px locale/draft cohort: one selected test PASS, zero skips, 6082.63875 ms. Twelve languages preserve split copy, training count, six form inputs, draft name/cost, snapshot, no overflow and zero writes.
- App/verifier syntax and `git diff --check`: PASS.

No SSH, deployment, service/DB migration, Wallet request/signature or Paper/Testnet order. Unique release owner must integrate ordinary Quant hunks into the coherent graph and publish the corrected split; direct public API success does not prove latest source publication, browser result completion, tenant/saved-workspace isolation, native install or full product completion.
