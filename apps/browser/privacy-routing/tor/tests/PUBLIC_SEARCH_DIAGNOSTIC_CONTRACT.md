# Fixed PUBLIC search diagnostic candidate

This is an explicit, non-private network diagnostic, not a privacy window, manual-target authority, synthetic qualification or release approval. The only destination is the literal initial GET `https://html.duckduckgo.com/html/?q=YNX%20browser`. There is no target/query/port/profile argument or environment override. None of the production/synthetic authority or five readiness-state objects is constructed or updated. Normal Tor/Nym remain Blocked.

## Parent integration contract

Only `YNX_PRIVACY_ACCEPTANCE` builds contain `TorPublicSearchDiagnosticApplicationDelegate`:

* `static claims(bundle: Bundle = .main) -> Bool` requires exact bundle ID `com.ynxweb4.browser.qa.tor.public-search` and the CFBoolean Info value `YNXPublicSearchDiagnostic=true`.
* The default initializer starts no backend/network. As the application delegate, it creates a diagnostic-only window. The user must click **执行一次公开查询**. A second click/start is impossible for that instance.
* `shutdown() async -> Bool` and `cleanupConfirmed` cover this role's exact startup worker, Arti handle, owned view and received download-cancellation callbacks. `originalBackendPID`, `diagnosticDirectory`, `resourceDirectory`, `responseStatus`, `firstFailure` and normalized `launchFailure` expose bounded local observations.

The parent owns main dispatch and packaging. Dispatch this delegate before ordinary BrowserController only for the exact QA role. If the diagnostic ID has a missing/false/malformed marker, or another ID has the diagnostic marker, reject before ordinary restoration. A macro-off build must reject the diagnostic ID/marker using literal checks; it cannot reference the absent class. Do not register a generic URL handler or overwrite the ordinary installed app. The marker selects a fixed public test role; it is never an isolation permit.

## Traffic and interaction restrictions

The existing fixed `VerifiedSupply` loader supplies the original Arti/Lyrebird/source/bridge pins. A fresh `mkdtemp` owner-only700 subtree is passed explicitly to `prepareProfile`; only bundled public bridges are used. No ordinary or existing QA profile, history, account, Wallet/Auth state or private bridge is read. The original `ArtiProcessAdapter` owns startup and official bootstrap parsing, with a600-second bridge budget. No replacement, bridge/exit rotation or vendor rebuild is added.

Before WK creation, the existing numeric-loopback SOCKS configuration has `allowFailover=false` and a nonpersistent data store. Native content JS is off and Lockdown stays on, including every navigation-preference decision. Content rules block all resources, exempt only the exact document URL, then block cookies. Native policy separately rejects iframe/non-main navigation, popups, other requests, a second navigation, downloads, attachments, server redirects and external schemes. A read-only WK subclass suppresses normal input/context menus; policy also rejects follow-on requests triggered through accessibility. Media and file selection are explicitly denied. Only normal system TLS for the exact host is used; other authentication challenges are cancelled, with no trust override/account prompt. No app-side JS is injected for result observation.

HTTP HTML errors such as403 may render visibly for human review. The status reports HTTP code and asks the observer to distinguish results, refusal or CAPTCHA. It does not auto-complete verification or claim SearchAvailable/LeakSafe. Non-document resources stay blocked even if that prevents normal site styling. There is no alternate engine, endpoint, retry or challenge handling. The document deadline is45seconds and the whole diagnostic lifetime is690seconds. Missing rule compilation has a30-second cancellable deadline and creates no view/request.

## Cancellation and evidence limits

Closing/quit synchronously withdraws the view and timers, then closes and joins the exact existing `TorStartupOwnership` worker. Only its outer waiter may call shutdown; the worker never waits for itself. It then stops the original adapter and waits up to20seconds for actual Arti exit and received download-cancellation callbacks. Concurrent/cancelled callers join the same shutdown. Unknown retains the original handle/profile and prevents confirmed termination; a later close may retry cleanup of that original handle without another query.

The managed PT is an Arti-owned process, not this app's waitpid child. `cleanupConfirmed` does not assert individual PT reaping or all WebKit/system-process termination. Profiles are deliberately not deleted, even after Arti exits. The parent may make a read-only residual check limited to the unique diagnostic app's resource path and recorded incarnation, never kill other Tor/PT processes. Actual platform launch errors retain normalized domain/code without raw paths/bridge lines/stderr. Gatekeeper, Team/NE or other platform denial is never bypassed.

SOCKS, JS-off, native Lockdown and rules do not prove all DNS/system-assistance/UDP/QUIC/worker/download/route-loss isolation. In particular C's current official-source assessment does not establish the shipping WebKit DNS behavior from a newer main-branch fix. NoTeam is allowed for this non-private PUBLIC diagnostic only; existing privacy/canary signing guards remain untouched.

## Necessary new checks

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_public_search_diagnostic.py "$RUNNER_TEMP/ynx-public-search-diagnostic-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

The44 focused checks execute actual policy/native-action/shutdown declarations with PUBLIC in-memory view/adapter labels. They cover exact role/Boolean/query/GET/body/credential refusal, HTML-only main document, native rules, one navigation, JS/Lockdown preference reassertion, cancellation/concurrent join, late handle adoption, the actual20-second unknown-cleanup deadline and original-handle cleanup retry. They do not instantiate WK or run any vendor/network. The initial fixture-private-access compile failure remains separate; it was fixed with a test-only public wrapper. The44 are not repeated for SDK-only/source-observation additions; actual tested declarations are byte-bound to final source.

For a standalone SDK boundary check, use a fresh output and either a compatible QA Core product directory or current source:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_public_search_diagnostic_native.py "$RUNNER_TEMP/ynx-public-search-sdk-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" --current-core-sources apps/browser/native/Sources/YNXBrowserCore
```

This emits a Core module only, then typechecks the complete new file plus actual adapter/supply and exact ownership/error declarations. It never links main, builds an app or executes UI/backend. Macro-off object/nm checks show the diagnostic types are absent. The original attempt to reuse21's SDK27.0 Core under current SDK27.2 failed and is retained; current-source module fallback passed. A subsequent final-file check reuses that exact new module and passed. The callback-rule API's suggestion to use an async alternative is retained as a warning; the explicit callback+bounded polling design avoids an unbounded cancellation join. This does not claim a current full normalScope/app build or installed DDG result. The parent owns fresh-resource whole compilation, packaging, installation and the single visible test.
