# Actual Android SAF acceptance

This independent test APK uses only Android platform APIs. It targets the fresh synthetic
QA install `com.ynxweb4.browser.qa`; it is not a production entry. The Main component uses
package `com.ynxweb4.browser.qa` and Java class `com.ynxweb4.browser.MainActivity` (the class
does not acquire a `.qa` suffix). It must be packaged and signed
with the target's QA key. Sources are `AndroidManifest.xml` and `src/**/*.java`; there are no
resources, custom R, AndroidX or Gradle dependencies. Parent owns APK packaging, ADB, AVD and
execution. The runner itself does not shell out, grant permissions, mock results, edit
preferences, read raw file paths or invoke product download methods.

Runner component:

`com.ynxweb4.browser.qa.safinstrumentation/com.ynxweb4.browser.qa.safinstrumentation.BrowserSafInstrumentation`

Recovery-only phase `cancel_existing_picker -e expectedFilename YNX-synthetic.json` needs
no URL/hash. It does not launch Main, navigate, start a create-document intent, read files,
grant permissions or save. It first verifies the currently active allowed DocumentsUI and
its actual expected synthetic filename, then uses normal Cancel/Back and confirms disappearance.
If no picker exists, it returns INCOMPLETE without action. A new create-document start during
cleanup stops recovery; no new picker is blindly cancelled. Recovery schema is separately
`YNX_ANDROID_SAF_PICKER_RECOVERY_V1`, `recoveryOnly=true`, `businessAcceptance=NOT_EVALUATED`;
its PASS describes only successful cleanup, never the business cancel/save acceptance.

PackageManager package/system-flag lookup is optional diagnostic data. NameNotFoundException
under Android package visibility is recorded `unknown-package-visibility` and does not defeat
an actual create-document intent and allowed active DocumentsUI window. No QUERY_ALL_PACKAGES,
queries declaration or permission expansion is added. Actual readback still requires the
system-issued persisted URI grant and verifies bytes/metadata. This preserves the real first
independent httpbingo attachment picker while allowing normal cancellation/save to proceed.

The initial driver incorrectly named the unsuffixed production target. Parent's packager
safety check rejected it before build/install; the production package was not touched.
The corrected manifest, runtime target check and explicit Main component all use the QA
package. Keep that first rejection as evidence; never relax the packager target check.

All phases accept `-e phase cancel|save|reopen`, `-e downloadUrl <HTTPS attachment>`,
`-e expectedSHA <64 lowercase SHA256 hex>`. Optional `expectedBytes` is capped at 16 MiB;
`expectedFilename` defaults to the URL's last path segment; `timeoutSeconds` is 10..120,
default 90. The attachment must trigger the real WebView DownloadListener, have finite known
bytes and pass ordinary system TLS. There is no HTTP fallback or trust override.

Optional `fixturePage` first navigates the actual address UI and clicks the real accessible
link `Download synthetic PDF`. HTTP is allowed only for this parent-owned page on emulator
loopback (`10.0.2.2`, `127.0.0.1`, `localhost`); attachments must still be HTTPS. Without it,
the actual address UI navigates directly to the HTTPS attachment.

The approved public synthetic input is W3C's dummy PDF:

- `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf`
- 13,264 bytes; SHA256 `3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4`
- Suggested filename `dummy.pdf`; parent fixture is `http://10.0.2.2:54695/page-a` while its
  owned listener remains alive. The runner does not fetch from a separate HTTP client.

`cancel` and `save` first use Main's **更多 → 下载** and require an empty completed-download
list. Existing files, records, grants and UNKNOWN outcomes are never deleted. A nonblocking
platform ActivityMonitor counts the actual ACTION_CREATE_DOCUMENT start (null result,
block=false); DocumentsUI is then operated through its real accessibility tree. Cancel
uses its actual Cancel/Back, handles a first Back hiding the keyboard, and checks unchanged
empty completed records and persisted grants. Save performs an actual filename edit to a
unique `YNX-...` name (`savedFilename` argument or a generated `YNX-synthetic-PID-elapsed.pdf`),
then clicks system Save. If necessary it selects the ordinary Downloads location through
the system drawer. Disabled Save, overwrite prompts and system refusal are evidence of
failure; overwrite is never confirmed automatically.

The real QA hierarchy showed native menu rows with visible/enabled TextViews but no
ACTION_CLICK on either row or ListView. Where no click action is advertised, the driver
uses a real touchscreen DOWN/UP through public UiAutomation.injectInputEvent. The point
is derived from a refreshed exact source node in the same active and focused QA/DocumentsUI
window, clipped to that window and the real default display, checked against higher-window occlusion, then rechecked immediately
before injection. Bounds/window/package are emitted as evidence. Disabled or obscured
Save and overwrite/error UI still stop; no fixed coordinates, other-app tapping, policy
changes, automatic permission grants or unknown-action retries are allowed.

