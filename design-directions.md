# YNX 6423 portal visual-direction record

## Scope and source boundary

This record explores exactly three original desktop directions for the local YNX
6423 portal. The user-supplied TronScan capture is used only for its
information architecture lessons: a stable navigation band, a broad search
surface, a dense-but-readable network overview, and a clear progression from
summary to blocks and transactions. No TronScan mark, wording, iconography,
red palette, market number, or visual asset is used.

Every direction keeps the official YNX logo, the blue-and-white brand system,
and the only valid network identity: `ynx_6423-1`, `6423`, `0x1917`, and
`YNXT`. Unverified market, history, product, and download information remains
explicitly unavailable in all three directions.

The Product Design image-generation surface was unavailable while this record
was prepared (a remote 403 response). The directions are therefore captured
as implementation-ready specifications rather than pretending that generated
mockups exist. The chosen direction is rendered and browser-verified in the
local portal.

## Direction A — Signal Ledger

- **Hierarchy:** compact navigation and announcement strip; broad search and
  live network state; a two-column summary with six facts and a focused YNXT
  identity panel; a four-item block rail; then transaction and validator
  activity.
- **Visual language:** Klein blue `#002FA7`, white surfaces, restrained cool
  grays, 6–8 px radii, hairline dividers, strong tabular numerals, and no
  decorative hero imagery. The available/unavailable distinction uses text,
  contrast, and status treatment rather than a borrowed red signal.
- **Interaction model:** route-first same-tab exploration, search-to-drawer,
  visible disabled reasons for missing evidence, and hover/focus navigation
  groupings. A quiet network still feels useful because real finality, slot,
  validator, and index data fill the relevant layers.
- **Responsive behavior:** preserve every primary destination in a scrollable
  route strip; stack summary and side context before shrinking type; retain
  readable 14–16 px body text and 22–32 px route headings.

## Direction B — Network Briefing

- **Hierarchy:** a calmer editorial start with a large network-health briefing,
  a compact operational timeline, and progressive disclosure into explorer
  records. It gives first-time developers more explanatory framing before
  presenting dense tables.
- **Visual language:** the same blue-and-white brand, but larger headline
  type, longer explanatory copy, softer tinted section bands, and fewer
  visible facts above the fold.
- **Interaction model:** an assistant-like guided path from Chain setup to
  recent blocks, with contextual documentation prompts. Missing public
  evidence is still disabled and explained.
- **Responsive behavior:** naturally stacks well, but requires more scrolling
  before a returning user reaches live records or search results.

## Direction C — Protocol Atlas

- **Hierarchy:** a utility-first operations cockpit with a persistent
  status/identity column, a central searchable records grid, and contextual
  drawers for validator, account, token, and block detail.
- **Visual language:** more separators, denser tabular controls, a stronger
  mono treatment for chain facts, and reduced editorial copy. It makes the
  portal feel closest to an engineer console while retaining the YNX palette.
- **Interaction model:** filter-heavy page state with direct keyboard travel
  between data surfaces. All unavailable capabilities retain explicit evidence
  states instead of simulated controls.
- **Responsive behavior:** needs more horizontal adaptation and progressive
  columns at tablet widths, increasing implementation and maintenance cost.

## Selection

| Criterion | Signal Ledger | Network Briefing | Protocol Atlas |
| --- | ---: | ---: | ---: |
| Information-density balance | 5 | 3 | 4 |
| Readability for developer and holder flows | 5 | 4 | 3 |
| Original YNX brand fit | 5 | 4 | 4 |
| Responsive implementation cost | 5 | 4 | 2 |
| Total | **20** | 15 | 13 |

**Selected: Signal Ledger.** It best preserves the requested rich but
uncluttered portal rhythm, makes verified 6423 facts immediately legible, and
keeps unavailable services honest without leaving large, empty surfaces. The
current `internal/explorer/web.go` portal implements this direction and the
browser QA record in `design-qa.md` verifies its desktop, tablet, and mobile
behavior.
