# YNX Trust Center UI design audit

Audited on 2026-07-19 against the running Web product, not a static mock.

## Information architecture

The primary desktop model is a due-process workbench: horizontal product navigation, a bounded request queue, and an evidence inspector. Evidence intake, independent review/appeal, AI explanation, and transparency remain separate workflows. Mobile keeps the same hierarchy with a compact header and bottom navigation. It is intentionally not a generic admin dashboard and does not share the Resource Market trading layout.

The shell is LTR-first for English, Chinese, and every supported locale. Arabic applies RTL to localized prose and form controls while `.app-shell`, navigation order, evidence chronology, and status progression remain structurally LTR.

## Visual system

- Neutral light canvas `#f5f5f7` and true dark surfaces; Klein Blue `#002FA7` is limited to actions, selection, links, and focus.
- Red is reserved for illegal/abusive requests, orange for review/warnings, and green for proven success.
- System font stack, compact 44-pixel controls, typographic hierarchy, dividers, tables/lists, and a single object inspector replace the previous oversized left-heavy card wall.
- The language chooser is a folded `details` popover; mobile presents a compact language entry instead of twelve always-visible options.

## Accessibility and responsive checks

- Skip link, semantic landmarks/headings, labelled forms, live status regions, visible focus, keyboard navigation, minimum touch targets, reduced-motion handling, dark mode, and independent large-text toggle.
- 12 locales: `en`, `zh-Hans`, `zh-Hant`, `ja`, `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar`, `id`; locale and AI output language persist independently.
- Current-run browser tests passed at 1440×900 and 390×844 with no horizontal overflow. Arabic preserved the LTR shell while critical due-process copy remained non-empty.

## Runtime evidence

- `docs/handoffs/evidence/ui-audit-current/trust-center-desktop.png`
- `docs/handoffs/evidence/ui-audit-current/trust-center-mobile.png`
- `docs/handoffs/evidence/ui-audit-current/trust-desktop-final-light.png`
- `docs/handoffs/evidence/ui-audit-current/trust-desktop-final-dark.png`
- `docs/handoffs/evidence/ui-audit-current/trust-mobile-390x844.jpg`

Core states exercised in automation: loading, empty, bounded success/governance review, illegal fail-closed, provider unavailable, exact retry, and offline/no-substitute wording. Tampered, replay-rejected, conflict, recovery, expired, audit, and permission-denied states are server-backed and use the same status treatment.

## Fixed issues and limits

Fixed: oversized left rail, excessive left alignment, desktop controls crowding the mobile header, exposed locale list, whole-page RTL mirroring, undifferentiated illegal status, and generic card-wall hierarchy.

Remaining external limitation: authoritative central Wallet/Gateway is not deployed for this branch, so the Wallet sheet correctly stops at a canonical authorization envelope and reports integration pending.
