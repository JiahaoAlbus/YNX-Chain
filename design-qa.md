# YNX 6423 portal design QA

**Comparison target**

- Source visual truth: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/codex-clipboard-7f8db32a-ff49-4c6b-b7cb-1344ec71a17c.png` (TronScan reference supplied by the user).
- Implementation: browser-rendered `http://127.0.0.1:6437/` from `internal/explorer/web.go`.
- Desktop viewport: 1264 x 712 CSS px, density 1. Source was a 2048 x 1152 resized capture with browser chrome; comparison was normalized to the content hierarchy rather than browser chrome or pixel density.
- States checked: desktop home; ecosystem hover menu; ecosystem directory; downloads evidence state; 1024 x 900 tablet; 390 x 844 mobile; all nine portal hash routes; five locale selections; console error log.

**Full-view and focused comparison evidence**

The reference and implementation were captured together in the browser QA comparison input. The implementation preserves the target's thin fixed-feeling header, announcement strip, wide search field, right-side contextual card, high-density summary, four-card block rail, and layered hover navigation. Focused checks covered the top navigation/hover surface, the metrics-plus-asset region, the richer finalized-block cards, and the responsive header/search region. The blue YNX mark and unavailable market panel are intentional original substitutions: no TronScan branding, market claims, imagery, or token facts are copied or fabricated.

**Findings**

- [P2, fixed] Tablet header caused document-width overflow.
  Location: `@media (max-width:1050px)` in `internal/explorer/web.go`.
  Evidence: first 1024 px capture showed the Connect Wallet area clipped and a horizontal document scrollbar; the reference keeps its desktop header contained.
  Impact: primary navigation and wallet entry were not reliably reachable on tablet widths.
  Fix: the header now wraps into an ordered navigation row and confines overflow to the scrollable nav strip. The post-fix 1024 px capture has no clipped wallet control or page-width overflow.

- [P2, fixed] The reference's overview-to-blocks hierarchy was reversed.
  Location: home content order and summary CSS in `internal/explorer/web.go`.
  Evidence: the initial implementation displayed blocks before the primary metrics; the reference introduces metrics first and blocks second.
  Impact: the page read as a live feed before it read as a network overview.
  Fix: metrics now lead, use a two-column overview matrix plus a YNXT side card, and are followed by exactly four block cards.

- [P1, fixed] The first dense 1264 px desktop pass overran its single-row header after Downloads was added.
  Location: `@media (max-width:1360px)` in `internal/explorer/web.go`.
  Evidence: the first capture placed the compact navigation and wallet controls on top of each other. That is visibly worse than the reference's contained navigation.
  Impact: the primary route targets appeared crowded at an ordinary laptop width.
  Fix: the controlled two-row compact header now begins at 1360 px, has an explicit auto-height inner layout, and retains the full document width without horizontal page overflow.

- [P2, fixed] Low-activity 6423 blocks made the home rail look empty.
  Location: `renderBlockTrack` and `.block-chip` in `internal/explorer/web.go`.
  Evidence: empty blocks initially showed only the height and relative time, while the reference's block cards have several readable data layers.
  Impact: a real but quiet Testnet looked under-populated.
  Fix: each card now exposes its genuine finality state, transaction count, observed slot duration, and exact-time tooltip. The developer callout also carries the actual 6423, `0x1917`, and YNXT identity triad rather than a decorative empty field.

- [P3] The YNXT side card has a deliberately unavailable market/supply state instead of a chart.
  Location: `.asset-overview`.
  Evidence: the reference has market data and a supply chart; the current verified 6423 service does not provide authoritative historical supply, price, market-capitalization, or staking endpoints.
  Impact: the region is visually calmer than the reference but does not make a false market-data claim.
  Fix: connect a verified time-series source, then add actual values and an interactive chart; keep the current fail-closed presentation until then.

**Required fidelity surfaces**

