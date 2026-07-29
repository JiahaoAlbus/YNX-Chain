# YNX Chain Website Integration Handoff

| Metadata | Value |
| --- | --- |
| Version | 1.1.4-candidate |
| Effective date | 2026-07-29 |
| Source commit | `7b386fc4ea7be4d25bf9217f6242d6da17a6f6f9` |
| Product release | 0.2.0-candidate |
| Last reviewed | 2026-07-29 |
| Superseded version | 1.1.3-candidate |
| Review status | Website integration handoff and public audit; the e36832d package remains locally and CI verified but not Website-accepted or publicly hosted |

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

Source `e36832d5be0c498d8a2f27869f8d70fc112e9442` expands the machine-readable
high-authority document metadata inventory to fourteen technical, economic, security,
legal, brand and Website documents, including the bounded staking, liquid-staking and
Safety Module disclosure. The locally verified deterministic archive is
`ynx-website-content-e36832d5be0c.zip`, 277,277 bytes, SHA-256
`87b3cb20ddbe3d7e879a751c791b3fc90cb0b01face5d17fcad3c8da23d4f420`. GitHub
Actions run `30416936231` passed for the same source; artifact `8710484610` is
unexpired through 2026-08-28 and has workflow-container digest
`sha256:e9069e9b4c0d9696a23ea148698c2cbc45dcfa66a8a091a13df53b00386be300`.
The deterministic archive digest and GitHub artifact-container digest are separate
evidence values.

This candidate is not yet Website-accepted, publicly hosted or production signed.
The currently hosted archive and release booleans remain governed by
`release/product-release.json` and the prior Website acceptance evidence until YNX 28
returns exact source, deployment and artifact proof for this candidate.

## Integration acceptance evidence

Current Website acceptance is recorded in
`release/evidence/website-public-acceptance-2026-07-26.json`. A fresh operator-controlled
public audit is recorded in `release/evidence/website-public-audit-2026-07-29.json`.
The audit confirmed the authority route and immutable hosted archive, but found that
`/what-is-ynx-chain` emits two conflicting canonical links: the site root and the route
canonical. YNX 28 must emit exactly one route canonical and return source/deployment/HTML
evidence; this finding does not change any release-state boolean.

Future changes must return the Website source identity, deployment identity,
route-to-source manifest, rendered metadata/JSON-LD, discovery results, accessibility and
link checks, public URL responses and artifact hashes. No release boolean may change
without direct proof.

## Change log

- 1.1.4-candidate (2026-07-29): Recorded fresh public route and immutable archive
  evidence, plus the conflicting duplicate-canonical finding and exact YNX 28 acceptance
  criteria, without changing release-state booleans.
- 1.1.3-candidate (2026-07-29): Rebound the next Website-content candidate to the
  fourteen-document `e36832d` package, exact local archive hash and successful CI
  artifact without promoting Website acceptance, hosted-download or signing states.
- 1.1.2-candidate (2026-07-27): Rebound the next Website-content candidate to the
  thirteen-document `2d38cac` package and exact CI evidence without promoting Website
  acceptance, hosted-download or signing states.
- 1.1.1-candidate (2026-07-27): Normalized the complete metadata tuple and recorded
  the locally verified `be7c9aa` content candidate without promoting Website
  acceptance, hosted-download or signing states.
- 1.1.0-candidate (2026-07-27): Recorded current Website routes, public release
  states, hosted unsigned artifact and integration acceptance boundaries.
