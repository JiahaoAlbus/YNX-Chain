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