- Fonts and typography: compact system sans stack, strong numeric hierarchy, and 12–16 px supporting text were checked. Header, metric, and card labels remain readable at desktop, tablet, and mobile; no truncated primary control text was observed.
- Spacing and layout rhythm: desktop uses a wide search rail, 22 px major column gap, bordered data matrix, four equal block cards, and restrained 7 px card radii. Tablet and mobile collapse the larger grids without overlaying controls.
- Colors and tokens: the source's neutral page, white panels, fine gray dividers, and green operational state are retained as interaction intent; the red TronScan accent is replaced by YNX blue (`--blue`) and the YNXT unavailable state remains neutral.
- Image quality and asset fidelity: the official local YNX logo and icon assets are used. No copied TronScan artwork, custom SVG substitute, emoji, fabricated product logo, or fake market image is used.
- Copy and content: all identity-bearing copy uses 6423, `0x1917`, `ynx_6423-1`, and YNXT. Data that lacks a verified source is explicitly unavailable.
- Interaction and accessibility: hover/focus menu content was checked; all route links stay in the same portal, ecosystem Open/Docs/Download controls are disabled when unverified, search opens an in-place detail flow, and browser console errors were zero. Five locale selector values update the localized core interface. Mobile navigation remains horizontally scrollable by design rather than clipping links.

**Implementation checklist**

1. Keep the unavailable YNXT market panel until an authoritative 6423 time-series service is available.
2. Re-run the desktop, tablet, mobile, hover, and console checks when a verified market source or public ecosystem artifact is connected.

**Comparison history**

1. Initial visual pass: P2 tablet overflow and P2 metrics/block order found.
2. Iteration: wrapped tablet navigation; moved metrics before blocks; changed the summary into a left data matrix plus a right fail-closed YNXT card; limited the rail to four cards.
3. Density review: the user compared the quiet-Testnet layout with the reference. Empty block cards and a sparse contextual card were identified as the principal visual causes.
4. Final pass: desktop 1264 x 712 showed no document-width overflow, complete 6423 identity density, readable block metadata, and zero browser console errors. No actionable P0/P1/P2 visual findings remain.

**Final result:** passed

## 2026-08-31 full portal interaction regression follow-up

- Download safety: the full Downloads route exposed six product download actions. All six were disabled, exposed `aria-disabled="true"`, and supplied the localized public-artifact-verification reason through their title; there were zero disabled actions without an explanation.
- Route and layout coverage: at 1280 × 820 CSS px, all nine portal routes rendered meaningful content with no document-width overflow. At 390 × 844 CSS px, Home, Blockchain, Ecosystem, Downloads, and Documentation also rendered with no horizontal overflow. The narrow layout preserves the route strip as horizontally reachable navigation instead of silently hiding core destinations.
- Functional evidence: a real browser search for the live local block height `1024` opened the existing same-tab detail drawer at `#blockchain?detail=block%3A1024` and showed its live block fields. An Ecosystem Status control opened the in-page evidence-gated notice; it did not create a new tab or navigate to `about:blank`.
- Locale evidence: switching the visible language selector to Simplified Chinese, reloading, and checking the selected value preserved `zh-CN` and the localized search placeholder. The check then restored the user-visible selection to Korean. The Chinese mobile view had no document-width overflow.

This is a local browser regression against the active 6423 node/indexer. It confirms responsive rendering and in-portal behavior only; it does not claim a public deployment, public product link, wallet provider availability, or downloadable artifact.

## 2026-08-31 developer-documentation boundary follow-up

- Developers now routes its API Reference to an in-portal, read-only Local Explorer API reference instead of presenting a pretend external documentation action. The reference lists only currently served `GET` endpoints for summary, blocks, transactions, search, validators, and YNXT.
- Browser evidence: the local Developers route exposed a real API-reference link, three evidence-gated disabled developer controls with zero missing reason titles, and no horizontal overflow. Following that link rendered the six endpoint rows in the same tab at `#documentation`; it did not create `about:blank` or claim a public endpoint.
- Public wallet configuration, SDK publication, faucet release, and public HTTPS API remain explicitly unavailable until independently verified evidence exists.

## 2026-08-31 contract-search fail-closed follow-up

- A 40-hex-character EVM address that cannot be verified as an indexed transaction or account now receives the specific localized contract-index unavailable state rather than a misleading generic result. This preserves address/transaction resolution where evidence exists and does not infer contract status from an arbitrary address.
- Browser evidence: searching `0x1111111111111111111111111111111111111111` opened the existing same-tab detail surface with the Korean unavailable title and contract-index explanation. The page retained its `#home` route, had no `about:blank`, and had no horizontal overflow.

## 2026-08-31 verified indexed-window chart follow-up

