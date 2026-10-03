# Native startup and visible Desktop QA identity — complete owned source batch, incomplete product acceptance

Inherits `04fd2165700f5f2cafc155cc183cc11fe6fd9aa2`. Root clarified that ordinary MainApplication/own build startup work is within the existing Native lock; A's unfrozen App and shared contracts/formal issuer remain untouched. App SHA stays `c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`. No product version, signing, SDK bytes, profile, account, password/PIN, keys, sessions, unknown originals or transaction policy changed.

## Production changes, not an external QA bundle workaround

- Android MainApplication explicitly passes application `BuildConfig.DEBUG` to Expo's original host. Ordinary debug now requests Metro; release uses the generated false constant. It no longer depends on the prebuilt React Native library's DEBUG value.
- Metro watches actual installed node_modules and Wallet Auth link targets, resolves from that same installed graph, and returns the canonical file path of the same installed registry. Expo's development HMR rewrite clears nodeModulesPaths, so its extraNodeModules entry points to the same installed Expo package. No different checkout/dependency/version/registry content is substituted.
- Desktop unpackaged windows/About clearly state `测试构建 / QA` and show a deterministic public owned-app source fingerprint. Package version, original brand/icon/name and packaged title stay unchanged. Missing identity is `源码未验证` / NOT_VERIFIED, never an invented commit. The hash covers regular src JS/module/HTML/CSS files and package.json, not installed dependencies, signing, a Git revision or acceptance. It does not open profile/custody files or source symlinks. Authorization/activation/page-title events retain this identity.

Production source SHA256: MainApplication `709e0d2d1a0e5995a145b1423b4e242656b6a140210e7dae3ca37da4cca40c3a`; Metro `6daec749dd798e96421bed519ac76b9e47bb9dc971d0c93b0225ad6296a8358c`; Desktop main `59771a275a514471c0f891899bbd6f3fe0afa4c2148845cccc2c997dd4fc15d4`; branding `8e1a541838a0193535315e38005a45bc32043f26db17528385d2ec0b587359b7`. Android and Desktop candidate src trees compare byte-for-byte to owned src, diff exit0.

## Concentrated validation

Native candidate `/tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet`; Desktop candidate `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`; admitted SDK955 dependency graph, no dependency source edits.

| Check | Actual result | Log SHA256 |
| --- | --- | --- |
| Original archived 04fd Native final five targets | 2 pass / 3 fail, exit1 | 7c39bf1e5e94f00fb9c8dd8499ed84090f02446a1405541152fc2e916b137a03 |
| Final Native five targets | 5/5, exit0 | 138059a0dfce6590ad4583b2d11292da8f268ac5b0d2e6f0d522f24f056186d6 |
| Full final Native regression | 940/940, exit0 | 7736e3572ee9fb2fde59dabea55ce358086b94037dba071845a275d541131a38 |
| Final Native typecheck | exit0, empty log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| Ordinary arm64 Android assembleDebug, no QA init | exit0, 330 tasks | 6bd5a06220286e42e03971592ddd1839da0f6a861ae4338cf4c9402ef515ef4c |
| Android compileReleaseKotlin | exit0, 224 tasks; DEBUG=false | 888c7f1f4bb2bad62401a560293f9ef373951d47ada15aab53483289eb6cf7a4 |
| Final Android Hermes export | exit0 | 1368a28e9bac992c73f9d2f6fece484c7f9bf22323c9e0a7380b5761d4cad9c5 |
| Final iOS Hermes export | exit0 | e4c9c1d0824204d36cdd677defbe7b0679959ddde961e72d21aa37fb8eb19ce2 |
| Original archived 04fd Desktop final seven targets | 1 pass / 6 fail, exit1 | 6fe827df2d573583d1b22459822931e8070ba9465870fe506fd07815f6d7c75e |
| Final Desktop seven targets | 7/7, exit0 | 9847ef5ca1dd8b54bd6a8807b7a6ad0724def82b61c6f721a78137e78f6718d4 |
| Full final Desktop regression | 699/699, exit0 | 3ec15390df5ec75f2d3fe1683d8c780333eb364d9f6b2e480676173e6d099a9c |

Native original archive `/tmp/ynx-wallet-host-original-dNMozL` retains exact old product files and current targets. Real regular-directory and dependency-link config fixtures verify graph/registry/HMR paths; these are resolver regression tests, not OS acceptance. Desktop tests include deterministic public-file identity, byte changes, missing identity, no symlink/private-file read and original activation/authorization/page-title wiring. Intermediate failed Metro attempts (IPv6-only localhost, missing linked dependency, registry logical-path SHA, HMR rewrite) and an initial strict-TS test typing failure remain retained; final configuration/results above supersede them, not erase them.

