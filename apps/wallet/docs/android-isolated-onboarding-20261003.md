# Android native build and isolated onboarding — limited OS evidence

Inherited production HEAD `6c21f9487c833edbb77ebbca3ff6c627c4d38dce`, tree `83b5c6049916bace6a334217d6496fd71870ef1b`; frozen App SHA256 `c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`. No App/startup, shared SDK, version, signing policy or protection source was changed. Native 935/935 and Desktop 694/694 are prior results, not new reruns.

## Actual build and target

Candidate `/tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet`, inherited SDK955 dependency graph. SecureStore native patch check passed with source `9d5ba89067e9c72f2c9607c73d5747e1a10a81918ddd04ac4fb2023123955524`, barrier `ea2af95d0863f96ee668a1ab5b79a8145bfe793222797625055463c3fb948082`, Android build-from-source enabled. Gradle 9.3.1, JDK17 and existing API36 SDK used offline.

`:app:compileDebugKotlin` exited 0 (223 tasks); ordinary arm64 debug assembly exited 0 (330 tasks). The initial Metro invocation failed because `--offline` and `--localhost` are mutually exclusive; `EXPO_OFFLINE=1 ... --localhost --port 8895` started successfully. Ordinary debug APK nevertheless showed the real RN `Unable to load script` screen, without a Metro request. Current `MainApplication` omits `useDevSupport`; Expo factory defaults to the dependency's `ReactBuildConfig.DEBUG`. This debug startup gap remains unresolved production source, not a failed product test hidden by a fixture. Startup ownership remains with A; route this evidence for an exact compatible startup handback.

For the subsequent limited OS checks, an external QA-only Gradle init file sets `react.debuggableVariants=[]`, causing `createBundleDebugJsAndAssets` to package the frozen application into the original debug-signed variant. No release task/key or alternate app implementation was used. Assembly exited 0 in 39s (331 tasks). This is not a formal forward installer. Version remains `1.0.15-testnet-preview`, code22; never install it over the published code34 or an existing user's Wallet.

Fresh owned AVD `wallet-native-owned-20261003`, explicit serial `emulator-5596`, API36 arm64 Google APIs Play Store, 1080×1920, density420. Root `/tmp/ynx-wallet-android-emulator-20261003-m1qY9H`. No existing emulator was mutated. Initial default unauthenticated gRPC listener was stopped before package installation; restart used localhost-restricted JWT gRPC authentication. Every changing adb operation first checked exact AVD name. No account, PIN, fingerprint, password or recovery key was entered/enrolled. Debug APK installed only on this fresh owned target. Metro was stopped and its reverse mapping removed before embedded-bundle onboarding checks.

## Observed flow, not private-storage readback

1. Embedded package launches the original English welcome screen; actual UI hierarchy includes brand, testnet identity, create/import/replacement recovery and previous-identity entry.
2. Create opens `Protect your Wallet` / `Set up strong biometrics first`; no recovery display appears. Check protection and continue leaves the same refusal hierarchy byte-for-byte.
3. Open security settings enters the real Android `Choose a screen lock` / Pixel Imprint flow. Back without enrollment returns to Wallet's protection sheet, not account generation; Close returns to the no-account welcome screen.
4. Selecting 简体中文 changes the actual language sheet and checked radio. After that visible confirmation, force-stop/start on the owned target retains Chinese welcome text. Create then shows the Chinese strong-biometric prerequisite and explicit no-new-account/no-recovery-key notice.

The first language attempt force-stopped immediately after tapping, before observing save completion; next welcome remained English. Those step09/10 artifacts are retained, not rewritten as success. The second attempt awaited the visible checked Chinese selection before cold restart and passed (step12/14/15). Immediate kill during pending preference save is not proven durable. No secret storage inspection was used to turn UI assertions into an independent no-key-generation proof; source still performs biometric preflight before RNG.

System screenshot succeeds as a file but renders entirely black under the existing global privacy protection. It was inspected and retained, not bypassed. UI hierarchy verifies labels/actions only; typography, clipping, visual polish and full locale/RTL acceptance remain NOT_VERIFIED. Crash buffer was empty. Embedded debug has a retained Expo CLI warning after Metro is stopped; this is not represented as release runtime behavior.

## Evidence SHA256

Build artifacts/logs under the candidate above:

| Artifact | SHA256 |
| --- | --- |
| android-native-compile-current.log | b7cef06757eb91985be60c053caa840cb797f8e42d07c80fdc10dbbc0bc9bdb5 |
| android-debug-qa-embedded-assemble.log | 65ff41c72442595618d183c513117d1c6f93ee62aa5422c546b20baec35ff863 |
| android/app/build/outputs/apk/debug/app-debug.apk | 28b15714f3692ce8212b506db9c3f940c525eac94564be2a622cef3c7f6e094e |
| android/app/build/generated/assets/react/debug/index.android.bundle | c6cc295dcc091e3aabf25fa1552cd7b748b5d4e6f4c05569423d1b69dd0b05da |

Device evidence under the owned AVD root above:

| Artifact | SHA256 |
| --- | --- |
| step-02-embedded-start.xml | 5914aa339fd0063ca78cb4aa85ab2544da2edfab463789dbf3c4e1b1c0c9e266 |
| step-03-create-refusal.xml and step-04-continue-refusal.xml | 4be2e9f6e1327f1a2b1669529566f73998454385439b5167fafee07e6e250f10 |
| step-05-os-security-settings.xml | e73f214288c4f02b211775a3eb52a7b7c8d0b172b82d3f8a5503fc4209cb421c |
| step-14-confirmed-language-ready.xml | 66d6383f4e7f9e9993a81789a72d17ed4c919d0a781bf49cfae2aab9af7606e9 |
| step-15-chinese-create-refusal.xml | be746e76049df6d2f1a5a96246b4d2de24d1d8306812c99749ccb57c8a2bdcd1 |
| step-02-protected-screen.png | 4afb293f262964138b1d2e2a08733ad4d4216150e508b9f62e4610e47e0cb930 |
| crash-buffer.log (empty) | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

Full source provenance is inherited; only this receipt/audit update is a new checkout change. Real enrolled physical-device key lifecycle, encrypted-store upgrade and unknown originals, camera/Pay/transfer/business receipts, protected Wallet tuple/ports, Web/macOS parity, sole-A forward signing/download/install and user acceptance remain incomplete. External inputs and MONSTER were not run. The full goal is active.