- Data now uses the existing verified local block-index endpoint for the Blocks & transactions view rather than presenting that source as an empty historical chart. The selectable windows are explicitly `24`, `48`, `72`, and `100` indexed blocks—not invented time periods—and every bar opens the corresponding verified block detail.
- Browser evidence: at 390 px wide, the initial activity chart rendered 24 interactive bars and a localized caption reporting `24` verified blocks and the actual current count of `0` transactions. Selecting the 100-block control rendered 100 bars with no document-width overflow; activating a bar opened `#blockchain?detail=block%3A1519` in the existing same tab.
- Active-address, aggregate gas, node-health, and token-activity charts remain explicitly unavailable because no authenticated timestamped source for those series has been configured.

## 2026-08-31 full-shell locale gate follow-up

- The previously static first-render labels for connection state, live-stream opening, verified source state, block waiting, chain facts, and the EVM label now resolve through the same five-locale dictionary as the routed content.
- Browser evidence: refreshed local Home checks at 1280 CSS px confirmed English, Simplified Chinese, Traditional Chinese, Japanese, and Korean chain-fact labels plus the verified source state. Every state had `scrollWidth <= innerWidth`.
- Regression gate: `scripts/verify/explorer-i18n-check.mjs` now verifies nine markup attribute families across all five locales. `make static-check` executes it, so incomplete HTML-bound translations fail before a source candidate can be advanced.
- Scope: this is a local presentation and localization proof only. It does not turn unavailable public services, downloads, historical data, or ecosystem products into live services.

## 2026-08-31 route-link integrity gate

- `scripts/verify/explorer-link-integrity-check.mjs` now verifies every initial-document `href` and `data-route`: all nine required routes are present, same-portal anchors resolve to known routes, only packaged `/assets/` paths are used locally, and no blank, second-tab, local-host, placeholder, or unverified external target is admitted.
- The gate deliberately evaluates the initial document separately from the controlled runtime route builder, so a legitimate in-page dynamic link does not hide a malformed static navigation target or create a false positive.
- `make static-check` runs this gate with the locale, Go vet, shell syntax, and MJS syntax checks. This is source-level link integrity evidence; it does not assert a public URL or enable any unavailable external product.

## 2026-08-31 live-runtime recheck

- Runtime: local Chrome opened `http://127.0.0.1:6437/#home` with the portal connected to the local 6423 node and indexer. The verified snapshot returned chain ID `6423`, EVM `0x1917`, native token `YNXT`, an advancing RPC height, and indexed transaction data. Wallet-visible RPC and Explorer URL arrays remained empty because no verified public HTTPS endpoint was supplied.
- Desktop: 1780 x 943 viewport showed six live metrics, four finalized-block cards, the search/control hierarchy, and no document-width overflow.
- Tablet: 1024 x 900 viewport had `scrollWidth == clientWidth` (1009 px), visible search and wallet controls, and no clipped primary navigation.
- Mobile: 390 x 844 viewport had `scrollWidth == clientWidth` (375 px), a 351 px search input, a visible wallet button, and horizontally scrollable navigation rather than hidden primary controls.
- Interactions: the Blockchain route opened its two verified record tables and controls in the same tab; searching `YNXT` opened `#blockchain?detail=token%3AYNXT` in the in-page drawer; no `about:blank` link was present. Selecting Japanese persisted after reload (`document.documentElement.lang = "ja"`) and localized Home and the wallet button.
- Console: Chrome captured zero error-level console messages after navigation, search, locale change, and reload.
- Brand asset: `/assets/ynx-logo.png` returned SHA-256 `38196080c2d56746fb37094abe68d1d89eabd8a2b29ab4f17bae48ac7e3effde`, matching the official source required by the objective. The Explorer unit test now gates this exact asset identity.

These checks validate the local 6423 runtime only. They do not assert public deployment, a public wallet RPC, a signed download, or a live external ecosystem product.

## 2026-08-31 cold-start evidence

- The previously inherited local Indexer endpoint became unavailable; the portal returned its normal 502 fail-closed response rather than retaining a stale “live” status.
- A new temporary index database was built from the active local 6423 node, then a fresh Indexer and Explorer were started against it. The first health snapshot returned `6423`, `0x1917`, YNXT, `ok: true`, and equal RPC/indexed heights (`4805`).
- A second health snapshot three seconds later returned `ok: true` with both heights advanced together (`4806`). This is a local cold-start and second-read check only; it is not public uptime evidence.