Actual cancel-v1 reached the empty download dialog before any picker/file operation, then
failed because the freshly rendered root's window ID had not yet appeared in getWindows().
Before a **new** action the driver now refreshes the same package/label control and waits
read-only for its exact active/focused application window, at most five seconds within the
phase deadline. Node/window IDs, flags and match state are emitted in `windowSync` and
`read-only-window-sync` events. This does not resend any action, relax window ownership,
wait past a disabled/refused control, create a document or repeat an UNKNOWN save.

Actual cancel-v2 passed same-window menu/list/close and empty/grants-zero baseline, then
hit ADDRESS_MISSING before any attachment/picker action because dialog dismissal was async.
Main address input now retains startActivitySync's real Activity and uses public native View
setText/performClick through runOnMainSync, with idle/read-only target awaits before input,
after actual input confirmation and before Go. Close waits for Main focus/editor and dialog
dismissal. System filename initialization/rename and keyboard/location transitions also await
their actual next UI state. No private product method, duplicate action or added fixed sleep.

Actual cancel-v3 reached the fixture and accepted its virtual WebView accessibility click,
but timed out without a document picker. That proves neither zero network traffic nor a
product download/PDF failure. The next independent run may omit `fixturePage` to use the
already implemented real Main address/Go path directly to the same HTTPS PDF; no retry,
UA/trust change or alternate exit is added.

Read-only `mainReadOnly` heartbeat/final diagnostics now report the attached active QA
WebView's public URL/originalURL/progress and actual provider package/version, plus the
native address. Only the explicit synthetic URLs are logged in full; other paths/queries
are redacted. The actual ACTION_CREATE_DOCUMENT count is retained even on timeout.
There is no public DownloadListener getter in the API36 SDK. No listener/client is replaced
to obtain a synthetic event; UI status/intent observations are not mislabeled as callback
instrumentation. An unchanged previous URL can also occur during a download navigation,
so URL/progress snapshots alone do not prove request count or TLS outcome.

The official [WebView download contract](https://developer.android.com/reference/android/webkit/WebView#setDownloadListener(android.webkit.DownloadListener))
is conditional on rendering-engine handling. Android's
[PDF viewer/PdfRenderer APIs](https://developer.android.com/develop/ui/views/layout/pdf/pdf-viewer)
describe explicit PDF viewer integration; they do not establish that this installed WebView
provider renders PDF automatically or must invoke DownloadListener. The SDK exposes no
public platform PDF-enable switch in WebSettings. Provider version and actual direct-PDF
behavior remain runtime evidence, not an Android16 assumption.

After actual product completion, only the newly issued **persisted system read grant** is
used for readback. Its actual URI is never constructed, logged or inferred from a filename.
The provider DISPLAY_NAME/SIZE, actual stream bytes and SHA256 are checked against the
renamed document and expected fixture. Main's visible completed row must match the actual
filename, source URL and byte count. Missing readable grant means no PASS for byte proof;
no alternative filesystem access is attempted.

Save JSON includes `savedFilename`, `savedGrantSHA256` (hash of actual URI only), `pid` and
`processStartElapsed`. For `reopen`, parent starts a fresh instrumentation process after
the save operation has ended (it may force-stop only the QA target), then passes
`-e savedFilename <save JSON value> -e savedGrantSHA256 <save JSON value>` and
`-e previousProcessStartElapsed <save JSON value>`. The runner requires an actually different
platform process-start timestamp, then rechecks the actual persisted read grant, file SHA
and completed row. It does not retry download or clear anything. A failed/UNKNOWN save must
be reconciled before rerunning save; using another filename is not a substitute.

Example parent invocation, after installing the separately packaged test APK:

```sh
adb -s emulator-5584 shell am instrument -w -r \
  -e phase save \
  -e downloadUrl https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf \
  -e expectedSHA 3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4 \
  -e expectedBytes 13264 -e expectedFilename dummy.pdf \
  -e savedFilename YNX-Android-SAF-20261101.pdf \
  -e fixturePage http://10.0.2.2:54695/page-a \
  com.ynxweb4.browser.qa.safinstrumentation/com.ynxweb4.browser.qa.safinstrumentation.BrowserSafInstrumentation
```

Final Bundle key **`ynx_result`** is a single JSON object with schema
`YNX_ANDROID_ACTUAL_SAF_V1` and status `PASS`, `FAIL` or `INCOMPLETE`; `safJson` is an alias.
`stream` and `safEvent` report actual progress. Shell exit zero is not PASS. Parent should
keep stdout/stderr, enforce an outer bounded command timeout, and retain first failure.
Runner/UI compilation is not a device, SAF, TLS, persistence or privacy-isolation PASS.
This module does not open Android Private/Tor/Nym admission or touch Mac acceptance.

Public API references:

- [Instrumentation](https://developer.android.com/reference/android/app/Instrumentation)
- [UiAutomation](https://developer.android.com/reference/android/app/UiAutomation)
- [SAF document access](https://developer.android.com/training/data-storage/shared/documents-files)
- [Persisted grants](https://developer.android.com/reference/android/content/ContentResolver#getPersistedUriPermissions())
- [OpenableColumns](https://developer.android.com/reference/android/provider/OpenableColumns)
