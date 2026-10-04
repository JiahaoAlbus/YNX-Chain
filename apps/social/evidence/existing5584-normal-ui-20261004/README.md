# Existing Android guest UI observation, 2026-10-04

This is direct observation of an existing installed application, not acceptance
of the current Social source, a replacement APK, E2EE, or a release.

## Runtime identity

- Serial: emulator-5584; AVD: YNX_SOCIAL_20260912_QA; original emulator PID: 54243.
- Activity: com.ynx.social/.MainActivity.
- Installed version: 1.0.0 / versionCode 1; last update: 2026-10-03 15:36:32.
- Installed base.apk SHA256: aeed8510e52e34bbc584353e9e8e5b23e5bf3ae6104251e0e1ab44f7b843586f.
- Retained development-3b813c6b candidate APK SHA256: 9340d93b756a02878a00e9a98a31d9e6234af8b81c934b1e40a0e47399d85c74.
- These APK identities differ. Installed source remains NOT_VERIFIED.
- Current owner source checkpoint: 811d96b52f95348d96602f406ffd832ce65026e9;
  tree: 6095cc0bbcea2d61d693ddebf30d4029bdc9e2ae. This is NOT an installed-source binding.

## Permission boundary

Cooperative reservation social5584-normal-ui-native-reservation-20261004-r1
was accepted at 2026-10-04T02:29:37.573Z by controller
01a02881-2bcb-74f3-be69-bd0eb3750d41, with expiry 2026-10-04T02:55:00Z.
It is a cooperative directory reservation, not proof of OS-wide exclusivity.
Original reservation and acceptance are archived alongside the outcome.

## Observed actions

1. Existing Settings displayed the original YNX mark, English, and selected 90% text size.
2. Chats displayed a sign-in boundary rather than invented conversations.
3. Contacts displayed a sign-in boundary and described requests separately from following.
4. Moments displayed a sign-in boundary and protected private audiences.
5. Returning to Settings preserved the 90% text selection.
6. Chat appearance opened; selecting Dark changed only the draft preview.
7. Cancel returned to Settings; reopening showed System selected and Dark unselected.
8. The second appearance dialog was cancelled, leaving the application on Settings.

Each navigation input used bounds from the immediately preceding actual UI tree.
XML and PNG files retain the observed states. Guest screens contain no real chat,
contact, or Moments content. No login, account request, Wallet approval, signature,
transaction, key import, identity injection, file selection, save, reinstall,
reset, snapshot, process termination, or foreign-device input was performed.

## Outstanding acceptance

Real authenticated messaging, contact acceptance, Moments publication, cross-node
identity, recovery, current-core installation, provider lifecycle, and MONSTER
ordinary-user acceptance were NOT_RUN. Blank-screen absence is limited to these
observed guest transitions. No global console/crash-free or source-complete claim.
