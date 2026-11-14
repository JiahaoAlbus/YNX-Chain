# Tor entry/readiness and expired-status delta

This module fixes three reproduced defects without starting a vendor, issuing a search request, opening a window, or changing a production admission gate. The preserved counterexamples and fixed outputs are separate receipts. Existing build20/HTTPS/worker/cleanup results are reused, never relabeled as results for these new bytes.

## Fixed behavior

* `ArtiBootstrapSignalParser` formerly accepted an unrelated WARN module payload containing INFO, the proxy target, and the readiness suffix. It now accepts only a complete valid-UTF8 UTC INFO envelope with the exact upstream proxy target and literal ready/deferred message. Partial, invalid-UTF8, ANSI-decorated, wrong-level/target, prefixed-payload and extra-suffix lines do not acknowledge readiness. Raw marker hashing keeps its existing exact-line rule. The previous marker fixture now uses the actual UTC envelope instead of the synthetic timestamp word; its assertions and budgets are unchanged.
* `TorBackendResponse` formerly rejected the official HTML same-provider host and missed the exact preserved 508-byte DDG403 Tor-exit refusal. The offline diagnostic now identifies that response as service-refused. It does not infer CAPTCHA, bridge failure, or current route authorization. Transfer failure, route loss and missing TLS/proxy proof keep precedence. This test-support classifier does not change the production default search URL or select/retry any endpoint.
* `TorExternalTransport.poll()` formerly could return a replacement generation's protocolAvailable state after awaiting the old gate, and relied on a lease checked before that suspension. It now checks exact gate identity/generation and a fresh lease after the await. A stale call stops only its original gate, never the replacement. Stop withdraws the old lease callback before its first suspension.

Explicit retry remains a new user action and a newly qualified provider/protection generation after confirmed cleanup of the exact original owners. The existing provider is intentionally one-shot; no in-place restart, automatic exit rotation, direct fallback or qualification import is introduced. The parent/C own window/retry/qualification composition. Unknown cleanup retains ownership.

## Upstream basis

The fixed Arti2.7.0 published source commit is `ce8bc6e0998bd5a4efdf06dd62dce53c98ea1087`. `src/subcommands/proxy.rs:318-337` emits the exact readiness message after real bootstrap, with a distinct no-SOCKS and deferred path. `src/logging.rs:186-207` uses the full formatter, UTC timer and non-TTY stderr without ANSI; `src/logging/time.rs` defines UTC seconds with optional fractional precision. The locked tracing-subscriber0.3.23 full formatter emits timestamp, level, target and fields. Our fixed invocation uses INFO, so TRACE-only run/run_proxy span labels are absent. These files were byte-compared with the original checksum-pinned crate archives. Exact hashes and artifact paths are in the combined H.

Official references: [Arti starting guide](https://arti.torproject.org/guides/starting-arti/), [Arti troubleshooting](https://arti.torproject.org/guides/troubleshooting/), [DuckDuckGo non-JavaScript frontends](https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript). The latter establishes the same-provider HTML endpoint, not permission to evade refusal.

## Only new validation

Run from the worktree root on macOS arm64 with Swift6/minimum macOS14. Each output directory must be fresh. These independent drivers use jobs1, snapshot the actual affected declarations, record PID/exit/reap/deadline and preserve compiler/runtime output:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_readiness_envelope.py "$RUNNER_TEMP/ynx-tor-readiness-envelope-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_service_refusal_delta.py "$RUNNER_TEMP/ynx-tor-service-refusal-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_stale_transport_poll.py "$RUNNER_TEMP/ynx-tor-stale-poll-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

Observed: readiness37, refusal13 (9 synthetic plus4 immutable historical-receipt checks), stale-poll9 checks PASS. CI without the local historical receipt runs the9 synthetic refusal checks. Optional `--original-html-receipt <original receipt directory>` enforces exact body/metrics hashes before offline replay. `--legacy-counterexample` is forensic against archived pre-fix source, not a fixed-source CI mode. No old23/38/16/17/14 suites were rerun.

## Output-contract readback and limits

Arti and PT specifications keep `.discardAfterBootstrap`, omit a capture-limit override and inherit131072 bytes. The current Core validator requires that exact limit for the discard policy. Neither Tor consumer calls the short-aux `requireCompleteOutputCapture()`. The Nym-only raised cap does not widen Tor behavior. This was source readback only, not another helper/vendor execution.

All new CLI processes were reaped. The declaration-level tests are not a full Native target compile, installed build, BrowserRouteReady, LeakSafe, SearchAvailable or ReleaseApproved proof. Parent will compile the normal/QA cohort after combining the independently owned Gate/Nym changes. Production remains blocked without authentic qualification/signing/NE and whole-window acceptance. The preserved DDG refusal remains an external search failure; no new request was submitted.
