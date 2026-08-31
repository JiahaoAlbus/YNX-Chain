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
