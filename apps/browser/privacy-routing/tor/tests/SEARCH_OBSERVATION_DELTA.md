# Routed search observation lifetime delta

Three preserved counterexamples execute the original `RoutedBrowserPage` observation/navigation methods with PUBLIC in-memory WebKit/route doubles: an old JS callback publishes ready after a new same-URL navigation; a callback publishes ready after route authorization is withdrawn; five empty observations leave SearchAvailable checking indefinitely. The counterexamples do not instantiate WebKit or exercise any network.

The fixed Native page gives each observation/navigation a fresh UUID, checks the exact active navigation as well as view/URL identity, and invalidates old work synchronously for load/back/forward/reload, permitted main-frame navigation, provisional start, failure and close. Public same-URL/reused-object identity cannot substitute for that generation. It rechecks current protection before JS evaluation, when the callback returns and immediately before publication. A recording callback may itself revoke the session; status text then cannot overwrite the blocked page.

The existing visible-result/challenge DOM classifier is unchanged. Only a nonempty query can be observed as search. A home page with no query is notRun. Five samples at one-second intervals plus one final callback interval bound the observation to approximately five seconds while the actor remains schedulable. Empty, invalid or unanswered DOM observations finish as SearchAvailable.failed with an explicit unverified-result reason; this does not assert network/engine failure, alter TransportReady/LeakSafe/ReleaseApproved, or retry. Terminal publication withdraws pending callbacks. A challenge remains a website blocked state and never a route-safety verdict. New navigation/reload creates a new generation; it does not reuse a cancelled callback.

Run the new focused driver from the worktree root on macOS with a fresh absolute scratch path:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_search_observation_delta.py "$RUNNER_TEMP/ynx-search-observation-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

The driver snapshots actual observation/navigation declarations and records exact compiler/runtime commands, PID, deadline, exit, reap, source hashes and stdout/stderr. Target architecture uses `platform.machine()`, minimum macOS14, Swift6 and jobs1. The fixed run passed12 checks. The archived pre-fix run passed3 bug-reproduction assertions separately; `--legacy-counterexample` is not a fixed-source CI mode. No prior Tor/backend/86/37/13/9 group was rerun. Actual WK, installed DDG results and full route/leak acceptance remain NOT_RUN. The parent owns whole Native compilation/packaging, CI and the updated22 page pin.

## Existing installed-QA purpose boundary

Normal compilation rejects protected-acceptance arguments before AppKit startup. The separately compiled QA dispatcher requires signing preflight, exact private launch inputs and a dedicated routed role. Its real path is `openAcceptanceRoute` → `ProtectedSyntheticWindowController` → `BrowserRouteProtection.prepareAcceptance` → actual self/WebKit canaries → typed Tor provider → actual backend graph/resume/official marker → `PrivacySyntheticTrialSession` → `makeSyntheticWebView` → reviewed bootstrap/explicit synthetic phases.

That authority permits only two controlled origins, the exact run nonce path and known probe query. Session URL policy, opaque authority validation and native WK content rules all narrow the same scope. The address field is disabled and ordinary `load` only accepts a production `PrivacyRouteSession`. SearchAvailable explicitly reports that DDG/user queries are outside the synthetic role. Existing Core tests already reject DDG input; they are reused rather than repeated. This search-observation fix adds no manual-public-target authority and does not change those boundaries.

A visible DDG search trial would need a distinct authenticated, expiring, purpose-specific manual-target authority and entry: the exact initial HTTPS query, one explicit human attempt, exact window/backend/Root binding and permitted subresource/redirect behavior. It cannot be minted from the synthetic scope or promoted into ordinary production permission. Public SOCKS no-failover, nonpersistent data storage and native Lockdown are configured, but those settings alone are not asserted as proof of all DNS/UDP/QUIC/worker/download/route-loss isolation. C owns the separate current official-source assessment; no Team/NE/platform restriction is bypassed. Without a proved independent isolation path, that real installed-DDG action remains blocked.
