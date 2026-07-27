# YNX Chain Website Integration Handoff

| Metadata | Value |
| --- | --- |
| Version | 1.1.1-candidate |
| Effective date | 2026-07-27 |
| Source commit | `be7c9aabdff51ee29e373baf3342d4837735b9cc` |
| Product release | 0.2.0-candidate |
| Last reviewed | 2026-07-27 |
| Superseded version | 1.1.0-candidate |
| Review status | Website integration handoff; the be7c9aa package is locally verified but not yet Website-accepted or hosted |

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
- `deployedStaging=true`
- `deployedPublic=true`
- `downloadHosted=true`
- `productionSigned=false`
- `storeReleased=false`

The provider records a successful, SSO-protected Preview deployment for the accepted
Website source. This proves staging deployment, not anonymous public availability or
independent proof. The hosted documentation ZIP remains an unsigned public candidate
and must not be described as production signed, independently audited, Mainnet-ready
or store released.

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

## Next website-content candidate

Source `be7c9aabdff51ee29e373baf3342d4837735b9cc` adds a machine-readable
high-authority document metadata inventory and includes the normalized technical
whitepaper, YNXT tokenomics, security/privacy/AI governance, Terms draft and Brand
Guide in the deterministic website-content package. The locally verified archive is
`ynx-website-content-be7c9aabdff5.zip`, 190,008 bytes, SHA-256
`afd3aca6e91f03199821c033e5294cce18eb6f22aa0307450e2c7b2d2540b5aa`.

This candidate is not yet Website-accepted, publicly hosted or production signed.
The currently hosted archive and release booleans remain governed by
`release/product-release.json` and the prior Website acceptance evidence until YNX 28
returns exact source, deployment and artifact proof for this candidate.

## Integration acceptance evidence

Current Website acceptance and direct public observations are recorded in
`release/evidence/website-public-acceptance-2026-07-26.json`. Future changes must
return the Website source identity, deployment identity, route-to-source manifest,
rendered metadata/JSON-LD, discovery results, accessibility and link checks, public URL
responses and artifact hashes. No release boolean may change without direct proof.

## Change log

- 1.1.1-candidate (2026-07-27): Normalized the complete metadata tuple and recorded
  the locally verified `be7c9aa` content candidate without promoting Website
  acceptance, hosted-download or signing states.
- 1.1.0-candidate (2026-07-27): Recorded current Website routes, public release
  states, hosted unsigned artifact and integration acceptance boundaries.
