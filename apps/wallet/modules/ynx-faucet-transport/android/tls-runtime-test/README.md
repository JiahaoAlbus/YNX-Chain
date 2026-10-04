# Android TLS-only runtime test APK

This independent Gradle application compiles the existing, unchanged
`BoundedHttpEngine.kt` directly with `BoundedHttpsRuntimeInstrumentation.kt`.
It does not include the Wallet application, Expo adapter, React Native, accounts,
storage, or the separate HTTP runtime harness. Its self-instrumentation package
is **`com.ynxweb4.faucettransport.tlsruntimeqa`**. The production adapter and JS
factory remain disabled; their gate is not executed by this test APK.

## Build and inspect

Use the repository Gradle 9.3.1 wrapper, Java 17, Android SDK 36 and existing
cached AGP 8.12.0/Kotlin 2.1.20 dependencies. Runtime dependencies match the
existing Android project: OkHttp 4.9.2, Okio 3.16.0 and Kotlin stdlib 2.2.20.
No npm installation, new dependency, or Wallet native build is required.

From the repository root, with `JAVA_HOME` and `ANDROID_HOME` configured:

```sh
apps/wallet/android/gradlew \
  -p apps/wallet/modules/ynx-faucet-transport/android/tls-runtime-test \
  assembleDebug --offline --no-daemon --console=plain --max-workers=2 \
  -Dorg.gradle.jvmargs=-Xmx2g
```

The output relative to this directory is
`build/outputs/apk/debug/ynx-faucet-android-tls-runtime-test-debug.apk`. It uses a
debug test certificate, not the Wallet release certificate. Before installation,
retain its full SHA-256, signature verification, binary manifest, network security
configuration, resource hashes and DEX class definitions. Require the exact
self-target package, only `INTERNET`, no shared UID, and one original engine plus
one TLS runner. Expo, Wallet and the old HTTP runner must be absent. Compare the
production engine, adapter and JS entry point against the source baseline.

## Public synthetic certificates

All certificates and the server private key under `../src/androidTest/tls/res/raw`
are **public, synthetic test fixtures**. They must never secure a real endpoint.
No real credentials or CA signing keys are included. The server key is used only
by an in-memory server KeyStore/KeyManagerFactory and a server-only SSLContext.
It is never supplied to the client, set as a process-wide SSL default, or
installed in the Android system certificate store.

The test application's network security configuration trusts the test CA only
for the exact IP domain `127.0.0.1`. Cleartext is denied, including that IP. Other
domains retain platform HTTPS policy; this configuration is **not an HTTPS
firewall**. Every test URL is constructed internally from `127.0.0.1` and a
server's ephemeral port. Instrumentation arguments cannot supply a URL or turn
on production behavior. No custom client TrustManager, HostnameVerifier or SSL
socket factory is used: the original engine's OkHttp client uses Android's
application trust configuration and its normal hostname validation.

The manifest records exact fixture hashes and full certificate metadata. The
trusted and untrusted CAs are distinct. The valid, wrong-host and untrusted leaf
certificates are valid from 2020-01-01 through 2035-01-01. The expired leaf ended
on 2025-01-01. Both CAs last through 2036-01-01. Valid, expired and untrusted
leaves have IP SAN `127.0.0.1`; the wrong-host leaf has only `127.0.0.2`. No DNS
lookup or external revocation endpoint is configured. Before sending any test
request, the runner checks the device date, certificate signatures, CA separation
and exact SANs; an unsuitable device date fails the suite rather than producing
a misleading TLS result.

To create a **new** public fixture set for review, run this script with an output
directory that does not exist. It uses only Python's standard library and OpenSSL:

```sh
/usr/bin/python3 apps/wallet/modules/ynx-faucet-transport/android/tls-runtime-test/generate-public-fixtures.py \
  --openssl /usr/bin/openssl --output /absolute/new/public-fixture-directory
```

Generation creates fresh random keys and is not byte-reproducible. Normal builds
use the committed exact fixtures; they do not regenerate them. CA signing keys
exist only in the generator's temporary directory. Changing fixtures requires
reviewing SANs, validity, chain relationships, key correspondence and all hashes.

## Explicitly authorized execution only

Package review and the coordinating owner's installation gate precede execution.
The September 2026 audit authorizes **emulator-5582 only**, and only this new test
package. First verify it is absent; never replace an existing package, install
with `-r`, clear application data, change system certificates, or touch 5580.
Record Wallet's original version/hash and language/font/theme/locked state.

```sh
adb -s emulator-5582 shell pm path com.ynxweb4.faucettransport.tlsruntimeqa
adb -s emulator-5582 install /absolute/path/to/verified-tls-test.apk
adb -s emulator-5582 shell am instrument -w -r \
  com.ynxweb4.faucettransport.tlsruntimeqa/com.ynxweb4.faucettransport.BoundedHttpsRuntimeInstrumentation
adb -s emulator-5582 shell run-as com.ynxweb4.faucettransport.tlsruntimeqa \
  cat files/tls-runtime-result.json
```

Preserve complete stdout/stderr and the result JSON, including failed attempts.
Require seven records, `passed: 7`, `failed: 0`, `suiteComplete: true`, the exact
package/API/ABI/fingerprint, and `INSTRUMENTATION_CODE: -1`. A zero adb exit code
alone does not establish a pass. Read back the installed test base APK's full
SHA-256. After evidence capture, including after failures, uninstall **only the
test package installed by this run**, verify its absence and preserve Wallet:

```sh
adb -s emulator-5582 uninstall com.ynxweb4.faucettransport.tlsruntimeqa
adb -s emulator-5582 shell pm path com.ynxweb4.faucettransport.tlsruntimeqa
```

## Evidence and limits

The seven cases check fixture/application policy, successful trusted TLS delivery
of the exact original synthetic POST, untrusted CA rejection, wrong IP SAN
rejection, expired certificate rejection, HTTPS 307 without following a TLS
target, and HTTPS 307 without following a cleartext downgrade target. Negative
certificate cases require an accepted TLS socket but **zero decrypted HTTP
bytes and zero POSTs**, in addition to the engine's network failure. TLS handshake
bytes are expected and are not counted as HTTP body bytes. Redirect cases require
the engine's redirect error, one original POST and no target request; the
downgrade target separately records accepted plain sockets.

The server uses actual Android SSLServerSocket/SSLSocket and the client uses the
original engine and Android's default TLS behavior. Client dispatcher observation
is read-only. No public request is allowed by the fixed call graph; the report's
zero-public field is not a packet-capture firewall assertion. The test address
has no account/key and the amount 100 is synthetic input, not an activated claim
limit or a claim of funds received.

This suite does not rerun the twelve HTTP/runtime cases. It does not verify a
production origin, certificate pinning, server admission/idempotency, signed
receipts, funds, Expo Activity lifecycle delivery, physical hardware, system-wide
TLS configuration, or production activation. The application-level body bound
and timeout remain those of the unchanged engine; this suite adds certificate
and HTTPS redirect evidence rather than claiming TLS allocates at most 16 KiB.

Android documents application-scoped trust in
[Network Security Configuration](https://developer.android.com/privacy-and-security/security-config)
and its server TLS API in
[SSLServerSocket](https://developer.android.com/reference/javax/net/ssl/SSLServerSocket).
