# Isolated browser lifecycle and full recovery gate

Test correction `e1ab241a611b4a81fda66fa8667698fa60b479aa`, tree `a7417d1b9153dfaddb7d7e9a4cb8a5b24e8af67f`; parent `cb4e212704818c9a6164de5229cc7e78f6e382a7`. Production Web/engine bytes unchanged from the final research/storage-closed successor `dfc3acb4039fd3b81fcfc27fd7cef5b4a53eebd5`.

## Diagnosed local tooling lifecycle

Read the installed Playwright `processLauncher.js`: its completion/temporary-directory cleanup waits for ChildProcess `close`, including stdout/stderr pipe completion. A bounded `DEBUG=pw:browser` run of the branded Chrome harness observed graceful close start at 2026-10-04T04:14:30.266Z; updater/crash-handler messages continued on that launched process's pipe until 04:14:56.796Z, then Playwright reported process exit0 and close completion at 04:14:56.811Z. The whole run cancelled at 45s, duration49117.658625ms. This is additional failed evidence, not a PASS. The observed inherited updater pipe lifetime explains the shutdown wait mechanism; no claim about an underlying Chrome defect or actual user-browser release readiness is made.

The recovery harness now explicitly requires and launches the already-existing Playwright QA Chrome for Testing, instead of the user branded application. No browser download, production change, user profile reuse, updater modification or unrelated-process termination. Missing QA binary fails setup. Explicit context/request disposal remains; nested finally ensures Go/tape cleanup if browser close rejects. Original45s deadline and all functional assertions remain, no timeout increase/skip/forced graceful-success receipt.

QA executable: `/Users/huangjiahao/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, reported version145.0.7632.6, SHA256 `d999cf00c6244a84279785c48eb78f97764a8a13ea3a1a7cc5030bf2f4ca481e`. This is not installed YNX Wallet evidence and does not replace public testing in branded Chrome.

## Final actual run

`node --test apps/quant-lab/tests/research-recovery-browser.test.mjs`: 1PASS, 0FAIL/CANCEL/SKIP, 31099.800541ms. Three isolated browser contexts, two same-workspace tabs, four normal Go SIGTERM stops/restarts. Every cleanup marker completed: overlap context, original contexts, browser, Go service, controlled market tape. Process inventory after terminal shows no remaining owned recovery Go process.

- Actual engine backtests and saved results, cost/benchmark curve provenance, two-tenant isolation, schedules/kill persistence and twelve-language readback remain checked.
- Original late Paper phase: three POSTs/two committed orders; original retry exactly replays; old response cannot erase new journal; fees/notional charged once.
- Controlled corrupt local journal phase: corruption is explicitly injected as a boundary fixture, not natural corruption; valid replacement originates from original UI and real Go engine. Stale Forget creates zero dialogs and preserves replacement; Restore/cancel leaves bytes intact; two POSTs/one new order and exact receipt; reload reads identical three-order portfolios.
- Saved research late response phase: three POSTs/two actual experiments, exact original replay, new journal preserved by old response, cancellation preserves current record, both tabs reload both completed experiments. No injected service results, account, grant or provider.
- No page errors/blank tabs; 320px English, Arabic RTL and Chinese at enlarged text remain verified. No real venue/chain execution.

Retained local root `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-0sFkZs`. Go binary11517090B SHA256 `48418fe95eb5bed135908c409a16df32e544d39f0703ec0313866f5e23ab41aa`; twelve screenshots retained, including `stale-forget-preserved-new-request-en.png`301165B SHA256 `224f91e2ed4d80e3340ca68b0943085bb1fb8e1a770ff32bae23ef4e26475e08`.

Predecessor131 source/cache checks remain exact-scope PASS; this change touches test process lifecycle only. All original independent failures and prior cancelled browser attempts stay immutable. The local expanded whole-browser gate is now PASS on this exact environment/source. Public runtime source binding, formal SDK/Host producer composition, installed app, private identity/Session, actual provider approval/signature/transaction remain NOT VERIFIED. Sole release owner still controls formal matching publication; full Finance goal is not complete. No public or installed acceptance promoted from this test. Ordinary reviewed Git revert only, no reset/force-push/live rollback implied.
