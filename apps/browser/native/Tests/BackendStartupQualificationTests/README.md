# Backend startup qualification adapter delta

The normal backend startup path checks the opaque qualification retained by its
existing `BrowserRouteProtection`, rather than reacquiring global diagnostic
admission. `requireBackendStartupQualification(mode:)` creates no Root, client,
backend, WebView or permission. Closed/revoked owners stay invalid, and a foreign
mode is rejected. The normal WK factory receives that same owner's admission,
with current checks before creation and before publishing the view.

Run only this new delta on macOS:

```sh
/usr/bin/python3 apps/browser/native/Tests/BackendStartupQualificationTests/test-startup-adapter.py --output "$RUNNER_TEMP/ynx-startup-qualification"
```

Artifact: `ynx-startup-qualification/**`. Independent normal/QA Core products can
be reused with `--normal-core-products /abs/Products/Debug` and
`--qa-core-products /abs/Products/Debug`. Without these options, the current Core
source is compiled together with the Native boundary; no SwiftPM/app package,
installation, GUI, backend or network operation runs.

Each normal/QA probe calls the actual normal initializer and observes NoTeam
rejection. It also runs the exact new wrapper source in a PUBLIC negative control
fixture whose underlying checker always throws. Those controls test same-mode
dispatch, fresh checks, closure and sticky failure only. They cannot construct an
opaque qualification. The factory's same-owner argument and pre/post checks are
source assertions plus actual Native compilation; an authenticated positive WK
construction is **NOT_RUN**.

Original A's genuine supplier, artifact/evidence binding and current/revocation
contract remain absent. The normal Nym proof child's separate registration,
request scope and revocation consumer are now implemented in
`RoutedNormalProofProtocol.swift` and `RoutedNormalProofAuthority.swift`. Their
signed Provider and same-parent qualification checks remain mandatory; the new
code cannot borrow Root identity or compile-only QA authority. Actual signed
deployment, DNS attribution and whole-window tests remain unverified.
