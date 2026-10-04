# Native Paper consumer: reviewed backtests and durable simulated signals

Predecessor: `fb751918a2b635a1b09d2a54699157e38a6734ae`. All changes remain under `apps/quant-lab/**`; no engine/shared SDK/registry/Host/state or live service change.

The separately approved native Paper panel now uses the existing exact `POST /v1/wallet/paper/backtests/from-market` and `POST /v1/wallet/paper/orders` routes, with a fresh original SDK proof on each request. The existing research form's draft builder is reused, not a second backtest engine. Public stateless research, original browser-local Paper, Standard Wallet, browser SSO and native Paper are distinct.

Every new action requires a modal preview plus explicit confirmation. Backtests show the exact strategy/fee/slippage assumptions before saving to the verified native owner. Simulated signals select only that owner's saved strategies. Preview is non-writing, cancellation writes nothing, input/context/locale changes invalidate it, and confirmation rechecks current fields/owner/epoch. No native Testnet mandate, signature, scheduler or real-capital execution is enabled.

The disclosed model matches the original engine (`applyPaperSignalLocked`): latest configured adapter price, partial fills limited to volume/10, no Paper fee/slippage debit and no price limit/fill guarantee. Backtest fee/slippage assumptions are separately shown. The consumer does not fabricate a market quote or silently use a client-entered execution price.

Pending simulated signal bytes/key are saved before write under the verified native owner, not the EVM alias or legacy tenant. Double confirmation shares one in-flight request. Network/503/unbound receipts preserve the exact intent. Reload restores its strategy/side/amount only after the owner snapshot is loaded; a new amount/strategy cannot replace it. Explicit retry reuses the same bytes and key. Ownership changes before dispatch produce zero HTTP; changes in flight cannot consume another owner's receipt or erase that owner's pending record. Storage failure/corrupt or extra-field pending state fails closed. No arbitrary clearing of UNKNOWN intent is provided.

Executed gates on the final current source:

```
node --test --test-concurrency=2 apps/quant-lab/tests/*.test.mjs
go test -race ./internal/quantlab ./apps/quant-lab/server -count=1
npm run build:wallet
node apps/quant-lab/scripts/verify-versioned-assets.mjs
git diff --check
```

Full Node: 75 total / 74 PASS / 0 FAIL / 1 explicit skip, 61495.593375 ms. The skipped Hosted dist test requires an actual matching Wallet artifact; it is not replaced with fixture approval. The actual Chrome controlled-origin test executes official SDK/Gateway kernel plus actual owned session/actions modules: twelve language controls, separate approve/reject, no initial authorization/write, preview/cancel zero writes, exact backtest confirmation, signal confirmation, invalidated edit, 503/reload/exact-byte retry, read/refresh/reload/revoke and independent Standard Wallet. API results and provider/key remain controlled fixtures, not actual native Wallet or public engine/browser acceptance. Six controller regressions separately exercise pending/ownership/receipt boundaries. Existing ordinary business tests still pass after reusing the draft builder.

Go race: `internal/quantlab` PASS 7.004 s; `apps/quant-lab/server` PASS 1.342 s. These retain existing local actual engine/HTTP/durable native workspace and two-user/concurrent/restart tests; simulated proof/market input is not production or PostgreSQL validation. Build/versioned four-asset binding and diff gates PASS. Final app SHA256 `84fef6039bd825e2182ea9b505892d0e1fda8973d89c59b1040d791e3d3ad04e`; wallet bundle SHA256 `ecca748cb82c9174b301992e8bdbadd65e7c728f78a5b98f0ce3729b50054042`.

Source/functionality progressed, but public/installed/realProviderApproval/realProductSession/realPaperBrowserEngineFlow/ComputerControl/real-order/signature/Testnet/scheduling remain false. Existing native backend scope has no native-workspace kill/reconcile endpoint; the legacy browser-local risk controls do not operate on this newly approved native workspace. That extension must come from the existing backend/contract writer with an exact supported route, not a client pretending old controls are native. Full microsite/current producer composition and A's formal source-bound Host publication remain required. No SSH or unknown upload retry was performed. Report and executable remaining inputs are routed only to 接续测试网生态审计工作.
