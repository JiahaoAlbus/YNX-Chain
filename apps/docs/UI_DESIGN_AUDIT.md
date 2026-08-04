# YNX Docs UI design audit

Audit date: 2026-07-18. The review used the running Web app at 1440×900 and 390×844 plus the installed Android release build. Screenshots are real runtime captures.

## Information architecture and platform behavior

- Desktop uses a document rail, compact action toolbar, centered neutral writing page, and optional comment/version/AI inspector. The editor is the dominant surface and is not surrounded by a card dashboard.
- Mobile uses a navigation header, semantic document list, focused editor, native sheets, system export, bounded presence heartbeat, and side-by-side conflict choices.
- Autosave, current version, presence boundary, recovery, and AI review stay visible near the action they govern.

## Tokens and hierarchy

- Klein Blue `#002FA7` is limited to primary actions, selection, links, and focus. Dark interaction blue is contrast-corrected.
- Neutral light/dark canvases, a white/near-black writing page, system sans-serif chrome, readable serif editor text, fine dividers, and whitespace provide hierarchy.
- No Apple assets/fonts, gradients, neon, glass effects, colored tile grid, card wall, or fake letter mark remains.

## State and safety review

- Loading, empty, saved/version success, failure/retry, offline draft, stale-base conflict, recovery, bounded presence, audit, and destructive confirmation are implemented.
- Autosave sends `baseVersion`; 409 returns current server version/content. The recovery sheet offers keep-local-as-new-document or use-server and never silently overwrites.
- Comments cite exact versions and extract bounded mentions. Presence is an expiring heartbeat explicitly labeled as not real-time collaboration.
- AI uses exact current document/version context, consent, provider/model/status/cost, cancel, review, apply/reject, citations, and audit. Apply goes through normal autosave/versioning.

## Accessibility, locale, and motion

- Touch targets, skip link, focus-visible, semantic roles/labels, live save/error status, high contrast, reduced motion, keyboard search, and screen-reader labels are implemented.
- Twelve locales are present: en, zh-CN, zh-TW, ja, ko, es, fr, de, pt, ru, ar, id. Arabic uses RTL. Toolbar, search, editor prompts, safety/presence copy, date display, and AI output language are localized.
- Web uses relative sizing and responsive layouts; native respects system font scaling and system light/dark appearance at launch.

## Runtime screenshots inspected

- `evidence/screenshots/docs-desktop-empty-en.png` — desktop light empty/sign-in, 1440×900.
- `evidence/screenshots/docs-desktop-autosave-en.png` — real document autosaved from v1 to v2, 1440×900.
- `evidence/screenshots/docs-desktop-dark-en.png` — dark writing canvas, 1440×900.
- `evidence/screenshots/docs-mobile-rtl-ar.png` — responsive Arabic RTL, 390×844.
- `evidence/screenshots/docs-android-release.png` — installed Android release surface and honest replay/expiry failure state.

## Visual defects found and fixed

1. The editor section had an ID/class mismatch, so the intended centered page and separated footer did not render. The runtime capture exposed it; the class is now applied.
2. Word count and editor-boundary copy previously touched because the footer style was missing; the corrected canvas separates them.
3. Dark link/selection contrast was raised.
4. Artificial letter branding was removed, and native document cards became divided list rows.
5. Locale switching now preserves Wallet-connected state and translates the full static editor toolbar.

## Remaining limitations

- No public staging URL exists, so Web evidence remains local.
- iOS build/install awaits the provided macOS CI workflow or full local Xcode.
- Bounded presence intentionally does not provide character-level real-time coediting, cursors, or CRDT merging.
