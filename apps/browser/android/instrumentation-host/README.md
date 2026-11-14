# Actual Android journey host and CI

This host code coordinates the existing QA application and independent platform instrumentation APKs. It does not create browser state, grant document permissions, inject fake activity results, issue a replacement download, clear app data, bypass TLS/CAPTCHA, or activate Private/Tor/Nym. Actual menu/DOM/SAF behavior belongs to the two original Java drivers, which are separately built from `../instrumentation` and `../instrumentation-saf`.

## Existing CI job

`.github/workflows/browser-platform-evidence.yml` extends the existing `android-install-cold-launch` job. It keeps Android36 platform/build tools, original offline checks and debug-QA packaging, then packages both instrumentation APKs using the existing public QA key. `BUILD.json` and APK SHA/certificate/target checks are required before installation. The target is only `com.ynxweb4.browser.qa`; the normal installed application and Wallet callbacks are not used.

The normal hosted Ubuntu KVM setup and these Action inputs were checked against the upstream [ReactiveCircus README](https://github.com/ReactiveCircus/android-emulator-runner#configurations) and [Action definition](https://github.com/ReactiveCircus/android-emulator-runner/blob/main/action.yml):

- API36, `google_apis`, `x86_64`, exact `avd-name: YNX_BROWSER_API_36`.
- Explicit `emulator-port: 5554`; the Action supplies `ANDROID_SERIAL=emulator-5554` to its script.
- A600-second boot budget, disabled animations/spellchecker and ordinary headless emulator options.
- One script invocation of `ci-journey.py`, with the supplied serial. The Action's [script parser](https://github.com/ReactiveCircus/android-emulator-runner/blob/v2.34.0/src/script-parser.ts) runs individual lines in separate shells; multi-line shell variables/traps must not coordinate this journey.

Both the orchestrator and original `run-phase.py` insist on the real AVD name `YNX_BROWSER_API_36`. They do not weaken that check or borrow another product device. The orchestrator also requires device SDK36 and agreement with the Action's explicit serial. The existing job has a60-minute bound and the emulator step45 minutes; each real phase is≤300seconds. There is no second CI job, remote trigger or local emulator launch in this integration.

The source packaging commands are:

```sh
python3 apps/browser/scripts/package-android-instrumentation.py \
  --source apps/browser/android/instrumentation --sdk "$ANDROID_HOME" \
  --java-home "$JAVA_HOME" --output "$RUNNER_TEMP/android-instrumentation/journey-build"
python3 apps/browser/scripts/package-android-instrumentation.py \
  --source apps/browser/android/instrumentation-saf --sdk "$ANDROID_HOME" \
  --java-home "$JAVA_HOME" --output "$RUNNER_TEMP/android-instrumentation/saf-build"
```

Every output directory must be fresh. Builds preserve javac/D8/signature stdout/stderr, source hashes and real stage outcomes. Merely building/installing a runner does not pass a browser flow.

## One sequential device operation

The Action calls:

```sh
python3 apps/browser/android/instrumentation-host/ci-journey.py \
  --adb "$ANDROID_HOME/platform-tools/adb" --serial "$ANDROID_SERIAL" \
  --output "$RUNNER_TEMP/android-instrumentation/actual-journey" \
  --target-apk "$GITHUB_WORKSPACE/apps/browser/dist/android/YNX-Browser-Debug-QA-Android.apk" \
  --journey-build "$RUNNER_TEMP/android-instrumentation/journey-build" \
  --saf-build "$RUNNER_TEMP/android-instrumentation/saf-build"
```

After exact device validation, it installs only the QA target and the two bound test APKs, cold-launches QA, and retains the actual external PrivateActivity denial plus absence of a private process. It starts `fixture-server.py` as one owned Python child, binding127.0.0.1 on an assigned ephemeral port. The receipt's `emulatorBase` is `http://10.0.2.2:PORT`. The server serves only synthetic page A/B, JS/CSS/SVG and the public HTTPS attachment link; it never serves disk/account files or a LAN listener. The same listener stays alive through cold restore.

| Phase | Required evidence and transition |
|---|---|
| journey `core` | Actual synthetic page/link/back/forward/tab/bookmark/history checks. `--require-pass`. |
| journey `https` | Actual IANA HTTPS page; raw PASS/UNREACHABLE/FAIL retained. |
| journey `search` | One real DuckDuckGo query and actual result links, or the actual challenge/refusal/unreachable status. |
| journey `search_bing` | Explicit menu selection, one real query, and a passing `restore_default_ddg_via_menu` finally step. It never follows DDG failure as an automatic fallback and does not submit another query while restoring DDG. |
| journey `restore_seed` | Actual seed tabs/selection/bookmark. `--require-pass`; a non-PASS seed means verify NOT_RUN. |
| journey `restore_verify` | Only after original QA force-stop and observed pid absence, with the same fixture URL and untouched data. `--require-pass`. |
| SAF `cancel` | Actual DocumentsUI starts, normal cancellation, unchanged empty completed library/grants. |
| SAF `save` | Only after cancel PASS. One real file save under a unique `YNX-CI-RUNID-ATTEMPT.pdf`, actual new persisted read grant and streamed byte/hash proof. |
| SAF `reopen` | Only after save PASS and exact actual save binding. Force-stop/observe QA exit without clearing data, then pass original `savedGrantSHA256`, `savedFilename`, `previousProcessStartElapsed`. No second download. |

The attachment is the public synthetic W3C `dummy.pdf`, exactly13264bytes with SHA256 `3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4`. It is fetched only by the actual product path under ordinary TLS; the host does not download substitute bytes, synthesize a content URI or confirm overwrites. A save FAIL/INCOMPLETE/UNKNOWN is preserved. `reopen` then records NOT_RUN, and neither save nor cancel is automatically replayed. Missing original grant/name/streamed SHA/byte/cold-process fields also prevent reopen.

Locale/large-text screenshots run after the actual journeys, so their exact native labels are not changed in advance. They remain visual smoke evidence, not another journey PASS. Original QA process shutdown is bounded and observed. The fixture's exact owned PID is terminated/waited (or, only if necessary, killed/waited) in finally; its2700-second maximum lifetime is a separate bound. No broad process kill, adb-server shutdown or unrelated device cleanup is used. A wrong AVD never admits target mutation/cleanup.

## Truthful outcome handling

`run-phase.py` preserves its original `RESULT.json`, raw stdout/stderr and outer timeout. `ci-journey.py` accepts exactly one final structured result with the correct schema and phase, successful transport and a recognized actual status. ADB exit0, an instrumentation result code or missing JSON is never PASS. `--require-pass` makes core/restore failure explicit. A transport timeout or malformed result becomes UNKNOWN and prevents successor UI operations until the original target is reconciled; it does not silently retry.

Each phase retains its actual status. External UNREACHABLE/CAPTCHA and SAF INCOMPLETE remain distinct from product FAIL. All requested acceptance is PASS only if all nine actual phase results are PASS, the explicit Bing finally action restored DDG, and no first/cleanup failure remains. Any other result makes the existing job nonzero and the summary `INCOMPLETE_OR_FAILED`; an unreachable outside site is never a green search/HTTPS acceptance. Local core/cold-restore PASS is separately reported so an external provider failure does not erase it. No CAPTCHA is solved, query retried, UA/exit changed, engine automatically substituted or privacy route admission inferred.

The existing always-run artifact upload includes target APK/build receipts, both instrumentation APKs and all build logs, exact driver/host sources, `inputs.json` source/APK/workflow hashes, every phase receipt/raw output, screenshots, diagnostic logcat/package output, fixture owner/reap receipt and final `SUMMARY.json`. The GitHub job summary lists actual statuses. The original result is never overwritten with a later retry. These files contain synthetic QA pages/public test queries only; they do not read ordinary user profiles.

This CI integration was locally syntax/contract validated without starting Gradle, ADB, an emulator, a GUI or remote CI. A workflow/host source change is not evidence that a future GitHub run or actual device journey passed. Nym9cf backend download success, the preserved DDG CAPTCHA and no remaining vendor handles retain their original macOS/backend scope; they are not Android privacy acceptance.
