# YNX Music evidence index

Runtime source commit: `22653153c62529f782f44b0a35177b531ae7e8af`  
Release stage: **PROTECT**  
Long-term status: **ACTIVE**

Evidence is classified by what was actually proved. Local, CI, installed, central, public and production evidence are not interchangeable.

## Runtime and persistence

| Claim | Evidence | Result | Class |
| --- | --- | --- | --- |
| Music unit and integration behavior | `go test ./internal/music ./apps/music/...` | Pass locally and GitHub Actions | testedLocal |
| Concurrent state safety | `go test -race ./internal/music` | Pass locally and GitHub Actions | testedLocal |
| Local daemon health, Web shell, empty lawful catalog and fail-closed auth | `apps/music/scripts/smoke.sh` | Pass locally and GitHub Actions | installedLocal service smoke |
| Account-scoped atomic Trust and Pay idempotency | `TestTrustCaseIdempotencyIsAtomicScopedAndTamperSafe`, `TestSettlementIdempotencyIsAtomicAndTamperSafe` | Pass, including sixteen concurrent callers | testedLocal |
| Legacy idempotency compatibility | `TestAtomicIdempotencyReplaysLegacyGlobalClaims` | Pass | testedLocal |
| Failed persistence does not mutate memory | `TestMutationDoesNotLeakIntoMemoryWhenPersistenceFails` | Pass | testedLocal |
| Restart restores private media path without serializing it publicly | `TestPlaybackPositionRecoveryAndUsageIdempotency` | Pass | testedLocal |
| State tamper fails closed | `TestTamperedStateFailsClosed` | Pass | testedLocal |
| Schema-v1 golden migrates to persisted schema v2 | `TestSchemaV1GoldenMigratesAndPersistsV2` | Pass; original integrity verified before migration | migrationVerifiedLocal |
| Future, tampered or non-advancing schema migration fails closed | `TestSchemaMigrationFailsClosed` | Pass | testedLocal |
| Consistent state-and-media backup and clean restore | `TestBackupRestoreRoundTrip` | Pass with byte-for-byte media verification | restoreVerifiedLocal |
| Tampered backup and dirty destination fail closed | `TestRestoreRejectsTamperedBackupAndDirtyDestination` | Pass | testedLocal |

## Wallet, Pay, Trust and AI boundaries

| Claim | Evidence | Result | Limitation |
| --- | --- | --- | --- |
| Wallet registry and product clients match committed v2 contract | `node apps/music/scripts/central-contract-audit.mjs` | Pass locally and CI | Owner acceptance and deployed endpoints absent |
| Protected APIs require central introspection | `internal/music/server.go`, server tests | Pass local tests | Shared Testnet not run |
| Trust requests are idempotent and fail closed | Music service/server tests | Pass local and Race | Central Trust owner acceptance absent |
| Settlement is review-only | `SettlementIntent.status = requires_wallet_review` and tests | Pass | No committed Pay/Billing receipt integration |
| AI is proposal/review only | AI service/server tests | Pass | Central provider acceptance, cost telemetry and cancellation incomplete |

## Media and rights

| Claim | Evidence | Result | Limitation |
| --- | --- | --- | --- |
| Private drafts do not enter listener catalog | Music service tests | Pass | No external rights review |
| PCM WAV validation and bounded upload | Music service tests | Pass | FLAC, MP3, malware quarantine and transcode pipeline incomplete |
| Authorized HTTP Range playback | server range playback test | Pass | No CDN or signed expiring object URL |
| Rights declaration and evidence fields required | rights validation tests | Pass | License expiry/version enforcement incomplete |
| Commercial catalog not claimed | health response, smoke, public metadata | Verified false | Public licensed catalog absent by design |

## Interface, locale and accessibility

| Claim | Evidence | Result | Limitation |
| --- | --- | --- | --- |
| Twelve locale keysets and Arabic RTL | `node apps/music/scripts/i18n-audit.mjs` | 12 locales × 55 keys pass | Dynamic/provider/legal coverage remains incomplete |
| Responsive Web surfaces | Web tests and screenshots under `evidence/screenshots/web` | Local evidence present | Current-commit automated browser interaction not rerun in this slice |
| Android RTL, dark, large text and offline states | Screenshots under `evidence/screenshots/android` | Prior local visual evidence present | Screenshot source commit is not independently attested |
| Keyboard, screen reader and contrast | `UI_DESIGN_AUDIT.md` | Partially audited | VoiceOver, TalkBack and automated contrast evidence incomplete |

## Platform builds

| Platform | Evidence | Result | Signing/install truth |
| --- | --- | --- | --- |
| Android | Local Gradle 105-task build; CI Android job success; `apksigner` certificate verification | Build pass | Debug and instrumentation APKs verified with Android Debug certificate SHA-256 `d4e562…154e`; release APK returned `DOES NOT VERIFY`; current commit not installed/cold-started |
| iOS | Exact-SHA CI run `30417406111`: dynamic Simulator build, install, cold start, tampered callback rejection and restart | Pass | Unsigned Simulator evidence artifact only; no physical-device or production-signing claim |
| Web | Embedded server smoke | Pass local | No verified public deployment |
| macOS | None | Not delivered | No native artifact |
| Windows | None | Not delivered | No native artifact |

Android hashes and byte counts are recorded in `ARTIFACT_MANIFEST.json`. The files are local build outputs only; no immutable hosted URL is claimed.

## CI and remote evidence

- Workflow: `music-platforms`
- Run ID: `30417406111`
- Head SHA: `22653153c62529f782f44b0a35177b531ae7e8af`
- Service job: success, including Go, Race, smoke, central-contract and i18n gates
- Android job: success, artifact upload step success
- iOS Simulator job: success, including install, cold start, tampered callback rejection and restart
- Workflow conclusion: success
- GitHub Release: no Music release found during recovery
- Workflow artifacts are CI evidence only; no immutable hosted/public download claim is made

## Cross-owner repository preflight

`go test ./...` passed all Music packages but failed in other owners because `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json` was absent for BFT/Consensus tests. This generated DevTools artifact is outside Music ownership and blocks a repository-wide final green gate; Music did not synthesize or commit another Owner's artifact.

## Release truth files

- `product-release.json`
- `ARTIFACT_MANIFEST.json`
- `public-product-metadata.json`
- `release/integration/music-contract.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `.ai-bridge/full-goal-coverage.json`

## Explicitly absent evidence

No evidence currently proves central owner acceptance, shared Testnet E2E, a licensed public catalog, paid royalty finality, downgrade/rollback migration, remote disaster recovery with measured RTO/RPO, capacity/SLO, unit economics, threat-model closure, public runtime deployment, immutable hosted download, production signing or store release.
