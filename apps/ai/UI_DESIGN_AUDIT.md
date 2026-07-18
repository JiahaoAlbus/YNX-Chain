# YNX AI UI design audit

## Information architecture

The signed-in product uses four top-level destinations: Conversations, Review, Privacy, and Settings. Conversation history and active thread form the primary split view; compact mobile widths preserve the same hierarchy. Review separates proposed tools/actions from permissions, and Privacy separates retention/delete from provider disclosure and audit.

The signed-out screen leads with the authority boundary before any input. When canonical Wallet integration is absent, Web sign-in fails closed and says so explicitly; it never creates a local production session.

## Visual system

- Primary: YNX blue `#002FA7`; danger `#B42318`; success `#12B76A`.
- Neutral surfaces use white, `#F6F8FC`, restrained rules, and typography hierarchy rather than a colored card wall.
- Web dark mode uses `prefers-color-scheme`; reduced motion disables animation, transitions, and smooth scrolling.
- Native uses platform Pressable, TextInput, Modal/Alert, DocumentPicker, Share, Clipboard, SecureStore, and safe-area primitives; no WebView.

## Platform behavior

- Android and iOS share the React Native information architecture but retain native alerts, file picker, share sheet, linking, clipboard, SecureStore, and accessibility behavior.
- Android exact callback filter is `ynxai://wallet-auth/callback`; the generic scheme filter was removed from the checked-in main manifest.
- Native font scaling remains enabled. Buttons expose roles/labels, tabs expose selected state, and errors use live regions.
- Arabic activates RTL direction and right text alignment; date, number, money, and plural formatting use `Intl` locale APIs.

## Runtime inspection

On 2026-07-18 the actual embedded Web product was run locally and inspected at 1440×900 light, 1440×900 dark, and 390×844 mobile. The failure state was triggered through the visible button and showed: “Canonical YNX Wallet integration is not deployed. Sign-in is fail-closed; no local session was created.” No provider success state was fabricated.

## Issues fixed in this pass

- Added visible canonical-integration boundary to sign-in.
- Added responsive conversation search wired to encrypted server search.
- Added keyboard focus rings, reduced-motion behavior, dark-mode tokens, and forced-color handling.
- Removed broad storage permissions from the final Android manifest and removed the generic deep-link filter.
- Added branch and continue controls to native conversation UI.
- Expanded action review schema to show exact target, risk, evidence, and provider data.

## Remaining limitations

- Durable repository screenshot files for every requested state (tablet, Arabic, large text, loading, empty, failure, success) are incomplete. Interactive light/dark/mobile evidence alone is insufficient to close the full visual requirement.
- Native dark-mode colors are not yet fully tokenized even though the project follows the system appearance setting.
- No successful provider output may be captured until a real provider-backed Gateway response exists; `generationLive` remains false.
- Current host cannot run iOS Simulator because full Xcode is absent. The runnable CI workflow is evidence of a test definition, not a passing run.
- A current-hash Android install could not complete after concurrent local emulator processes became offline/hung; build evidence is valid, install evidence is not.

UI completion therefore remains open.
