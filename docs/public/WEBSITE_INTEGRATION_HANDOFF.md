# YNX Chain Website Integration Handoff

Version: 1.0.0-candidate  
Last reviewed: 2026-07-22  
Source commit: `719e1018267ed5a53e6fae5211c5fd8a1503c35c`

## Canonical identity

Use `release/public-product-metadata.json` as the machine-readable identity source and `docs/public/PUBLIC_BRAND_FACTS.md` for editorial facts. The canonical product route is `https://ynxweb4.com/ynx-chain`. Preserve the five neutral disambiguation statements verbatim in substance. Do not call YNXT a Mainnet asset or imply affiliation with unrelated Lynx-branded products.

## Content routes

| Suggested route | Source |
|---|---|
| `/ynx-chain` | `search/WHAT_IS_YNX_CHAIN.md` |
| `/ynx-web4` | `search/WHAT_IS_YNX_WEB4.md` |
| `/ynxt` | `search/WHAT_IS_YNXT.md` |
| `/testnet` | `search/YNX_TESTNET_GUIDE.md` |
| `/wallet`, `/developer`, `/exchange`, `/dex`, `/quant` | corresponding search page |
| `/security`, `/trust`, `/economics`, `/products` | corresponding search page |
| `/faq` | `FAQ.md` |

Render one canonical URL, unique title, meta description and H1 per page. Preserve direct-answer paragraphs, update dates, source commit and evidence links. Avoid creating near-duplicate locale or keyword pages. The Website owner controls final SSR/SSG, canonical tags, hreflang, robots, sitemap, Search Console, Bing and IndexNow submission.

## Status and claims

Read release state from `release/product-release.json`; never infer a later state from prose. All nine booleans are currently false. A local implementation, test, package, simulator or operator-observed endpoint cannot become a public, signed, downloadable or store claim without its direct evidence.

Use `MARKETING_CLAIMS_EVIDENCE_MATRIX.md` as a publishing gate. If a claim's evidence expires or conflicts, remove the claim or render the documented unavailable/candidate state. Do not substitute fake metrics, balances, transactions, prices, APY, liquidity, users, revenue or provider health.

## Structured data

`release/structured-data-suggestions.json` contains suggestions, not a production payload. The Website must emit only types and properties visibly supported on the rendered page. Do not add ratings, reviews, offers, price, downloads, operating systems, organization contacts, social accounts, awards, partners, founders, launch dates or availability unless separately evidenced.

## Brand assets

Current source logo: PNG, 798×420 RGBA, 104,171 bytes, SHA-256 `df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d`. Rights review and reviewed light/dark/icon exports remain pending. Until then, do not imply that generated variants are approved.

## UX and accessibility acceptance

Before publication verify keyboard traversal, visible focus, landmarks/headings, accessible names, error associations, contrast, zoom/dynamic text, Reduced Motion, light/dark, 390px layout, and Arabic RTL. Test loading, empty, unavailable, stale, permission, expiry and recovery states with real API behavior. Public UI must not show internal hostnames, paths, stack traces, credentials, build-system names or source-control metadata.

## URLs and screenshots

Support, privacy, security and status URLs remain unset in metadata and must render as unavailable—not guessed routes. Downloads remain empty. Screenshots are not approved because the exact documentation candidate has not been integrated and re-captured. Use no screenshot until its source release, route, viewport, state, rights, hash and privacy review are recorded.

## Integration acceptance evidence

Return: Website source commit; production deployment identity; route-to-source manifest; rendered HTML for metadata/JSON-LD; sitemap and hreflang results; desktop and 390px screenshots; accessibility report; link scan; public URL responses; asset hashes; and a statement that no release boolean was changed without direct proof.