## 2026-08-31 responsive and locale follow-up

- Live local health recheck: the Explorer reported `ok: true`, chain `6423`, EVM `0x1917`, native asset `YNXT`, one-block index lag, and no wallet-visible public RPC or Explorer URL. The latter remains deliberately empty without verified public HTTPS endpoints.
- Type and containment: at 1780 x 943, 1024 x 900, 620 x 950, and 390 x 844 CSS px, the document had no horizontal overflow. Computed body text scaled from 16 px on desktop to 14 px on mobile; route headings remained between 26 px and 32 px, preserving a clear hierarchy without oversized mobile copy.
- Mobile controls: at 390 px, the search field was 351 px by 52 px, language selection and Connect Wallet were visible, and no primary control was clipped. The horizontally scrollable primary route strip keeps `More` sticky on the right (measured from x=319 to x=363), while its remaining routes remain reachable by horizontal scrolling and keyboard focus.
- Functional path: a real browser fill-and-Enter search for `YNXT` opened the in-page token drawer at `#blockchain?detail=token%3AYNXT`; it neither opened a second tab nor produced `about:blank` and did not add page-width overflow.
- Locale and safe status copy: the Chinese Developers service directory now localizes its service schema, health/cache labels, expected wallet identity, and degraded text. Any raw runtime error is replaced with the localized unavailable state so transport details are not surfaced in the public UI.

## 2026-08-31 route and runtime-i18n follow-up

- Direct navigation: browser verification opened all nine hash routes (`home`, `blockchain`, `tokens`, `data`, `governance`, `ecosystem`, `developers`, `downloads`, and `documentation`) in the same tab. Every non-home route rendered its route view and heading; none navigated to `about:blank`.
- History: navigating `Tokens → Developers → Back` restored `#tokens` and its route view. Forward followed by a reload preserved `#developers` and its route view.
- Dynamic Chinese UI: on the verified Blockchain route, both record tables loaded. Pagination now read `已显示 1–10 / 共 5,382 条已验证索引记录` and `已显示 1–10 / 共 71 条已验证索引记录`; transaction badges rendered `转账` and `水龙头`. The prior English pagination fragment and raw `rpc-and-indexer-backed` upstream value were absent from the user-visible route.
- Scope: this proves local browser routing and localized rendering against the current 6423 node/indexer only. It does not establish a public deployment, external product availability, or a public wallet endpoint.

## 2026-08-31 localized detail-drawer follow-up

- Detail data boundary: the public drawer now uses explicit field sets for block, transaction, account, and YNXT token records instead of recursively flattening an arbitrary API object. This keeps record values available while avoiding backend object keys and unrelated nested metadata.
- Chinese browser evidence: a verified transaction detail showed localized `数量`、`费用`、`区块高度`、`时间戳` and `批次流转`; the type rendered as `转账`. It did not expose `blockHash`, `resourceConsumed`, or `lotFlows` as interface labels.
- Account evidence: the drawer showed native and EVM-compatible address fields, balances, stake, nonce, resource-use counters, and bounded lot/trace counts. It did not expose `addressFormats` or `resourceUsage` object keys.
- Token evidence: YNXT displayed localized native-asset type, localized use cases, and `已验证 RPC 原生资产状态`. Block detail displayed height, hashes, time, validator, and real transaction count. All four drawers were visible in the same local portal tab.

## 2026-08-31 localized search follow-up

- Search suggestions now use the shared locale layer for type labels, generated descriptions, current-index fallback, timeout, and unavailable-time states. Suggestions still derive only from the current verified dashboard snapshot and validated 6423 query forms.
- Browser evidence: Chinese input `6423` rendered `搜索区块高度 #6423 / 区块`; Japanese `0x1917` rendered the localized transaction-or-EVM-address suggestion; Korean `YNXT` rendered `YNXT 네이티브 토큰 / 토큰`.
- Failure evidence: submitting an unmatched query with the real search button left the page in the same tab, opened the existing detail surface, and displayed `搜索结果 / 未找到 / 未找到匹配的已验证 6423 记录。`. No `about:blank` page or upstream error text was displayed.

## 2026-08-31 responsive keyboard follow-up

