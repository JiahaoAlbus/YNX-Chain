# YNX Cloud UI design audit

Audit date: 2026-07-18. The review used the running Web app at 1440×900 and 390×844 plus the installed Android release build. Screenshots are real runtime captures, not mockups.

## Information architecture and platform behavior

- Desktop uses a restrained sidebar, toolbar/search, divided file list, quota footer, and right-side inspector. Files and folders are rows rather than colored cards. Share/version actions use dialogs or inspector surfaces.
- Mobile uses a native tab row, semantic file list, bottom sheet details, system share/export, secure Wallet deep link, offline upload queue, retry, and native destructive alerts. The former artificial letter mark and text-symbol file icons were removed.
- Cloud and Docs share the audited storage service but do not share navigation, package, Wallet client, callback, session, or release record.

## Tokens and hierarchy

- Klein Blue `#002FA7` is limited to primary actions, selection, links, and focus. Dark mode uses a contrast-correct lighter interaction blue while retaining a dark primary button fill.
- Light canvas is `#F7F7F8`, primary text `#1D1D1F`, secondary text `#6E6E73`; dark canvas/surface are `#000` and `#1C1C1E`.
- System font stacks, fine dividers, whitespace, list alignment, and native controls establish hierarchy. There are no gradients, glass effects, neon, card walls, fake brand assets, or Apple fonts/assets.

## State and safety review

- Loading: mobile activity indicator and Web status; empty: bounded storage explanation; success: authorized item count and sync timestamp; failure/retry: honest API error with retry; offline: persistent banner/queue; stale/conflict: no silent overwrite; permission denied/unavailable/expired/replay/tamper: server error is surfaced without local fallback.
- Recovery and partial completion: verified backup/restore, resumable offline queue, and first-failure queue pause. Audit and destructive confirmation are explicit. Permanent deletion requires an already-trashed object and exact `DELETE` confirmation. Product-data erasure is a separate export-first Web/native settings flow: routine sessions omit `data.delete`, the user reauthorizes that scope alone, types exact `DELETE CLOUD DATA`, and sees either completed-known-provider or honestly pending-provider receipt state. A fresh dedicated session can recover hashed receipts after the erasing session is revoked.
- AI requires selected file/version context, consent, provider/model/status/cost, cancel, review, accept/reject, citations, and audit. It never changes a source file, share, deletion, or permission automatically.

## Accessibility, locale, and motion

- Touch targets are at least 44 px; keyboard search, skip link, focus-visible ring, semantic roles/labels, live status/errors, high contrast, and reduced motion are implemented.
- Twelve locales are present: en, zh-CN, zh-TW, ja, ko, es, fr, de, pt, ru, ar, id. Arabic sets document direction to RTL; native direction change is applied after restart. Dates use locale-aware formatters. Security, quota, export, destructive erasure, retention, provider-pending, and receipt-recovery text is translated.
- Web sizing uses rem/clamp and responsive grids; native respects system font scaling. Native appearance tokens select system light/dark at launch.

## Runtime screenshots inspected

- `evidence/screenshots/cloud-desktop-empty-en.png` — desktop light empty/sign-in state, 1440×900.
- `evidence/screenshots/cloud-desktop-success-en.png` — canonical Wallet-connected success with real folder row, 1440×900.
- `evidence/screenshots/cloud-desktop-dark-en.png` — desktop dark success, 1440×900.
- `evidence/screenshots/cloud-mobile-rtl-ar.png` — responsive Arabic RTL, 390×844.
- `evidence/screenshots/cloud-android-release.png` — installed Android release cold-launch surface.

## Visual defects found and fixed

1. Dark theme reused Klein Blue for link text and failed visual contrast; dark interaction blue and focus color were raised.
2. The original file surface read as rounded cards; it was changed to a divided list on Web and native.
3. Artificial single-letter branding and text-symbol file icons were removed.
4. Locale switching previously rewrote “Wallet connected” as a sign-in call to action; authenticated state is now preserved.

## Remaining limitations

- No public staging URL exists, so the screenshots prove local rendering only.
- iOS visual/install evidence awaits the provided macOS CI workflow or a host with full Xcode; this Mac has Command Line Tools only.
- A production object store, KMS, and antivirus adapter do not exist; the UI therefore describes storage as bounded rather than production cloud durability.
