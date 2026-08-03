# Security, privacy, recovery and audit review

Reviewed 2026-07-29 for the 1.2.0 Testnet candidate.

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
- The local state runtime now supports strict version-1 reopen plus mode-`0600`, atomic HMAC-SHA-256-authenticated backup, verification and offline restore. It rejects wrong/short keys, tampering, unknown fields, unsupported versions, unsafe same-file paths and oversized envelopes before live-state replacement.
- Restore preserves the previous raw state, records its SHA-256 and bytes, atomically installs and reopens the verified snapshot, writes a private receipt and rolls back automatically if post-write verification or receipt persistence fails.
- The UI exposes retry, reauthorize, revoke/logout, export/import and data deletion paths. A production operator must still approve retention, encrypted backup storage, RTO/RPO, remote restore drills and monitoring; no deployed restore evidence exists yet.

## Dependency and release findings

- Finance Go, shared Wallet, gateway and mobile checks pass. On 2026-07-29 a non-force lockfile-compatible update removed the high `brace-expansion` denial-of-service advisory without downgrading Expo. TypeScript, 6/6 mobile tests, and Android/iOS Hermes exports passed afterward. Ten moderate Expo CLI/config/xcode `uuid` development-tool advisories remain because npm proposes only an incompatible Expo 46 downgrade; they are tracked and are not represented as resolved.
- `govulncheck` reports zero reachable vulnerabilities in the Finance runtime and commands. The Finance security/no-placeholder gates pass.
- The supply-chain gate emits a 529-component CycloneDX mobile SBOM, third-party notices, and local unsigned input provenance bound to an exact source commit. These are local evidence, not an independent attestation or production signature.
- Expo Modules JSI 57.0.3 has a Swift 6.2 overload ambiguity in its JavaScript Date range guard. The pinned, fail-closed postinstall compatibility patch changes only `abs(milliseconds)` to the equivalent typed `milliseconds.magnitude`; it aborts installation if upstream source changes and must be removed once Expo publishes the correction.
- Android proof is locally test-signed. iOS production signing, device install, TestFlight/App Store and Play Console are not claimed.
- Remote Pay receipt access was not tested with a real credential; the 401 result demonstrates failure closure, not receipt integration success.

## Verdict

Acceptable as a centrally integrated public Testnet preview with an official-site Android download and a signed-out Web companion. It is not acceptable to call production signed or store released: final enrolled-biometric callback evidence, authorized Pay receipt smoke, production Gateway persistence/operations, iOS evidence, production signing and store review remain open in `product-release.json`.