- Readability and containment: the final presentation layer keeps body copy under browser zoom control (`text-size-adjust: 100%`) and uses bounded `clamp()` scales for network metrics, headings, search controls, and mobile supporting text. The local portal had `scrollWidth == clientWidth` on the Home and Blockchain views during this recheck.
- Keyboard: the portal now provides a localized Skip to content link whose target follows the active Home or routed primary view. Detail drawers capture focus on their close control, retain Tab/Shift+Tab inside the modal, close with Escape, and return focus to the activating control when it remains in the document.
- Browser evidence: a local search for `YNXT` opened the same-tab detail drawer with `detailClose` as the active element; Escape closed it with no page-width overflow. From the search input, ArrowDown placed keyboard focus on the visible `YNXT` suggestion button (`data-suggestion="YNXT"`), again without overflow.
- Regression gate: the Explorer unit test now requires the localized skip link, keyboard focus layer, drawer focus-restoration implementation, and Tab containment branch.

This is local responsive and accessibility evidence against the 6423 node/indexer. It does not claim public deployment or enable unavailable product/download actions.

## 2026-08-31 validator and account-detail follow-up

- Blockchain now loads its validator table from the verified local `/api/validators` response instead of treating all validator information as a Home-only summary. A validator name opens the existing in-page validator detail flow; current status, voting power, observed height, and last-seen time remain sourced from the live response.
- Browser evidence: the localized Blockchain view displayed `ynx-local-validator-0`, status `就绪`, voting power `1`, and observed height `6,143` with no document-width overflow. Activating the row opened `#blockchain?detail=validator%3Aynx_validator_0` in the same drawer.
- Node directory remains an explicit unavailable state because no independently authenticated node directory endpoint exists. This avoids inventing nodes from the validator response.
- Account evidence: Home account addresses are now keyboard-focusable buttons rather than inert text. A local account row opened `#blockchain?detail=account%3Aynx_faucet` in the same detail drawer with no horizontal overflow.

## 2026-08-31 Explorer integration gate

- `make explorer-check` passed against the active local 6423 node. The check built a fresh isolated index database, verified the 6423/`0x1917`/YNXT summary contract, exercised block, transaction, account, resource, token, validator, fee, and search endpoints, then checked the application shell and metrics.
- The gate can now take explicit local test ports (`YNX_EXPLORER_CHECK_INDEXER_ADDR` and `YNX_EXPLORER_CHECK_HTTP_ADDR`) so it does not collide with an already-running local portal. This run used `127.0.0.1:6439` and `127.0.0.1:6440`; no public endpoint was involved.

## 2026-08-31 download fail-closed follow-up

- Home download cards now use real disabled controls when a public artifact has not been verified; they no longer provide an enabled button that merely opens a notice. The disabled control exposes the localized artifact-verification reason as its title.
- Browser evidence: Chinese Home showed three disabled `下载暂不可用` controls with `aria-disabled="true"` and the public-artifact verification explanation. The full Downloads route rendered nine items, zero enabled download buttons, and no horizontal overflow.

## 2026-08-31 ecosystem disabled-action follow-up

- Every unavailable ecosystem Open, Docs, and Download control now carries the localized no-public-link explanation directly on its disabled control. The separate Status control remains operable and opens the same evidence-gated explanation.
- Browser evidence: the Ecosystem route exposed ten Status controls and thirty disabled product-action controls; none of the disabled actions lacked a reason title and the route had no horizontal overflow.

## 2026-08-31 local runtime recovery check

- A final local health probe returned 502 after its local 6423 node had exited. Explorer preserved its fail-closed behavior and did not render the prior snapshot as current data.
- A fresh temporary local 6423 node and indexer were then started on the existing preview ports. Explorer health recovered with `ok: true`, chain `6423`, EVM `0x1917`, native `YNXT`, and equal RPC/indexed height `8`. This recovery is local evidence only and makes no availability claim for a public endpoint.

## 2026-08-31 dynamic locale and privacy follow-up

