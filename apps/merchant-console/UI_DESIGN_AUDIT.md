# Merchant Console UI design audit

## Information architecture and tokens

The desktop layout uses a merchant operations sidebar, compact KPI strip,
record tables and a contextual inspector. Navigation is filtered by owner,
finance, developer, support and viewer permissions. Invoices, transactions,
webhook operations, reconciliation, cases, security and audit remain separate
work areas; browser secrets are absent. The interface uses Klein blue, neutral
tables and status accents rather than a card wall.

## Responsive, accessibility and RTL

The CSS has desktop and 390px breakpoints, collapses navigation on mobile,
maintains table overflow inside its region, uses semantic navigation/main/table/
form controls, visible focus states and reduced-motion handling. Twelve locale
catalogs are complete and Arabic selects RTL. Automated locale/authority and
record-boundary tests pass.

## Evidence status

The existing `proof/` screenshots predate the canonical Wallet migration and
are retained only as prior visual references. The current production bundle was
built and its tests pass, but the browser runtime rejected the local `file://`
page under its URL policy and no staging URL exists. Consequently current
desktop 1440x900 light/dark, mobile 390x844, Arabic RTL, large-text and
loading/empty/failure/success visual acceptance remains open and is not marked
complete.
