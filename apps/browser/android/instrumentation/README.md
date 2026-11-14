# Android Standard real UI journey

This standalone platform `android.app.Instrumentation` runner targets only
`com.ynxweb4.browser.qa`. It needs no AndroidX, Gradle, resources, or product-private
API. The APK must be signed with the same QA test key as the target APK. Source
compilation and synthetic classifier checks are not real-device acceptance.

The parent Browser owner builds, installs, and runs this on the dedicated Browser
AVD. Do not run on Social devices, user accounts, production packages, or shared
desktop GUI. Do not clear app data. The unified execution policy applies:
`/REDACTED_USER/Desktop/YNX Chain/docs/engineering/YNX_EXECUTION_POLICY.md`.

## Stable invocation

```sh
adb -s <BrowserAVD> shell am instrument -w -r \
  -e phase core \
  -e fixture_base http://10.0.2.2:<assigned-port> \
  -e timeout_ms 45000 \
  com.ynxweb4.browser.qa.instrumentation/com.ynxweb4.browser.qa.instrumentation.BrowserJourneyInstrumentation
```

Phases are independent invocations:

| Phase | Real actions and required evidence |
| --- | --- |
| `core` | Address input to fixture A; real touch on A's link to B; native back/forward; create/switch/close only the newly created tab; bookmark save/reopen; history row reopen. Every navigation checks the actual document marker. |
| `https` | Address input to `https://www.iana.org/domains/reserved`; actual IANA DOM and HTTPS final URL. Network/TLS failure is `UNREACHABLE`. |
| `search` | Actual menu chooses DuckDuckGo; one address-bar query; own provider URL with matching `q` plus actual result anchors. |
| `search_bing` | Explicit actual menu chooses Bing; one query; finally restore DuckDuckGo through the actual menu even if the query is unreachable or challenged. No automatic fallback and no second query on restore. |
| `restore_seed` | Actual UI opens fixture A then creates/selects fixture B and saves its bookmark; HOME invokes normal app persistence. |
| `restore_verify` | Without any initial input/navigation, require restored selected B address and DOM; switch restored A tab; open persisted B bookmark through the real list. |
| `restore_bookmark_verify` | Resume only the failed bookmark tail against the existing restored profile: open the real bookmark list, click the existing fixture B row, and verify its exact URL/DOM. No seeding, new tabs, address input, or bookmark creation. Combine this receipt with the earlier passing cold-selected-B and restored-A-tab checks; do not label the original failed invocation PASS. |
| `menu_probe` | Open the actual More menu and dump bounded QA accessibility trees/window metadata, before/after enabling interactive-window retrieval. Do not select a service or submit a query. This phase is diagnostic, not search acceptance. |
| `inspect_restored_dom` | Only observe the normally cold-restored current document, with no navigation, input, tab selection, or provider/menu change. Read at most 30 actual anchors (href/text/classes/parent/heading/result container/three ancestors), URL/title/body hash and native address. `PASS` means the diagnostic read completed; `searchAccepted=false` explicitly excludes search acceptance. A different restored URL is reported as observed, without switching or replaying a query. |

For cold restore, run `restore_seed`, then the parent must
`adb -s <BrowserAVD> shell am force-stop com.ynxweb4.browser.qa`, and run
`restore_verify` with the **same** `fixture_base`. Keep the fixture server alive.
No `pm clear`, preferences edits, direct lifecycle/private-method calls, or synthetic
restored state are used. A successful `restore_seed` alone does not prove restore.

`query` defaults to `YNX browser privacy` and accepts a nonempty string of at most
200 characters. `timeout_ms` defaults to 45000 and is clamped to 5000–120000 per
navigation. Optional `marker_a`, `marker_b`, `title_a`, and `title_b` must be bounded
nonempty strings. Use the default fixture contract unless coordinated otherwise.

## Fixture contract

`fixture_base` is restricted to an assigned `http://10.0.2.2:PORT`, port >=1024,
without credentials, path, query, or fragment.

