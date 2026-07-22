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
form controls, visible focus states and reduced-motion handling. Skip navigation
now has a valid target in authentication, loading, error and signed-in states;
language changes retain keyboard focus; active navigation exposes
`aria-current`; Arabic selects RTL and reverses physical sidebar/table alignment.
Twelve locale catalogs contain complete nonblank keys for the localized surface.

The 2026-07-22 in-app Chromium check loaded the current production bundle over
local HTTP at 1280x720 and 390x844. It directly observed one main landmark and
H1, a valid skip target, no horizontal page overflow, Arabic `lang=ar`/`dir=rtl`,
localized Arabic sign-in/privacy/skip text, 46px form controls, and retained
focus with a 3px visible outline after changing locale. This is a focused browser
structure/responsive check, not a WCAG conformance claim.

## Evidence status

The existing `proof/` screenshots predate the canonical Wallet migration and
are retained only as prior visual references. The current focused browser check
does not cover an authenticated operator session because no real Gateway session
was supplied. Authenticated business views still contain English operational
copy outside the localized catalog. Full 12-language translation, desktop
1440x900 light/dark screenshots, 200% zoom/large text, keyboard traversal,
screen-reader testing, automated accessibility rules, and authenticated
loading/empty/failure/success acceptance remain open and are not marked complete.
