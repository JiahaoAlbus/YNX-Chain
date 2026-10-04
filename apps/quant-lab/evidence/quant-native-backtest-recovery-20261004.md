# Native Paper backtest recovery

This successor preserves the composed runtime and adds native-owner durable backtest submission, not another research engine or Wallet protocol.

POST `/v1/wallet/paper/backtests/from-market` now requires `idempotencyKey` in the original `quant-research-<UUID>` format. After canonical native workspace authorization it invokes the existing `RunBacktestFromMarketOnceContext` in that exact owner workspace. Matching request replay returns the original durable experiment; changed inputs conflict; missing keys fail closed. Request cancellation uses the original context-aware engine.

The native consumer persists exact strategy, assumptions and key before dispatch, checks durable readback, coalesces simultaneous confirmation, and retains UNKNOWN on network loss or bad receipt. Explicit renewed preview displays the original body; it does not silently submit a newly generated strategy or changed form. Refresh/owner readiness remains required. No automatic retry or cross-owner journal removal. A valid completed receipt binds the exact research key before clearing pending state. Review/cancel does not write; Standard Wallet remains independent of private service failure.

Executed focused checks: four native backtest intent tests passed; full focused Paper browser/risk/backtest set ten passed, zero skipped. Actual local Chrome uses controlled native session/API fixtures; it is not real installed Wallet approval or public execution. Versioned application asset gate passed six assets. Full Node suite: 311 total, 310 passed, zero failed, one Hosted Wallet environment skip; 109492.774042ms. Go race: internal/quantlab passed 14.979s, apps/quant-lab/server passed 1.329s. Native HTTP tests additionally prove exact replay, changed-body 409 and missing-key 400 after canonical authorization.

Previously frozen b84871cc4 runtime archive remains historical, valid for that exact source only; it does not include this successor. Public deployment, Linux execution, installation, real account approval, Product Session lifecycle and transactions remain NOT VERIFIED. No SSH/upload/Host or shared SDK source changes.
