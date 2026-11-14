# Bundled Tor intake and offline probes

Each app/helper carries its own `Contents/Resources/PrivacyBackends/Tor/`. Runtime required files are `manifest.json`, `arti`, `lyrebird`, `public-bridges.json`; distribution notice evidence stays under `LICENSES/` and must pass the separate notice-byte gate below before release. The example manifest is `bundled-tor-manifest-v1.json`. It binds the locally built publisher-source-pinned Arti2.7.0 and publisher-verified Lyrebird0.9.0 exact bytes. `public-bridges.json` is the unchanged Expert Bundle pt_config.json. No runtime profile, keys, user bridges or QA state belongs in these resources. Resigning backend bytes changes the full SHA256 and requires a separately reviewed supply revision; outer app sealing must preserve these pinned bytes.

## Fixed notice-byte supply gate

`../license_supply.py` consumes the existing packaging `read_supply()` mapping;
it performs no network requests, vendor execution, source rebuild, trust changes,
or legal interpretation. The packaging owner calls
`inspect_supply_license_materials(files)` for byte-integrity intake and records its
actual report. Formal release must additionally call
`require_release_license_coverage(files)`: `LicenseCoverageUnavailable` is a real
release failure, with the exact UNKNOWN package identities/hashes in `.report`.
An independently successful candidate intake never overrides that failure.

The current `privacy_backend_supply.py` calls this material verifier from its
Tor `read_supply` branch and records `licenseCoverage` in each Tor staging receipt.
Its explicit `read_tor_release_supply(directory)` entry calls the strict gate
before staging. The existing command-line packager remains an ad-hoc QA candidate
assembler, without formal release authority. Nym pins, its intake branch and its
staging receipt remain unchanged.

The gate pins `LICENSES/NOTICE-COVERAGE-v1.txt` by SHA256 and verifies its full
material set and hashes, exact Arti/Lyrebird bytes, fixed source/lock and selected
macOS arm64 dependency closure. It rejects a replacement self-consistent ledger,
unreviewed added notices, missing original text and any altered material. This
ledger contains no profile paths, user bridges, keys or runtime account data.

The current fixed Cargo1.92 `tree --offline --locked --target aarch64-apple-darwin
--edges normal,build` closure contains 432 packages including Arti. Of its 431
dependencies, 374 have collected original notice files or a root notice from the
same published repository commit (derive-deftly-macros); 57 remain UNKNOWN. The
root Arti license also remains UNKNOWN after exact-commit primary GitLab HTTPS
timeouts, with the earlier TLS hostname error preserved. GitHub upstream API
lookups returned rate-limit403 and were stopped. No alternate mirror or TLS
bypass was used. SPDX declarations alone are never counted as notice files.

