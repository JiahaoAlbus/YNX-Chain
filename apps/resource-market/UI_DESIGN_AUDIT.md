# YNX Resource Market UI design audit

Audited on 2026-07-19 against the running Web product, not a static mock.

## Information architecture

Resource Market is an execution console, deliberately distinct from Trust Center. The primary flow is Quote Composer → exact signed intent → authority acceptance → capacity evidence → settlement proof. Capacity, delegation/rental, and settlement/income views use dense metrics, position rows, and a chronological proof rail rather than a dashboard card wall.

Desktop uses horizontal product navigation and a centered two-column quote/intent workspace. Mobile uses a compact header, single-column navigation stack, and bottom navigation. The shell stays LTR-first; Arabic localizes text direction without reversing quote-stage chronology or market structure.

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

Core states exercised in automation: loading, empty, pending-capacity success, quote unavailable, provider unavailable, exact retry, and no-substitute wording. Server-backed status rendering also covers authority rejection, replay conflict, tamper failure, recovery, expiry, partial completion, audit, and settlement evidence.

## Fixed issues and limits

Fixed: generic left-heavy dashboard composition, oversized modules, always-expanded language choices, whole-shell Arabic reversal, weak quote-versus-settlement distinction, and mobile header overflow.

Remaining external limitation: no authoritative central Gateway or settlement service is deployed for this branch; therefore the UI never upgrades a quote or local draft to settled.