Hermes outputs: Android `index-0c7f466db94ee428c48d7740d13d1107.hbc`; iOS `index-5a3570af7fe131fc8395cbf56f4f9ae0.hbc`. Third-party package-export fallback warnings remain. SecureStore native patch check still passes with original source/barrier and Android build-from-source.

## Actual ordinary Android debug flow

Owned AVD `wallet-native-owned-20261003`, explicit serial emulator-5596, same isolated root as the prior onboarding receipt. JWT-authenticated localhost gRPC; every mutation verifies exact AVD name. Ordinary debug APK SHA256 `cc5b82c807a2c7b54cb390e279b933a24a13b9f1f0f671af916f8a9ebbe30a29`, version/code still 1.0.15/code22. APK archive has no assets/index.android.bundle (unzip selected-entry exit11), so actual startup is not borrowing the external embedded-debug init. Only the fresh owned target was updated, with no uninstall or data clear; its prior Chinese preference survives.

Dedicated Metro started with `NODE_OPTIONS=--dns-result-order=ipv4first EXPO_OFFLINE=1 CI=1 expo start --localhost --port 8895`, bound 127.0.0.1 only; adb reverse8895. Host's React logs now request Metro instead of immediately loading absent assets. Final Metro logs actual `Android Bundled ... index.ts (3911 modules)` and actual UI hierarchy shows Chinese welcome. Log `android-production-host-metro-final-v4.log` SHA256 `0cf84d10e9e64a94bcdbb7e9502616deb4871da2737136dfe9563a7c1d5f9b53`.

Create, import recovery key and replacement-device recovery each entered the original Chinese strong-biometric prerequisite, before any key field/recovery display. UI evidence at `/tmp/ynx-wallet-android-emulator-20261003-m1qY9H`: host-fix-06-final-v4.xml SHA `66d6383f4e7f9e9993a81789a72d17ed4c919d0a781bf49cfae2aab9af7606e9`; host-fix-07-create-refusal.xml, host-fix-09-import-refusal.xml and host-fix-11-replacement-refusal.xml each SHA `be746e76049df6d2f1a5a96246b4d2de24d1d8306812c99749ccb57c8a2bdcd1`. All taps use corresponding XML bounds. No account/key/PIN/password/fingerprint entered. Screen remains protected black, exact prior inspected PNG SHA `4afb293f262964138b1d2e2a08733ad4d4216150e508b9f62e4610e47e0cb930`. No bypass and no visual acceptance claim. Own emulator and Metro normally stopped; artifacts kept.

## User-facing source identity and Apple status

Read-only ps/lsof currently found only prior PID26147 at `/private/tmp/ynx-wallet-clipboard-recovery-20261003-2aePyd/apps/wallet-desktop`; prior PID52159 was absent. This old candidate has no current wallet-runtime-branding module, so it is not the latest full owned candidate. The screenshot alone does not retrospectively prove its exact process/profile. No old window focus/reload/reopen or private argv/ENV/profile/account read was performed. New Desktop fingerprint computed against the actual tested owned app files is `410929c782af3a7808a30944f551837a066437ff2233ae20fe3b9201e8a03579`. New title/About source behavior is tested, not yet rendered/installed macOS acceptance.

Human reports TestFlight installed and Xcode downloading. Current read-only xcode-select still returns `/Library/Developer/CommandLineTools`; `/Applications/Xcode.app` is not present yet. Do not treat this as permanent absence, change global selection, interrupt download, or invent upload/signing readiness. Existing iOS target is YNXWallet, bundle com.ynxweb4.wallet, deployment target16.4; Info.plist has original camera/FaceID declarations and ynxwallet deep link. AppDelegate original DEBUG-Metro/release-main.jsbundle distinction is unchanged (SHA `510895dbd9aec82fe5c8143baf7cc4740449433f4a59a7299dd3dc1c6a408aeb`). After Xcode is usable, inspect its actual SDK/simulator inventory and build the same target with no signing for owned simulator QA. Sole A must supply the exact Apple team/app provisioning/distribution identity and matching App Store Connect/TestFlight release path; never request passwords, private keys or tokens in chat. JS/Hermes is not Xcode build, iOS install or TestFlight upload proof.

No formal build/sign/release, code34 successor, website installer adoption, enrolled-device secret lifecycle, full scanner/receiving/Pay/transfer/history/account/backup journey, protected Wallet tuple/37 ports, Web/macOS parity or user acceptance is established by this batch. Those remain development/acceptance work. External inputs and MONSTER are unrun. Full goal stays active.
