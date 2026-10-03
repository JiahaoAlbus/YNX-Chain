# Quant owned research and account recovery — 2026-10-03

## Scope and status

Owner branch: `codex/exchange-sso-cookie-binding-20261002`.
Reporting destination: `接续测试网生态审计工作` (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`).
This is an inherited Quant product-source checkpoint, not a deployment, installed
Wallet approval, real market performance, or real order/transaction receipt.
No Wallet/SDK/authority/Host/DEX/Pay/Card source or production state was changed.
The existing bundled Wallet runtime was exercised, not rebuilt. A's coordinated
compatible bundle/cache graph and release remain required.

## Exact implementation checkpoints

- Records read ordering: `75716278a740251dee8b5892afa9eb251f90be4b`, tree
  `176191500205d9adbf58f87075b5ac686a87fd3b`. A newer verified records read survives
  older success, unavailable and authorization-failure responses. Current rejected
  authorization still clears private records. Scope remains `quant:records:read`.
- Risk snapshot ordering: `63c25752f57854f6f0a4ffaba6652731cd5966fc`, tree
  `c9101c123a9f0ec083b0270f66680eeb37123dfc`. An older actual local-service snapshot
  cannot hide a newer confirmed Paper kill switch.
- Research result provenance: `9acc9d1454d1378194e351948110bc544ad25ac7`, tree
  `e48b6ce3314451f1d4b9444fe9e76740d30efcdd`. Request-time mode determines whether
  the result is saved. A public result returning after the first workspace response
  remains temporary, unsaved and unaudited. Page-local results do not modify the
  authoritative snapshot or saved strategies; Refresh retains them, Reload discards
  them. Their explicit provenance is available in all 12 supported languages.
- Account panel: `077a399854fd2b92eaafbc5c867523ce99894a80`, tree
  `a25cdfa0538ab81004d90d9b079c125f354d85f3`. Native details/summary defaults collapsed
  so the mobile guest research view is visible. Original standard Wallet, browser
  identity, private account and existing-record controls remain separate and retain
  their IDs, hidden/disabled states, download links and authority boundaries. An
  actual callback path reveals the panel, but only the existing controller validates
  its result. Keyboard Enter/Space, 44px controls, 12 translated panel labels, RTL,
  no horizontal overflow and no request/new-tab side effects were checked.

Panel implementation file identities at `077a399854fd2b92eaafbc5c867523ce99894a80`:

| Path relative to apps/quant-lab | Git blob | SHA-256 |
| --- | --- | --- |
| web/app.js | 9f39b3d6cc4b240e604724131f079a4b1af84c15 | dda9338555a89972e9cfc294cfd03e205c1017e49e8080d44ff462b7a3c50588 |
| web/index.html | 368c23ffac9134428e6da4d0c44e1d55606b45dc | 7946d582a4a903d26d7274da7a4bebb6ee44ce2a929a829c54aabce7188c6086 |
| web/styles.css | a4b3b8a878328911f648bb5417c6f8827829dfb2 | 8d5eb591db842fb1d9561f897f96e0079c011d774b35488134db99ad713dbd97 |

## Executed local gates

Run from the owner worktree; no shared bundle rebuild or live account approval:

```sh
node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/browser.test.mjs
node --test apps/quant-lab/tests/private-session.test.mjs apps/quant-lab/tests/private-protocol.test.mjs
node --test apps/quant-lab/tests/wallet-flow.test.mjs
node --test apps/quant-lab/tests/chain-config.test.mjs apps/quant-lab/tests/provider-lifecycle.test.mjs apps/quant-lab/tests/records-session.test.mjs apps/quant-lab/tests/browser-sso.test.mjs
```

Results respectively: 22/22 (15.379s), 9/9 (6.295s), 16/16 (47.760s),
11/11 (3.805s), all PASS and no skips within those commands. Syntax and
`git diff --check` passed. Browser tests execute actual Chromium with the real
owned HTML; research/Paper cases use an isolated local Go service. Synthetic
research data and injected providers are explicitly isolated fixtures and cannot
prove public market performance or real user permission. The private protocol
fixture uses the existing SDK and isolated kernel, not a deployed Gateway.

`node --test apps/quant-lab/tests/hosted-native-cross-service.test.mjs` is **NOT_RUN**:
its single case skips because `YNX_QUANT_HOSTED_WALLET_DIST` is not supplied.
Its visible-button selectors were adapted to the new panel, but that is not a
cross-service pass. Do not count it in the 58 passing cases.

## Actual local-browser screenshots

Files remain local under the worktree's ignored `tmp/quant-lab-evidence/` directory;
they are not a hosted artifact or production screenshot. Parent inspected all three.

| Filename | Bytes | SHA-256 |
| --- | ---: | --- |
| account-panel-mobile-closed.png | 70315 | d9eb8d5be52a985b77ed6cfc3b77dfaa49b3d035911963e22a185843bccf8b39 |
| account-panel-mobile-arabic-open.png | 135843 | ff56f74e52e2d68914d5761d5b68b2d2dbd27e9e514d5bd5d742eaac23900d0e |
| account-panel-desktop-open.png | 150904 | d99e842344c8fea0c3f7405df4a22bbc8147f9387da29a0cd8019b4c5af996c8 |

## Remaining boundaries and integration

Follow-up run reproducibility: each displayed research result now contains an
accessible details panel populated exclusively from its returned `strategy.Source`,
64-hex `DataHash`/`StrategyHash`, `assumptions` and the five allowlisted
`metricDefinitions`. It never substitutes subsequently edited form inputs. Missing
metadata remains unavailable. Formula/source text uses text nodes; HTML-like input
is not executed. Details, metric labels, result title and chart explanation support
12 languages; service formula strings retain the exact reported text. Existing
research and risk completion messages now follow a language change while visible.
The endpoint and response schema, calculations and execution permissions are unchanged.

Final business plus actual Chromium suite: 24/24 PASS, zero skipped, 16.344s. The
reported-result boundary covers source/hash/parameter binding, zero seed, missing
metadata, input edits, 12 language changes and plain-text formula rendering. The
browser journey checks returned fee 34/slippage 17 remain visible after inputs are
changed to 900/800, Arabic labels, no horizontal overflow and the localized temporary
result message. It uses explicit synthetic UI metadata alongside the real isolated
Go workspace response; it is not a public market backtest.

Final local screenshot `tmp/quant-lab-evidence/research-run-details-mobile-arabic.png`:
160442 bytes, SHA-256
`fdaffeedf5352755cb72cff5d5be203227bae38d0634ee6a7058c7e3b9ea578f`.
Parent inspected it after the final code/test run. It is retained locally, not hosted.

Multi-instance follow-up is a deployment/input dependency, not a missing engine:
the inherited service already has `postgresStateStore`, CAS, and
`YNX_QUANT_DATABASE_URL` / `YNX_QUANT_STATE_NAMESPACE` configuration. The previously
observed public filesystem backend still requires A to configure and verify the
existing PostgreSQL path with proper migration and multi-instance evidence. No
database credentials or Host configuration were read or changed here.

Follow-up research amount truth: absent attribution previously rendered five zero
PnL/fee/slippage values. The original renderer failed the new boundary test with
exactly those five invented zeros. Rendering now preserves measured integer zero,
shows the existing engine's exact `YUSD_TEST_MICRO` unit, and uses an em dash for
missing attribution, incompatible currency, noninteger/unsafe numeric values or
malformed amounts. This does not change backtest calculation or currency semantics.
The meaningful boundary covers missing attribution, valid negative/zero/cost values,
wrong currency, unsafe magnitude and HTML-like malformed data; 15 business-flow
tests pass. The real-page temporary research fixture also checks all five missing
amounts remain unavailable rather than zero.

Follow-up risk localization: the existing Paper cash/position/reconciliation/kill
state, explicit kill confirmation and completion messages now use all 12 supported
languages. English wording remains compatible. The real local Go/Chromium mobile
Arabic journey dismisses the localized confirm, observes zero kill POSTs and rereads
unchanged persistent risk; the existing English confirmation/completion journey also
passes. These two final browser cases passed in 2.565s. The prior 22-case business and
browser run passed with the translation change before this expanded Arabic assertion.
No risk API, execution engine, proof, or authority changed. The local screenshot
`tmp/quant-lab-evidence/risk-arabic-confirmation-cancelled.png` captures the Arabic
Paper state after cancellation; it is not a deployed-user receipt.

- A owns shared Wallet/Auth/SSO/SDK/permissions, compatible asset/cache rebuild,
  public API binding, deployment and installed/public end-to-end verification.
- The new panel labels are localized; this is not a claim that every inherited
  business field or existing bundled standard-Wallet string has been localized.
- Real public/installed account approval, callback, Relay/WalletConnect, signature,
  transaction, native execution and product-session migration remain NOT_VERIFIED.
- Testnet execution is still fail closed without the native mandate and exact
  one-time private proof. No new financial engine or live capital authority exists.
- MONSTER remains NOT_RUN; no usable channel is configured.

## Exact Paper risk outcomes and concurrent action boundary

Inherited f745fd1bf7283f99324ec3b1bf225d757c9355f6. Offline inspection of the existing Go Reconcile implementation proves nonzero differences activate the persistent Paper kill switch. The UI previously discarded the returned PaperState and always claimed zero difference. Owned UI now validates safe exact Cash/Position/ReconciliationDelta and boolean KillSwitch from the actual response; only zero receives the zero message, while a nonzero receipt requires active KillSwitch and shows its exact integer difference. A kill acknowledgement must explicitly return KillSwitch=true. Malformed, unsafe or inconsistent 200 responses are unconfirmed, not success. The localized difference retains its exact numeric suffix when language changes. Independent in-flight guards coalesce each risk action through response/readback, avoid duplicate confirms, and keep busy controls guarded across locale/snapshot rendering. No API, engine, authority, shared protocol or financial capability changed.

Necessary combined local regression: 33/33 PASS, zero skips, 17.584 seconds. The actual local Chrome/Go test alters only a controlled client snapshot by one unit to model stale observation, invokes the real existing reconciliation API, delays and replays the UI event to prove one POST, and reads persisted real delta=1/KillSwitch=true after refresh. This is isolated local Paper QA, not public capital/order evidence. Shipped-app boundary tests check exact zero/nonzero/MAX_SAFE differences, unchanged numeric suffix in Arabic, duplicate confirmations/request coalescing, and malformed/unsafe/inconsistent receipts never receiving success copy. All retained account/portfolio/permission/storage/research/Paper/reconnect/risk tests pass. Public current-source, approved Wallet and Product Session user flows remain unverified.

Fresh public probes are separately recorded in public-runtime-guest-observation-20261003.json. Those actual unauthenticated reads/browser opens still show the prior Finance/Exchange/Quant runtime commits, not this source. The browser contexts were isolated, no provider/account/token injection or authorizing/signing/transaction clicks occurred. Headless Chrome is not ComputerControl. Only default guest observation is proved, not product completion. Default internal fragment navigation is recorded literally and is not misrepresented as external navigation or a blank tab. Sole A must publish a coherent source-bound graph; owner then verifies original service/approved-rejected/refresh/account isolation independently.

## Research submission lifecycle

Inherited 123f2eec0d90c86776c5c0ee52635d41a19167ff. The existing backtest form had no in-flight guard, so repeated submits could create distinct saved experiments and let completion order determine the visible latest result. The owned UI now accepts only one in-flight research request, binds its captured parameters and submitted public/saved mode, and exposes a localized 12-language request-pending status plus real form aria-busy. No performance/result is fabricated while waiting. The button returns to enabled after response handling or failure; failed requests are not automatically replayed. User edits remain a separate next draft. Strategy request IDs now use UUID rather than millisecond timestamps to avoid unrelated intentional requests colliding in the same millisecond. No strategy specification, assumptions, engine, source ingestion, server permission or SDK contract changed.

Concentrated necessary regression: 30/30 PASS, zero skips, 17.998 seconds. A real local Chrome form against the actual local Go page delays the backtest HTTP response, triggers a second real submit event, changes locale while pending, checks exactly one POST and no confirmed result, then returns an explicit unavailable error and checks aria-busy/status/button recovery. Shipped-app boundary cases cover both public and saved mode, exact original parameter body after draft edits, failure with no experiment or automatic replay, unchanged zero Wallet proof, and all retained research/storage/Paper/risk/account gates. The delayed HTTP response is controlled local QA, not a real market backtest result. Cross-tab/server-wide backtest deduplication, published original-service success and installed/public Wallet approval remain unproven; the UI guard is not substituted for those requirements. A remains the sole compatible build/public-release owner.

## Durable workspace storage recovery

Inherited immutable owner predecessor 8c3420c1ae8063f0d34cd8f98c4591924dc9d0d3. Source inspection found direct tenant/locale localStorage reads could abort the whole Quant page, including public stateless research. Owned app initialization now catches unavailable storage and verifies tenant persistence/readback. No ephemeral tenant is substituted. If durable storage is unavailable, requests omit both local-preview mode and tenant headers; the server's existing public snapshot/research behavior remains authoritative. The page stays usable with an explicit 12-language warning. Language selection itself does not depend on writable storage. Saved workspace/Paper operations are not granted; initial risk controls are disabled even before the first snapshot, and their handlers check stateful authority before confirmation or HTTP.

Paper intent persistence now requires exact local readback before any POST. Quota/write/readback failure disables workspace writes and sends no order, rather than inventing recovery or switching identities. Existing persisted pending intents, uncertain-outcome retries, double-click coalescing, server result bindings and wallet-independent browser tenant remain intact in normal storage. No server/database/auth/SDK/financial engine or scope changed, no real capital enabled.

Final concentrated local business/actual-Chrome+Go run: 27/27 PASS, zero skips, 15.744 seconds. Real local browser denies Quant storage, observes the English/Arabic notice and stateless research request, confirms no tenant/local-preview headers and no Paper/risk POST, and verifies disabled guarded controls. Boundary fixtures execute shipped app for get/set/remove denial and silently discarded writes/readback mismatch, a later Paper intent quota failure and zero request/proof. Retained real local persistence/risk/refresh/RTL/guest research tests and controlled portfolio/account/signing fences pass. These results do not prove public approval, published source identity, Product Session, real orders or installed execution.

Earlier draft failures are retained as failure facts: the first combined run passed 2, failed 23 and cancelled 2 (new storage translations used Exchange zh-Hans/zh-Hant instead of Quant zh-CN/zh-TW and prevented app startup); after correcting locale keys, 26/27 passed and the browser exposed initial risk controls remaining enabled when the first snapshot was unavailable. The initial guard and request headers were corrected and the final complete run passed. No failed draft was committed or deployed. Final compatible versioned assets and public release are owned by A, not this local QA slice. After A freezes a source-bound public runtime, owner must independently exercise original research/account/Paper services without promoting local fixtures to completion.
- Source recovery is a normal reviewed revert of the individual commit(s), with
  final compatible rebuild by A. Do not reset other owners or treat a source revert
  as an installed/public rollback. No deployment occurred in this slice.
