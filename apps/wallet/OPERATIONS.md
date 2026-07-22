# Wallet operations

## Build and verification

Run `npm ci && npm run check` in this directory and `npm test` in `packages/wallet-auth`. From the repository root, generate the existing contract fixtures with `npm ci && npm run hardhat:build && npm run contracts:selectors` before `make test`; those generated artifacts are ignored and are not Wallet deliverables.

Build Android with SDK 36 and Java 17:

```sh
cd apps/wallet/android
ANDROID_HOME=/path/to/android/sdk ANDROID_SDK_ROOT=/path/to/android/sdk ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell am force-stop com.ynxweb4.wallet
adb shell am start -S -W -n com.ynxweb4.wallet/.MainActivity
```

The checked CI workflow `.github/workflows/wallet-ios.yml` performs dependency installation, tests, bundle export, CocoaPods installation and an unsigned Simulator build on macOS 15. It uploads the Simulator product; production archive/signing is deliberately outside CI until owner-controlled Apple credentials exist.

Generate the review SBOM with `npx @cyclonedx/cyclonedx-npm --ignore-npm-errors --output-file sbom.cdx.json --output-format JSON --spec-version 1.6 --omit dev`. Any npm tree error keeps SBOM release readiness false even if a graph is emitted.

## Runtime checks

- Confirm the header says `YNX TESTNET · ynx_6423-1` and user-facing accounts remain `ynx1...`.
- Confirm balance/activity state is authoritative, or shows an honest network failure and retry.
- Confirm a force-stop restarts locked, a background transition locks, and strong biometrics gate key use.
- Confirm the authorization route rejects malformed or replayed requests before showing approval.
- Confirm central introspection includes exact product, device, account and scopes; revoke session/approval/device/account sessions and re-introspect.
- Confirm Smart Account simulation and sponsorship use the unchanged operation digest and exact EntryPoint/target/selector policy; a provider outage or exhausted budget must show ineligible with zero approved cost.
- Confirm strategy mandate kill/revoke/emergency-exit paths and Credential expiry/status failure before enabling either surface.

## Rollback and incidents

Mobile rollback means distributing a previously verified artifact through the eventual owner-controlled channel. Never downgrade the central registry schema or re-enable a pending product. During suspected key compromise: disable the exact registry entry, revoke the device and approval digest, invalidate all account sessions, preserve audit hashes, then require account recovery/rotation. The Wallet cannot honestly claim online cross-device revocation until the central lifecycle service is merged and deployed.

Engineering-only Android and iOS Simulator downloads are hosted in the immutable GitHub prerelease recorded by `artifact-manifest.json`. Do not label them production-signed or store-released. No public product deployment or update service exists.