| URL | Title | Body marker | Top visible link |
| --- | --- | --- | --- |
| `/page-a` | `YNX Fixture A` | `YNX_ANDROID_PAGE_A` | `<a id="to-b" href="/page-b">Next page B</a>` |
| `/page-b` | `YNX Fixture B` | `YNX_ANDROID_PAGE_B` | `<a id="to-a" href="/page-a">Previous page A</a>` |

The parent fixture uses margin 32px, font 20px, and link padding 24px/min-height
48px. The A→B link must fit inside the WebView viewport. The driver reads only its
geometry and reviewed href, then sends an actual pointer down/up; it never calls
DOM `click()`, assigns location, or calls `WebView.loadUrl`. Additional download
links may exist but this runner does not activate them. SAF cancel/save/readback
is implemented by the independent `instrumentation-saf/` owner.

Native actions operate on actual public target Views or QA-owned accessibility
dialog nodes. Menu lookup enables interactive-window retrieval and requires the
active, focused QA application window. It first uses exposed accessibility click
actions. The observed platform AlertDialog list rows expose no click action; for
those rows only, it refreshes the exact named, enabled, visible `android:id/text1`
child of `android:id/select_dialog_listview` and sends a normal pointer event
inside that live row's validated window/screen bounds. There are no hardcoded tap
coordinates, permission-dialog interactions, or actions outside the QA window.
Engine selection is verified by reopening the actual settings dialog and reading
its exact template; Back closes it before any query. All View reads/writes run on
the main thread. DOM inspection is
read-only `evaluateJavascript` against the actual visible WebView. There are no
HTTP clients, fake WebViews, private product calls, preference writes, TLS
overrides, user-agent changes, CAPTCHA interaction, or privacy route activation.

## Results

Each completed/failed step emits `INSTRUMENTATION_STATUS: ynx_step=<JSON>`.
The final result is both `INSTRUMENTATION_RESULT: ynx_result=<JSON>` and a
`YNX_RESULT <JSON>` stream line, schema `ynx-android-standard-ui-journey-v1`.
Read the JSON `status`, not the instrumentation transport result code.

- `PASS`: every named check in this phase observed its actual UI/DOM evidence.
- `FAIL`: driver contract, fixture, unexpected route, or product-function failure.
- `UNREACHABLE`: actual external navigation/network/TLS/refusal failure, or no
  real search result anchors within the bounded wait. This is not a functional PASS
  or proof that the provider blocked this client.
- `CAPTCHA`: visible challenge evidence; stop the query, do not solve/retry/change
  engines or exits. `search_bing` still restores DDG settings without submitting.

DOM evidence contains URL/title/readiness, body hash/length and up to 1000 body
characters, challenge/refusal flags, and result-anchor count. Search PASS requires
the explicitly selected provider's host, the submitted query in `q`, a complete
document, and actual result anchors (`a.result__a` or DDG `result-title-a`, Bing
`li.b_algo h2 a`). Unrecognized result markup remains `UNREACHABLE`, never inferred
PASS. Preserve raw output and first-cause evidence. Do not submit private queries.
`nativeMenuActions` records actual click/touch mode, live bounds/window ID where
applicable, and the selected template read from the real settings dialog.

The runner reports SAF `NOT_RUN_IN_THIS_RUNNER` and privacy `NOT_ACTIVATED`.
No Android private/Tor/Nym acceptance is inherited from macOS.

## Offline source checks

```sh
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/javac" \
  --release 8 -Xlint:-options -encoding UTF-8 \
  -cp "/REDACTED_USER/Library/Android/sdk/platforms/android-36/android.jar" \
  -d <owned-scratch>/classes \
  src/com/ynxweb4/browser/qa/instrumentation/BrowserJourneyInstrumentation.java
node tests/dom-evidence-check.cjs
```

The synthetic DOM check executes the exact read-only classifier string extracted
from the Java source. It verifies bounded refusal/challenge/result classification;
it does not execute Android or establish any real provider/network outcome.
