# YNX Music UI design audit

Status: visually reviewed local Testnet Preview; native production-store review remains external.

## Information architecture

Listener navigation is Home, Search/track discovery, Library and Settings. Library uses lists for favorites, history, queue, playlists and downloads. Creator Studio is entered from Settings or the explicit publish action and is not a listener tab. Now Playing stays a compact bottom surface; queue state is handled as a library/native list rather than a card wall.

The Web surface is a responsive operator/staging view, not a substitute for native playback. It presents a truthful empty state when no licensed/owned release is available and never fabricates catalog activity.

## Tokens and platform behavior

- Canvas: neutral `#F7F7F8`/`#F5F5F7`; dark `#000000`/`#1C1C1E`.
- Primary/secondary text: approximately `#1D1D1F`/`#6E6E73`.
- Klein Blue `#002FA7` is limited to brand, focus, selected state and primary actions.
- System font stacks only; no Apple font or asset is bundled.
- Android keeps platform Buttons, EditText, Spinner, MediaSession and foreground notification behavior. iOS uses NavigationStack, List, Form, TabView, AVPlayer and system media controls.
- Reduced motion and high-contrast media queries are present on Web; native controls inherit platform settings. Touch actions use platform minimum sizing and status updates are live regions.

## Visual corrections made

- Removed the prohibited full-blue hero and replaced it with a neutral artwork-led surface.
- Removed Creator from listener bottom/tab navigation on Web, Android and iOS.
- Added Android edge-to-edge system-bar insets, neutral canvas, dark resources and dynamic-text-safe vertical flow.
- Removed legacy Web login dialog and all browser session storage/bearer behavior.
- Kept album artwork/record motif as the focal object without assigning every album a colored tile.
- Fixed dark-mode hero text contrast and reduced the mobile navigation to three listener destinations.

## Screenshots inspected

- `evidence/screenshots/web/desktop-light-1440x900.png`
- `evidence/screenshots/web/desktop-dark-1440x900.png`
- `evidence/screenshots/web/mobile-light-390x844.png`
- `evidence/screenshots/android/cold-start-1080x2400.png`
- `evidence/screenshots/android/empty-offline-1080x2400.png`
- `evidence/screenshots/android/failure-tampered-1080x2400.png`
- `evidence/screenshots/android/arabic-rtl-1080x2400.png`
- `evidence/screenshots/android/large-text-1080x2400.png`
- `evidence/screenshots/android/dark-1080x2400.png`

The screenshots cover desktop light/dark, mobile, Arabic RTL, large text, loading/offline/failure and empty/retry. Success state is covered by native instrumentation and service workflow tests rather than fabricated screenshot data. A real catalog screenshot is intentionally absent because the preview bundles no licensed public music.

## Accessibility and locale result

The catalog audit passes 12 locales × 55 keys and verifies Arabic script, exact key parity, legal/auth/payment/privacy concepts and RTL enablement. Android uses `supportsRtl`, app locale switching, content descriptions and a polite status live region. iOS sets locale/layout direction and relies on semantic SwiftUI controls and Dynamic Type. Web has skip navigation, labeled status/search/player controls, keyboard focus, reduced-motion and contrast modes.

Known limits: no physical-device screen-reader session was available; full iOS visual/simulator evidence is delegated to the committed macOS CI workflow; shared Android emulator system processes were intermittently unstable, so only clean, manually inspected frames are indexed.
