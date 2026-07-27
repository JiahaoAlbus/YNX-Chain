# YNX Card UI design audit

## Information architecture and tokens

Card is independent from Pay. A single Klein-blue virtual sandbox card anchors
the overview; activity and controls use native lists, and support contains
provider notifications plus human AI review. The card is always labeled
TESTNET/SANDBOX. Only last four, expiry, provider reference and network can be
revealed, behind a biometric prompt. The layout does not copy Apple Card and
does not claim fiat value or a real network relationship.

## Platform, accessibility and locale

Native safe-area controls expose button/tab/radio/alert semantics, minimum touch
areas, light/dark system appearance and scalable text. MCC and country controls
validate strict code formats before submission. Twelve complete catalogs and
Arabic RTL are tested. Android/iOS Hermes exports pass; the macOS CI job builds
the iOS Simulator target without signing.

## Evidence status

A previous build rendered the Card signed-out state and rejected a tampered deep
link without creating a session. The current APK was rebuilt after notification,
control and AI-review changes, but the emulator package/activity services died
during re-install. Therefore previous screenshots are historical design input,
not current release evidence. Current light/dark, phone/tablet, Arabic RTL,
large-text, loading, empty, failure and sandbox-success captures remain open.
