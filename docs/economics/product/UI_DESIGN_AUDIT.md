# YNXT Economics UI Design Audit

## Scope and status

Routes `/ynxt` and `/economics` are implemented inside the existing Explorer server and tested locally. They are not centrally integrated, deployed to staging, deployed publicly, or indexed by search engines. The Website owner remains responsible for final SSR/SSG, domain routing, sitemap and search-console submission.

## Information architecture

The first viewport leads with the product distinction that matters most: current chain rules versus candidate models. Current fixed-fee behavior appears before model outputs. Candidate fee markets, liquid staking, security pools, YUSD and stress simulations share a consistent “model/sandbox only” status and cannot be confused with active chain state.

Reference stress results show Low/Medium/High scenarios in one comparison table. They expose gate pass rate, net supply, validator economics, Treasury runway and stable reserve ratio without KPI-card overload. Live Explorer context is visually and technically separate from source-defined candidate disclosures and fails visibly when RPC/indexer data is unavailable.

## Visual system

- Klein Blue `#002FA7` is reserved for identity, focus and navigation emphasis; white and neutral black/gray carry most surfaces.
- Cards use restrained borders and whitespace rather than colored tiles.
- Typography, hierarchy and layouts are original YNX assets and do not imitate another product.
- Light, dark and system themes use semantic tokens. The bespoke social card repeats the exact testnet/model boundary and contains no price, APY or invented metric.

## Responsive and interaction audit

- The layout has explicit 850px and 520px breakpoints and a 320px minimum viewport. At 390px, grids become a single column and the wide scenario table scrolls within its own bounded container rather than overflowing the page.
- All controls are native links, buttons or selects with visible keyboard focus.
- Navigation exposes the active page through `aria-current`.
- Dynamic network status uses `role=status` and `aria-live=polite`.
- The page does not rely on hover, animation, pointer-only actions or color alone.
- `prefers-reduced-motion` disables animation and smooth scrolling.

## Localization and accessibility

English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia are available from a labelled language selector. Locales cover headings, current/candidate status, dynamic loading/unavailable state, dates, values and risk/legal meaning. Arabic switches the root document to `dir=rtl`; logical CSS properties preserve layout.

Number, percentage and date formatting use `Intl` with the selected locale. Text remains selectable and zoomable. The implementation uses semantic headings, sections, table headers, labels, status regions and native controls. Automated source checks cover all locale options, RTL, focus, reduced motion, mobile breakpoint, source API loading and risk language. No assistive-technology device lab or public-browser audit is claimed.

## Truth and failure states

The economics disclosure API returns `source`, `asOf`, `version`, `coverage`, `confidence` and `failure`. Current burn, dynamic issuance, reward, slashing and Treasury execution booleans remain false. Candidate and release booleans are explicit. Reference macro results are recalculated from the seeded source model rather than copied into the page. Explorer network failure is rendered as unavailable and never replaced by a static success state.

## Remaining external evidence

Public screenshots, browser/device matrices, screen-reader transcripts, Lighthouse/axe results, staging/public URLs, search indexing, real-user performance and public monitor evidence are absent. Their corresponding release states remain false.
