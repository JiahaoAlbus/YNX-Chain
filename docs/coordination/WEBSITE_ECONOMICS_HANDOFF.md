# Website Handoff: YNXT and Economics

## Canonical routes

- `/ynxt` — YNXT current-policy truth, candidate boundaries and risks.
- `/economics` — reproducible candidate mechanisms and Low/Medium/High stress evidence.
- `/api/economics/disclosure` — source-labelled machine-readable policy, release and reference-scenario disclosure.
- `/assets/economics-og.png` — dedicated social card stating that models are not chain state.

The Explorer implementation is a locally tested integration candidate. The Website owner should preserve the route names, H1 intent, metadata, risk language, release booleans and API provenance when producing final SSR/SSG pages. No redirect, domain, public ingress or deployment is authorized by this handoff.

## SEO content contract

| Route | Title | H1 | Description |
| --- | --- | --- | --- |
| `/ynxt` | YNXT Economics \| YNX Chain | YNXT economics, with every boundary visible. | Transparent YNXT testnet economics, candidate policies, stress evidence, and activation boundaries. |
| `/economics` | Economic Models \| YNX Chain | Model the policy before governing it. | Reproducible YNXT fee, issuance, staking, Treasury, stable settlement, and risk simulations. |

Suggested structured data is a `WebPage` for each route plus an `FAQPage` only if the final Website renders the corresponding visible questions and answers. Do not publish Product offers, token prices, ratings, returns, APY, reserve claims or Mainnet availability.

## Required visible FAQ meaning

1. **Is dynamic issuance active?** No. It is a bounded candidate simulation; current consensus does not execute it.
2. **Does YNX burn current base fees?** No. Current fixed-fee events record zero burn; per-lane burn is a candidate.
3. **Does staking guarantee APY?** No. The reward source is inactive and no APY is guaranteed.
4. **Is YUSD redeemable for real value?** No. It is an isolated test-unit sandbox without external reserve attestation or a real redemption rail.
5. **Are the stress results forecasts?** No. They are deterministic distributions generated from public assumptions.

## Integration acceptance

The final Website integration must retain all 12 locales, Arabic RTL, keyboard focus, reduced motion, light/dark themes, 390px containment, translated runtime failure and risk semantics, canonical URLs, absolute Open Graph metadata, source/as-of/version/coverage labels and all false release fields. It must fetch or server-render the disclosure response without converting unavailable data into success.

Final Website work must add its own source commit, deployed URL, screenshot hashes, SSR/SSG evidence, sitemap/JSON-LD validation, Search Console/Bing/IndexNow evidence and public monitor results before any public/deployed boolean changes.