- Source visual truth: the supplied TronScan reference image at `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/codex-clipboard-7f8db32a-ff49-4c6b-b7cb-1344ec71a17c.png`, used only for its spacious information hierarchy and compact control rhythm; no TRON branding, data, or visual assets were carried over.
- Implementation evidence: refreshed in-app-browser captures of local `http://127.0.0.1:6437/?qa=localized-3#home` and `#data` at 1280 CSS px wide (browser capture is ephemeral, so no persistent file path is available). The focused comparison covered the live-list/filter region and the chart-range controls, which are the only regions changed in this iteration.
- Typography and copy: all five locales rendered the dynamic validator state and the transaction filter’s first option as `Ready / 就绪 / 就緒 / 準備完了 / 준비됨` and `All / 全部 / 全部 / すべて / 전체`. The data-range controls rendered `24 小时、7 天、30 天、全部` in Chinese. The reference’s compact control sizing and clear list-to-panel hierarchy remain intact.
- Layout and color: refreshed Home and Data checks at 1280 px had `scrollWidth` 1265 px for a 1280 px viewport (no horizontal overflow). The existing blue-and-white YNX token system, bordered panels, and official YNX asset remain unchanged.
- Dynamic safety: Home now derives validator presentation only from the verified ready/not-ready boolean, never a raw upstream status enum. Live resource labels use localized resource names. Wallet interaction failures retain the existing localized safe notices and do not display provider error text.
- Interaction: changing locale re-renders the visible controls; range selection remains operable and reports the localized fail-closed history state. The response makes no claim for unavailable history, public RPC, public deployment, product links, or downloads.

**Findings**

- No actionable P0/P1/P2 differences were introduced by the localized-state pass. The only comparison gap is that the reference contains market and historical charts whose inputs are not verified for 6423; the existing explicit unavailable state remains intentional and fail closed.

**Implementation checklist**

1. Keep the dynamic locale/privacy regression test with the Explorer test suite.
2. Re-run visual comparison when a verified 6423 historical-series endpoint becomes available.

**Final result:** passed

## 2026-08-31 local resource-snapshot follow-up

- The Data route now keeps its RPC/indexer summary separate from a new Resource market snapshot. The latter reads the current `/api/resource-market/analytics` counters (delegated YNXT, rental volume, provider income, and protocol fees) rather than inventing a history series.
- Truth boundary: the current resource endpoint reports `truthfulStatus: local-devnet`. The portal therefore labels the panel in every supported locale as local-runtime-only and explicitly not public proof; it does not blend these counters into the general live-source card or imply a released market.
- Browser evidence: after selecting the 100-block Activity control, the in-app browser showed exactly 100 interactive verified-block bars and its caption reported the actual 0-transaction count. At 390 x 844 CSS px and at the irregular 960 x 500 viewport, `scrollWidth` did not exceed `clientWidth`; Data panels became one column at mobile size and remained readable.
- Chinese locale evidence: the route heading rendered `数据`, all four block-window controls rendered `24 / 48 / 72 / 100 个区块` and remained enabled, the resource boundary rendered `仅本地运行时——不构成公开证明`, and no raw `local-devnet` backend state was exposed to the visible UI.

## 2026-08-31 Blockchain direct-route data follow-up

- Direct opening of `#blockchain` previously loaded the independently paginated tables but left Network status in its pre-snapshot unavailable state. The route now re-renders after the verified dashboard snapshot arrives, matching the existing Tokens, Data, and Developers behavior.
- The verified Network status panel now contains the canonical 6423 identifiers plus measured current-window TPS, observed block time, indexed-block lag, last verification time, and RPC/indexer source state. These are current-window calculations and are not presented as a public historical series.
- Browser evidence: a fresh direct Chinese route opened with `0.00` TPS, `2.0s` observed block time, zero index lag at block `1,928`, a localized timestamp, and `RPC 与索引器已验证`; the earlier snapshot-unavailable message was absent. At 390 x 844 CSS px, the 351 px network panel and all three responsive table shells remained visible without document-width overflow; both Copy route controls remained visible. Console errors remained zero.

## 2026-08-31 local developer API reference follow-up

- Documentation now covers every currently served local Explorer read surface: summary, blocks, transactions, account list/detail, native token, validators, account resources, resource-market analytics, transaction fees, search, and the SSE stream. This improves the developer path without claiming an unverified public HTTPS API.
- Browser evidence: the Chinese Documentation view rendered all 12 endpoint rows, including `/api/resource-market/analytics`, `/api/resources/{address}`, `/api/fees/{hash}`, and `/api/stream (SSE)`. It retained the explicit statement that the endpoints are not public RPC endpoints; console errors were zero.
- At 390 x 844 CSS px, the API table remained 315 px wide inside its scroll-safe shell with 12 visible rows and no document-width overflow.
