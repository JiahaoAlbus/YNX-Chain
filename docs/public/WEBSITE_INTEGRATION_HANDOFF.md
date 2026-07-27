# YNX Chain Website Integration Handoff

Version: 1.1.0-candidate
Last reviewed: 2026-07-27
Source commit: `ab209455dc1e0e537da2872505ed0bb2b2256609`

## Canonical identity

Use `release/public-product-metadata.json` as the machine-readable identity source and `docs/public/PUBLIC_BRAND_FACTS.md` for editorial facts. The canonical product route is `https://ynxweb4.com/what-is-ynx-chain`. Preserve the five neutral disambiguation statements verbatim in substance. Do not call YNXT a Mainnet asset or imply affiliation with unrelated Lynx-branded products.

## Content routes

| Suggested route | Source |
|---|---|
| `/what-is-ynx-chain` | `search/WHAT_IS_YNX_CHAIN.md` |
| `/what-is-ynx-web4` | `search/WHAT_IS_YNX_WEB4.md` |
| `/what-is-ynxt` | `search/WHAT_IS_YNXT.md` |
| `/testnet` | `search/YNX_TESTNET_GUIDE.md` |
| `/wallet`, `/developer`, `/exchange`, `/dex`, `/quant` | corresponding search page |
| `/security`, `/trust`, `/economics`, `/products` | corresponding search page |
| `/faq` | `FAQ.md` |

The Website currently prerenders the authority routes with canonical tags and JSON-LD,
publishes robots and sitemap discovery files, and submitted the canonical URL set
through IndexNow. Search Console and Bing owner-console verification remain external
provider tasks. Preserve one canonical URL, unique title, meta description and H1 per
page; do not create near-duplicate locale or keyword pages.

## Status and claims

Read release state from `release/product-release.json`; never infer a later state from
prose. The current evidence-bound states are:

- `implementedLocal=true`
- `testedLocal=true`
- `installedLocal=false`
- `integratedCentral=true`
- `deployedStaging=false`
- `deployedPublic=true`
- `downloadHosted=true`
- `productionSigned=false`
- `storeReleased=false`

The hosted documentation ZIP is an unsigned public candidate. It must not be described
as production signed, independently audited, Mainnet-ready or store released.

Use `MARKETING_CLAIMS_EVIDENCE_MATRIX.md` as a publishing gate. If a claim's evidence expires or conflicts, remove the claim or render the documented unavailable/candidate state. Do not substitute fake metrics, balances, transactions, prices, APY, liquidity, users, revenue or provider health.

## Structured data

`release/structured-data-suggestions.json` contains suggestions, not a production payload. The Website must emit only types and properties visibly supported on the rendered page. Do not add ratings, reviews, offers, price, downloads, operating systems, organization contacts, social accounts, awards, partners, founders, launch dates or availability unless separately evidenced.

## Brand assets

Current source logo: PNG, 798×420 RGBA, 104,171 bytes, SHA-256 `df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d`. Rights review and reviewed light/dark/icon exports remain pending. Until then, do not imply that generated variants are approved.

## UX and accessibility acceptance

Before publication verify keyboard traversal, visible focus, landmarks/headings, accessible names, error associations, contrast, zoom/dynamic text, Reduced Motion, light/dark, 390px layout, and Arabic RTL. Test loading, empty, unavailable, stale, permission, expiry and recovery states with real API behavior. Public UI must not show internal hostnames, paths, stack traces, credentials, build-system names or source-control metadata.

## URLs and screenshots

The approved public routes are `/support`, `/privacy`, `/security` and `/status`.
The documentation download entry resolves through
`/docs-authority/artifact-manifest.json`, whose content-addressed archive records exact
bytes, SHA-256, hosted-download state and unsigned status. Screenshots remain
unapproved until their source release, route, viewport, state, rights, hash and privacy
review are recorded.

## Integration acceptance evidence

Current Website acceptance and direct public observations are recorded in
`release/evidence/website-public-acceptance-2026-07-26.json`. Future changes must
return the Website source identity, deployment identity, route-to-source manifest,
rendered metadata/JSON-LD, discovery results, accessibility and link checks, public URL
responses and artifact hashes. No release boolean may change without direct proof.
