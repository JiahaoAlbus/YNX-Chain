# YNX DEX UI design audit

## Information architecture

DEX is an independent Web/PWA, not an Exchange page. Desktop uses a product sidebar, compact toolbar, focused Swap Composer and a separate route/fee/risk inspector. Pools use a table, transactions a timeline, analytics restrained source-labelled metrics, and settings a modal. Mobile uses a navigation stack, fixed four-item bottom tab bar and overflow menu for secondary destinations.

## Tokens and behavior

- Klein Blue `#002FA7` is limited to brand, selected navigation, links/focus and enabled primary actions.
- Light canvas `#F5F5F7`, primary `#1D1D1F`, secondary `#6E6E73`; dark canvas `#000000` with `#1C1C1E` surfaces.
- System font stack only. No Apple font file, trademark, logo, proprietary artwork, gradient, neon, glass card wall or decorative animation.
- Hierarchy uses type, whitespace, hairlines and placement. Cards are limited to the actual swap input/output object and modal objects.
- Responsive breakpoints were inspected at 1440×900, 1024×768, 960 CSS px at 1.5 device scale (1440×900 large-text evidence) and 390×844. Overflow checks pass; the large-text run exposed and fixed the 901–1100 px Swap grid overflow. The mobile bottom bar is 64 px plus safe-area inset.

## States

Implemented runtime states include loading skeleton, empty, indexed fixture/live-data rendering, API failure/retry, offline shell, stale label support, Wallet unavailable/permission failure, wrong/no route, unsupported token in protocol/SDK, insufficient liquidity, price impact, deadline, approval boundary, transaction review, expired/replay/tamper rejection in integration layers, conflict/recovery in Indexer and destructive governance explanation. Pool Detail and Add/Remove tabs are present but signing remains disabled without canonical Wallet. Successful on-chain swap/LP evidence remains absent because no Testnet deployment or central integration exists.

## Accessibility and localization

- Semantic landmarks, headings, table, timeline, labelled form fields, modal roles, skip link, visible keyboard focus and ≥40 px primary controls.
- Light/dark/system, `prefers-reduced-motion`, high-contrast-friendly borders, no status encoded by color alone, and horizontal-overflow checks.
- Catalogs exist for en, zh-CN, zh-TW, ja, ko, es, fr, de, pt, ru, ar and id. Arabic applies real `dir=rtl`; core swap, safety, data-truth and navigation text was visually checked. Dates and numbers use `Intl` in data surfaces.
- Remaining: complete professional translation review for all non-English fallback strings, screen-reader run on Safari/VoiceOver and Chrome/TalkBack, and automated contrast report.

## Visual evidence and fixes

Evidence is indexed in `docs/dex/EVIDENCE_INDEX.md`. The first mobile capture lacked the required bottom-tab pattern and Arabic safety text used English fallback. Both were corrected before the committed evidence set. A reload screenshot briefly captured the sidebar mid-transition; the settled state confirmed it was fully off-canvas. New screenshots explicitly label mocked indexed fixtures so they prove UI behavior only, never Testnet liquidity or transaction success.

## Completion judgment

The surface is a working API/SDK-backed local product rather than a static shell: Swap quotes, review, Pool Detail, Add/Remove forms, Tokens/Transactions, AI risk workflow and offline PWA behavior are exercised locally. Local UI implementation/testing can be claimed; central integration and deployed success remain false until canonical Wallet and real Testnet contracts provide evidence.
