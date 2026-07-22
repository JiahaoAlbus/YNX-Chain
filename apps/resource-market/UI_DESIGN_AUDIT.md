# YNX Resource Market UI design audit

Audited on 2026-07-22 against the running Web product, not a static mock.

## Information architecture

Resource Market is an execution console, deliberately distinct from Trust Center. The default view now separates Provider and Buyer workspaces. Providers register evidence, undergo independent verification and publish resource-unit offers. Buyers match providers, create a quote and accept an exact intent. The execution ledger keeps reservation, service, metering and settlement visibly separate.

Desktop uses horizontal product navigation and a centered two-column provider/buyer workspace. Mobile uses a compact header, single-column workspace, and six-destination bottom navigation. The shell stays LTR-first; Arabic localizes reviewed text direction without reversing quote-stage chronology or market structure.

## Visual system

- Neutral light/dark canvases with Klein Blue `#002FA7` only for primary actions, selection, links, and focus.
- Green is limited to authoritative/confirmed success; orange communicates pending capacity; red is reserved for failure/rejection.
- System fonts, tables/rows, capacity bars, fine dividers, and a monospaced proof terminal communicate market density without giant colored blocks.
- The 12-language selector is folded into a compact `details` popover and remains usable at 390 pixels.

## Accessibility and responsive checks

- Skip link, semantic navigation/headings, labelled inputs, live status, keyboard focus, 44-pixel touch targets, reduced motion, dark mode, and a persistent large-text control.
- 12 locales and independent AI-language persistence; Arabic critical settlement copy is RTL while `.market-shell` remains LTR.
- Current-run browser tests passed at 1440×900 and 390×844 with no horizontal overflow.

## Runtime evidence

- `docs/handoffs/evidence/ui-audit-current/resource-market-desktop.png`
- `docs/handoffs/evidence/ui-audit-current/resource-market-mobile.png`
- `docs/handoffs/evidence/ui-audit-current/resource-desktop-final-light.png`
- `docs/handoffs/evidence/ui-audit-current/resource-desktop-final-dark.png`
- `docs/handoffs/evidence/ui-audit-current/resource-mobile-390x844.jpg`

Five browser tests exercise desktop/mobile empty state, provider registration, independent verification, offer publication, matching, quote creation, exact intent acceptance, sealed-auction bidding, pending legacy capacity, honest AI failure, 12-locale static-market coverage and persistence, Arabic direction and no horizontal overflow. The accepted-intent test explicitly verifies that asset settlement remains unconfirmed.

## Fixed issues and limits

Fixed: generic left-heavy dashboard composition, oversized modules, always-expanded language choices, whole-shell Arabic reversal, weak quote-versus-settlement distinction, and mobile header overflow.

Remaining product limitations: all lifecycle and operator actions now have dedicated UI forms, but those forms do not yet have individual browser automation. The 143 canonical static market strings have catalogs in all 12 locales; interpolated runtime notices and server-originated errors are not yet comprehensively localized. No authoritative central Gateway or settlement service is deployed, so the UI never upgrades a quote or local intent to settled without evidence.
