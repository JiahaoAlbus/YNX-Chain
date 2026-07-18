# Security, privacy, recovery and audit review

Reviewed 2026-07-18 for the 1.2.0 Testnet candidate.

## Authentication and authorization

- Native request, callback parsing, approval verification, request digest and P-256 product-device proof delegate to the shared canonical Wallet package.
- The edge Gateway verifies exact registry bindings, scopes, expiry and nonce once, issues an opaque scoped token, provides internal-key-protected introspection/revoke routes and rejects tamper/replay.
- The Go API accepts no address identity or locally signed assertion. Every request introspects the bearer session and verifies verifier, session/request bindings, client, bundle, account, scopes and expiry.
- Local edge replay/revocation state is in memory. A production deployment must use shared persistent storage before `gatewayDeployed` or `integratedCentral` can become true.

## Data protection and privacy

- Finance never requests seed phrases, recovery material or transaction signatures.
- Stored data is account-scoped planning state and audit metadata; atomic JSON persistence uses mode `0600`.
- Request bodies, JSON schema and source record ownership are bounded and validated. Browser policy disables camera, microphone, geolocation and payment APIs and applies CSP/frame/origin protections.
- AI context requires a privacy toggle, selected owned Explorer records and fresh consent. Draft/provider data can be cancelled or deleted; only a minimal deletion audit event remains.
- Account deletion requires exact confirmation and removes the account state while retaining only a minimal `account.deleted` audit event.

## Recovery

- The native app preserves locale, theme, pending Wallet request, device key, session and last accepted overview in platform secure storage; cached evidence is always marked offline/not live.
- Import accepts only `ynx-finance-export-v1` planning records and cannot overwrite Explorer/Pay evidence.
- The UI exposes retry, reauthorize, revoke/logout, export/import and data deletion paths. A production operator must back up, restore-test and monitor the Finance state volume; no deployment evidence exists yet.

## Dependency and release findings

- Finance Go, shared Wallet, gateway and mobile tests pass. `npm audit --omit=dev` reports 10 moderate advisories through Expo CLI/config/xcode tooling, including an old transitive `uuid`; no high or critical advisories were reported. The available automated fix incorrectly proposes the incompatible Expo 46 downgrade, so it was not applied. Upgrade/retest with an upstream Expo fix before production release.
- Expo Modules JSI 57.0.3 has a Swift 6.2 overload ambiguity in its JavaScript Date range guard. The pinned, fail-closed postinstall compatibility patch changes only `abs(milliseconds)` to the equivalent typed `milliseconds.magnitude`; it aborts installation if upstream source changes and must be removed once Expo publishes the correction.
- Android proof is locally test-signed. iOS production signing, device install, TestFlight/App Store and Play Console are not claimed.
- Remote Pay receipt access was not tested with a real credential; the 401 result demonstrates failure closure, not receipt integration success.

## Verdict

Acceptable as a local Testnet candidate and signed-out Web feasibility companion. Not acceptable to mark centrally integrated, production deployed, production signed or store released until all external gates in `product-release.json` are satisfied.
