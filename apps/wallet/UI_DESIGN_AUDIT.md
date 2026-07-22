# YNX Wallet UI design audit

Audit date: 2026-07-18. Status: implemented-local / tested-local / Android-installed-local / iOS-Simulator-installed-CI.

## Information architecture

The native Wallet now exposes Welcome, Create, Import, Recover, Locked Home, Accounts, Assets, Activity, Receive, Send Review, Authorization Review, Connected Apps, Sessions, Devices, Recovery, Security, Authorization Audit, and Network. It contains no Feed, Shop, Pay, Exchange, or other business-product navigation.

Unavailable central/chain data uses explicit loading, empty, or unavailable states. It never invents a balance, transaction, session, provider result, fee, or broadcast. Native `ynx1` is primary everywhere; EVM chain ID 6423 appears only as advanced compatibility context.

## Visual system

- Compact 8/12/16/24 spacing rhythm, rounded 12–24 pt surfaces, one YNX blue action color, restrained typography, and a single-column review hierarchy.
- System light/dark appearance is implemented with separate palettes. Android high-text-contrast selects high-contrast light/dark palettes.
- Text uses React Native font scaling. Controls have 42–50 pt minimum targets, roles, labels, disabled/expanded/selected states, and selectable addresses/review values.
- System reduced-motion removes sheet transitions. Screen capture is disabled for newly generated recovery material.
- Tablet support is declared on iOS; sheets and primary content are width-bounded while review rows remain fluid.

## Language and direction

The 12 complete runtime catalogs are English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic, and Indonesian. Selection persists in device-only storage. Onboarding, locked state, primary account actions and authorization safety copy are translated in every catalog rather than falling back to English. Arabic applies RTL direction; dates, numbers, amounts, and plurals use `Intl` for the selected locale. AI output language remains an independent, explicit selection.

## Evidence

- `proof/ynx-wallet-locked-current.png`: current API 36 installed Wallet Welcome/Create/Import/Recover screen after a true cold launch.
- `proof/ynx-wallet-arabic-main.png` and `proof/ynx-wallet-arabic-rtl.png`: Arabic security copy, mirrored header/layout and all twelve language choices.
- `proof/ynx-wallet-dark-large-text-rtl.png`: dark appearance with Arabic RTL and device font scale 1.3.
- `proof/ynx-wallet-fold-large-screen.png`: actual installed large-screen layout on an unfolded 2076×2152 Pixel 9 Pro Fold emulator.
- `proof/ynx-wallet-authorization.png`, `proof/ynx-social-product-session.png` and `proof/ynx-social-replay-rejected.png`: historical installed-flow images from before Social identity normalization. They demonstrate the review/session/replay surfaces but are not evidence for the current canonical `com.ynx.social` tuple.
- `proof/ios-simulator-deep-link-rejection.png`: installed iPhone Simulator after cold launch and fail-closed malformed authorization deep link.
- `src/accessibility.test.ts` and `src/i18n/i18n.test.ts`: control semantics, all 12 catalogs, persistence, RTL, formatting, and bounded labels.

The repository now contains phone, unfolded/foldable large-screen, Arabic RTL, dark and large-font Android runtime evidence plus an executed iPhone Simulator install/cold-launch/deep-link screenshot from Xcode 26.3 CI run 29646381701. It does not claim a physical iPhone/iPad install, Apple signing or App Store evidence because this host has no full Xcode and no owner signing credentials.

## Findings

- Pass: independent Wallet identity, correct native network/account hierarchy, self-custody messaging, destructive confirmations, exact authorization review, honest empty/failure states, no business tabs.
- Pass: system appearance, reduced motion, high text contrast, dynamic text semantics, 12 locales, Arabic RTL logic, accessibility roles/names/state.
- Pass: installed Android cold-start, large-screen, Arabic RTL, 1.3× text and dark appearance; executed unsigned iOS Simulator build/install/cold-launch/deep-link rejection. The current canonical authorization/replay behavior is covered by executable SDK/Wallet/harness tests; the retained installed-flow images are explicitly historical.
- Pending release evidence: physical-device screen reader/biometric checks; physical iPhone/iPad screenshots; maximum platform font scale; external design/accessibility review.
