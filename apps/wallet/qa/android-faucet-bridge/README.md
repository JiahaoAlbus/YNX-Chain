# Android Faucet bridge probe

This is a test-only first step in native bridge acceptance. It loads the original
`YnxFaucetTransport` through real Expo/Hermes, calls both synchronous reservations
and asynchronous requests, and requires the disabled-gate error to reach JavaScript.
A separate native observer reads the actual registered module's engine and
lifecycle fields. It never writes those fields or replaces an engine factory.

The ordinary Wallet entry does not import this probe. `prepare.py` requires a
clean committed QA revision whose only delta from the fixed production source is
this directory. It creates a separate worktree and records all source hashes.
Only that test copy receives the probe entry, observer module, test package ID,
test display name, disabled network permission and removal of Wallet deep links.
The original transport sources and production gates must be byte-identical.

Use a new absolute evidence directory with `python3 prepare.py --output PATH`.
Install the release-locked dependencies separately, check the SecureStore patch
and SBOM. Read `ro.product.cpu.abilist` from the selected emulator before choosing
`reactNativeArchitectures`, then build a fresh Hermes release bundle and matching
Android APK. Never assume the emulator uses the host's common desktop ABI. Sign
only with the existing local test certificate. Clear production signing variables
before running Gradle. Recheck `prepared-source.json` hashes before and after
building. The actual merged APK must have package
`com.ynxweb4.wallet.faucetbridgeqa`, no INTERNET permission, no production Wallet
deep-link handler and no production signature. Its actual packaged native ABI
must match the device readback before attempting installation.

Only install on an explicitly selected isolated emulator after checking no app
with this QA package is already present. Preserve the Wallet app and its data.
Read the `YNX_FAUCET_BRIDGE_QA_JS` and `YNX_FAUCET_BRIDGE_QA` log records from the
test process. Exercise cold launch, real Activity background/foreground and the
explicit second-run button. Record that foreground return alone does not increase
the probe batch counter. Native lifecycle observations may be asynchronous; record
the actual order and state rather than assuming callback ordering. Restore the
previous visible app and remove only this test package after preserving evidence.

Passing this probe establishes disabled-module registration, error delivery and
the recorded native lifecycle state. The removed network permission bounds this
test's effects. It does not prove an enabled bridge cancels an in-flight request,
wire timing, persistence across process restart, UIKit behavior, or public Faucet
availability. Do not change a production gate or add a caller-controlled URL to
obtain positive request coverage. Any positive fixture is a separate reviewed task.