Lyrebird's complete, unchanged publisher document from the signature-verified
Expert Bundle is now included, rather than only its project-license excerpt.
All 63 dependency module paths observed by reading the actual pinned executable's
Go build metadata have matching sections in that document (72 original license
or notice headings including subcomponents). Observed module versions do not
claim source-module checksums that the binary does not embed. Its Go1.22.12
runtime license was retrieved normally from the official fixed source tag at
`https://go.googlesource.com/go/+/refs/tags/go1.22.12/LICENSE?format=TEXT` and decoded
unchanged. The full publisher archive and selected vendor bytes remain pinned.

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/license_supply.py EXACT_TOR_SUPPLY
/usr/bin/python3 apps/browser/privacy-routing/tor/license_supply.py EXACT_TOR_SUPPLY --require-complete
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_license_supply.py EXACT_TOR_SUPPLY
```

The diagnostic CLI exits0 when collection/validation succeeds, even with an
UNKNOWN report. `--require-complete` currently exits3 for the preserved unresolved
root/57-package coverage; malformed or tampered input exits1. All are source-byte
evidence only. Legal clearance, formal distribution authority and whole-window
privacy admission remain separate and are never granted by this gate.

`BundledTorBackend.load(bundle:)` verifies a closed manifest and hardcoded hashes, bounded regular executable/config files, no hardlinks/symlinks or group/world-writable files, and public obfs4 configuration. It has no network or process action. `VerifiedSupply.prepareProfile(applicationSupport:bridgeSource:)` explicitly prepares only `YNX Browser Route State/Tor` under the current user's Application Support directory, with both dedicated components exactly0700; existing state is preserved and unsafe paths are rejected. No existing permission is silently repaired. `.privateProfileFile` reads only the dedicated profile's existing owner-only `bridges.json`, schema `{"schema":"ynx-private-tor-bridges-v1","obfs4":[...]}`. Missing/rejected files fail with distinct categories; there is no public-bridge fallback after private selection. Errors never include bridge strings.

`PreparedBackend` supplies `pin`, `directory`, `bridge`, `manifestSHA256` and `makeProvider(port:admission:)`. This constructs the existing TorRouteProvider, preserving all current admission/lifecycle checks; the default admission remains false. Supply verification/local profile preparation is not bootstrap, circuit readiness, enrollment, leak proof or user-visible Browser availability.

From the worktree root (use a dedicated scratch directory, not another owner's build scratch):

```sh
swiftc -swift-version 6 -module-name YNXBrowserCore -parse-as-library apps/browser/native/Sources/YNXBrowserCore/*.swift apps/browser/native/Sources/YNXBrowserNative/PrivacyTorPlatform.swift apps/browser/native/Sources/YNXBrowserNative/BundledTorBackend.swift apps/browser/privacy-routing/tor/tests/BundledTorBackendProbe.swift -o /tmp/ynx-p05-tor/bundled-tor-probe
/tmp/ynx-p05-tor/bundled-tor-probe
```

Default is9 synthetic fail-closed CI cases, with no dependency download, backend process, network or WebKit. Optional argument is an already prepared actual Tor resource directory: it adds10 fixed-supply/profile/provider checks (19 total), without starting a backend. Actual positive intake used the external `supply/tor/bundled-contract-v1/Tor` directory. Full absolute source paths, hashes and copy modes are in sibling `recipe.json`; it contains no profile or private bridges. Current licensing receipt separates supplied notices from unresolved complete Arti distribution licensing.

The earlier response evidence helper now also runs independently in CI:

```sh
swiftc apps/browser/privacy-routing/tor/tests/BackendResponse.swift apps/browser/privacy-routing/tor/tests/BackendEvidenceProbe.swift -o /tmp/ynx-p05-tor/backend-evidence-ci
/tmp/ynx-p05-tor/backend-evidence-ci
```

Its default17 checks use an explicitly synthetic minimal HTTP200/service-refusal fixture. An optional existing evidence directory still selects the original actual DDG200/error418 regression. This change does not rerequest that site or alter the original receipt.

`BundledTorAuditProbe.swift` is an explicit manual actual-process probe, never part of default offline CI. Compile it with the same Core/Native files above replacing BundledTorBackendProbe.swift, then provide actual resource directory and a new output directory. It launches only the fixed unchanged Arti with `permit_debugging=false`, `defer_bootstrap=true`, no bridges, no SOCKS requests/targets and a fresh synthetic private scratch state. After the official deferred signal, it gives the actual owned post-exec Process handle to OwnedBackendAuditReader with the exact artifact's designated cdhash requirement. It uses no task_for_pid, debugger, entitlement change or privilege escalation, then SIGINT/reaps the original process. Preserve negative operation/status when denied.

Actual run2026-11-01 acknowledged deferred state, obtained review-pin JSON for the actual fixed hardened Arti PID2479, then reaped exit0. This is a review pin only. That process is now dead, so its token is not valid input for a future enrollment; production must read the current owned incarnation immediately before its own reviewed enrollment flow. No system extension, route filter or Browser privacy admission was enabled.
