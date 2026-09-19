# Android runtime test APK

This standalone Gradle project builds **one self-instrumenting test APK**, with
application ID and instrumentation target both
`com.ynxweb4.faucettransport.runtimeqa`. It is not included in the Wallet Gradle
project or Expo autolinking. It never builds, replaces, instruments, or reads the
Wallet application. It has no Activity, account, SecureStore, React Native, or
Expo module code.

The Kotlin source set compiles the original `../src/main/.../BoundedHttpEngine.kt`
directly, plus `../src/androidTest/.../BoundedHttpRuntimeInstrumentation.kt`.
There is no copied engine, mock HTTP client, or production injection change.
Its AGP 8.12.0, Kotlin compiler 2.1.20, OkHttp 4.9.2, Okio 3.16.0 and Kotlin
stdlib 2.2.20 match the existing Wallet Android build. The repository's Gradle
9.3.1 wrapper, Java 17 and Android SDK 36 are required. No npm install or Wallet
native build is needed. The plugin resolution maps the plugin IDs to the same
Maven modules already cached by the Wallet build.

## Build and inspect before installing

From the repository root, set `JAVA_HOME` to Java 17 and `ANDROID_HOME` to the
Android SDK. The following build is offline; missing artifacts must cause a
failure rather than silently changing versions.

```sh
apps/wallet/android/gradlew \
  -p apps/wallet/modules/ynx-faucet-transport/android/runtime-test \
  assembleDebug --offline --no-daemon --console=plain --max-workers=2 \
  -Dorg.gradle.jvmargs=-Xmx2g
```

APK: `build/outputs/apk/debug/ynx-faucet-android-runtime-test-debug.apk`, relative
to this directory. It uses the Android **debug test certificate**, not a Wallet
release certificate. Do not distribute it as a Wallet installer.

Before running it, retain the APK's complete SHA-256, `aapt dump badging`,
`aapt dump xmltree APK AndroidManifest.xml`, and `apksigner verify --verbose`.
Require the exact self-target package above, only the `INTERNET` permission,
and no Wallet package/shared UID. DEX inspection must show exactly one
`BoundedHttpEngine` and one `BoundedHttpRuntimeInstrumentation`, with no
`YnxFaucetTransportModule`, Expo, React Native or Wallet classes. Keep hashes of
the original engine and production adapter/index separately: the adapter's
production-off gate is **not executed by this test APK**.

## Execute on an explicitly authorized test emulator

Use an explicit serial for every command. The September 2026 audit permits
`emulator-5582` only; it does not authorize changes to `emulator-5580` or a user
phone. The test APK must not already exist: abort if `pm path` returns a package
path. Do not use `install -r`, `pm clear`, or uninstall an existing package.

```sh
adb -s emulator-5582 shell pm path com.ynxweb4.faucettransport.runtimeqa
adb -s emulator-5582 install /absolute/path/to/the-verified-test.apk
adb -s emulator-5582 shell am instrument -w -r \
  com.ynxweb4.faucettransport.runtimeqa/com.ynxweb4.faucettransport.BoundedHttpRuntimeInstrumentation
adb -s emulator-5582 shell run-as com.ynxweb4.faucettransport.runtimeqa \
  cat files/runtime-result.json
```

Keep the entire instrumentation stdout/stderr and the JSON file before cleanup.
Require 12 case records, `passed:12`, `failed:0`, the expected package, Android
API/ABI/fingerprint, and final `INSTRUMENTATION_CODE: -1`. An `adb` process exit
code of zero alone does not establish passing tests. Per-case status includes
timings and server request counts. Also read back the installed test base APK's
SHA-256 before uninstalling **only the package installed by this run**:

```sh
adb -s emulator-5582 uninstall com.ynxweb4.faucettransport.runtimeqa
adb -s emulator-5582 shell pm path com.ynxweb4.faucettransport.runtimeqa
```

Cleanup applies after failed tests too. Record any cleanup failure; never remove
another application to remedy it. Preserve Wallet APK version/hash and the
original locale/font/theme/locked state. Do not unlock, read private material,
or request accounts. No `adb reverse`, port forwarding, emulator restart,
snapshot restore, global log clearing, or desktop interaction is required.

## What the runtime checks prove

The harness uses real Android ART, `SystemClock.elapsedRealtimeNanos`, OkHttp,
strict Java UTF-8 decoding, scheduled deadlines and native loopback sockets.
The server binds only `127.0.0.1` on an ephemeral port in the same process. The
test constructor receives that exact URL for both purposes; no URL comes from
instrumentation arguments or a user. Test-only network security permits HTTP
to `127.0.0.1` and denies other cleartext hosts. It is **not an OS firewall for
HTTPS**; the no-public-request boundary also relies on the fixed test call graph.

The synthetic address is only an ASCII shape, with no private key or real
account. The number 100 is test input, not a current production claim limit.
HTTP 201/429/503 response facts are preserved; they do not establish a valid
admission ACK or that funds arrived. The engine's byte bound is its own 16 KiB
response accumulation plus the extra-byte EOF probe, not every internal
OkHttp/Okio/TLS allocation. Compression is rejected, not decompressed in the
application buffer.

The twelve cases cover runtime identity/test policy, exact admission bytes and
503 `Retry-After: 0` without replay, 307 without following, exact/over-limit
chunked and declared bodies, UTF-8/encoding/header failures, cancel-before-start,
in-flight cancellation with a late response, an actual elapsed one-second test
deadline, duplicate tasks, capacity/pause/resume/close, peer disconnection after
receiving the original body, and all five read-only RPC methods with unsupported
methods rejected before dispatch. The one-second test deadline uses the existing
internal constructor; the production fifteen-second setting is unchanged.

Engine `pause`/`resume`/`close` calls are tested directly. Actual Expo Activity
foreground/background/destroy event delivery, OS process death/deep sleep, TLS,
public origin activation, server idempotency, receipts, wallets, UI/account
lifecycles, storage faults and physical-device behavior remain outside this
harness. The production adapter and JS factories remain disabled.

Android's [Instrumentation API](https://developer.android.com/reference/android/app/Instrumentation)
defines the self-contained instrumentation lifecycle used here; the
[adb activity-manager documentation](https://developer.android.com/tools/adb#am)
describes the `am instrument` entry point. This harness uses those platform APIs
without introducing a second test runner or an AndroidX dependency.
