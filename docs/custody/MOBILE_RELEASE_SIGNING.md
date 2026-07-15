# Mobile Release Signing

Status: Android release pipeline verified with a disposable test certificate; owner production signing not completed.

## Implemented boundary

`make mobile-android-release-check` creates a disposable mode-`0600` PKCS12 keystore outside the repository, generates a Release APK and AAB through the Expo/Gradle native toolchain, verifies the APK v2 and AAB JAR signatures, binds both artifacts to one certificate fingerprint, writes a canonical provenance manifest, and rejects artifact tampering and false production-signing claims. The disposable package is test-only and is deleted by the check.

`ANDROID_SERIAL=<emulator> make mobile-android-release-installed-check` installs the generated Release APK only when Android reports `ro.kernel.qemu=1`. It clears the test application, launches the embedded Hermes build, and verifies the official Logo, Testnet state, four native tabs, and the independent native Pay invoice screen. It refuses real devices because the smoke clears application data. This installed-package check does not claim that public APIs are reachable; remote route evidence is tracked separately.

The Expo config plugin removes the generated debug signing assignment from the Release build. A Release is signed only when all external keystore credentials are present; partial configuration fails closed. Debug builds retain the ordinary generated debug certificate.

## Owner-approved input contract

Production signing requires an owner-controlled keystore and two one-line mode-`0600` password files outside the Git repository. The build accepts only these inputs:

- `YNX_ANDROID_KEYSTORE_PATH`
- `YNX_ANDROID_KEYSTORE_TYPE` as `PKCS12` or `JKS`
- `YNX_ANDROID_KEY_ALIAS`
- `YNX_ANDROID_STORE_PASSWORD_FILE`
- `YNX_ANDROID_KEY_PASSWORD_FILE`
- `YNX_ANDROID_RELEASE_MODE=owner-approved`
- `YNX_MOBILE_RELEASE_APPROVED=yes`

Owner-approved mode also requires a clean Git worktree and refuses to overwrite an existing output directory. Passwords and local credential paths are not written to the manifest or output. The manifest keeps real-device, store-submission, store-acceptance, and iOS-artifact fields false unless separate external evidence exists.

Before the first production build, the owner must independently establish keystore ownership, an offline recovery copy, access separation, rotation procedure, certificate-fingerprint approval, and a handover receipt. This repository does not generate the owner's production key.

## Current gaps

- No owner production keystore or completed signing ceremony exists.
- No signed production APK/AAB exists.
- No Android real-device or Google Play proof exists.
- Full Xcode and `simctl` are unavailable on the current machine, so no installed iOS app or IPA exists.
- No App Store or Google Play submission, acceptance, default-wallet support, partnership, or independent audit is claimed.
