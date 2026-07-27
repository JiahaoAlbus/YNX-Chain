# YNX Music 0.3.0 Testnet Preview handoff

Runtime source commit: `74716a19d95fc191b54102adc02000a91fafec24`  
Long-term status: **ACTIVE**  
Current stage: **PROTECT**

## Truthful release state

| State | Value | Direct evidence / limitation |
| --- | ---: | --- |
| implementedLocal | true | Go service, embedded Web, Android/iOS source and central adapters exist |
| testedLocal | true | Music Go, Race, smoke, Wallet contract, locale, Swift parse and Android build evidence |
| installedLocal | service/Web true; Android false; iOS false | Service smoke starts locally; current source Android/iOS install and cold-start are not proved |
| integratedCentral | false | Registry and adapters exist; no owner acceptance or deployed shared Testnet |
| deployedStaging | false | No public or staging endpoint is verified against the exact current source commit |
| deployedPublic | false | No current public Music runtime proof |
| downloadHosted | false | Local and CI build outputs exist; no immutable public download URL is verified |
| productionSigned | false | Android debug is test-signed, release APK is unsigned; no iOS distribution signature |
| storeReleased | false | No Play Store or App Store evidence |
| websitePublished | false | `/music` metadata package exists locally but Website has not accepted or published it |

No bundled commercial catalog, paid royalty finality, fake artist/listener/chart/income claim, public licensed catalog or production streaming is present.

## Product and canonical session

YNX Music is independent: product `ynx-music`, client `ynx-music-v1`, package/bundle `com.ynxweb4.music`, callback `ynxmusic://auth/callback`, chain `ynx_6423-1`, and least-privilege scopes `music.creator`, `music.library`, `music.playback`, `music.profile`.

Android and iOS create a device-bound P-256 key, submit the committed Wallet request, bind the Wallet approval, obtain a central Gateway challenge, sign the canonical challenge and exchange it for a product session. Protected API/media calls carry `X-YNX-App-Session` and `X-YNX-Product-Device-Key`; central introspection must bind identity, key, product, bundle, scope, expiry and revocation. Completion replay and unknown fields are rejected. No local session minting, long-lived browser credential or legacy bearer fallback is accepted.

The authoritative registry entry and endpoint shapes are in `apps/music/central/`. Central integration remains false until the Wallet/Auth owner accepts and deploys the exact contract and all negative vectors pass.

## Listener and creator workflows

Listener surfaces include catalog/search, track evidence, private library, favorites, history, queue, playlists, playback progress, offline-cache candidate and profile/privacy/explicit settings. Media requests are authorized and support HTTP Range. Repeat, shuffle, collaborative playlist roles and rights-expiring offline cache remain incomplete in the full coverage matrix.

Creator Studio supports onboarding, owned/licensed declaration, PCM WAV and artwork upload, provenance/evidence/territories, private draft, publish/withdraw/takedown and local Trust report/dispute/appeal. Drafts are owner-only and excluded from listener catalog results. Tests generate a repository-owned PCM tone at runtime; the product does not distribute a commercial test catalog.

Revenue allocation requires completed authenticated usage plus an external source record. Pay creates only `requires_wallet_review`; no settlement becomes paid without an accepted signed Pay receipt and canonical Billing Ledger event. AI remains proposal-only, with explicit permission and approve/reject. AI cannot publish, pay, delete, accept rights or change permissions.

## Security and persistence

The daemon uses strict JSON decoding, bounded bodies/uploads/responses, rate limits, ownership/scope checks, fail-closed central adapters, atomic mode-0600 persistence, integrity hashing and a hash-chained audit record. Trust and Pay idempotency is account-scoped and atomic; exact legacy claims replay without creating duplicates. Copy-on-write persistence prevents a failed disk save from polluting memory. Private media paths are reconstructed after restart and are not serialized into public API JSON.

Migration, rollback migration, consistent backup, restore drill, account export/delete and service-stop recovery remain incomplete.

## Platforms, CI and artifacts

Android min SDK is 28 and target SDK is 35. Current local build outputs include a debug-test-signed APK, debug instrumentation APK and unsigned release APK; hashes and byte counts are in `apps/music/ARTIFACT_MANIFEST.json`. The GitHub Android job passed and uploaded its build artifact, but current-source device/emulator install, cold start, restart and callback evidence is not yet bound.

The current host has only Command Line Tools, so local iOS evidence is limited to Swift parsing. GitHub Actions run `30277833892` bound to source commit `74716a1` produced:

- Service: success
- Android: success
- iOS Simulator: failure
- Overall workflow: failure

Therefore no current iOS artifact, install or cold-start claim exists. The iOS failure must be diagnosed and rerun.

The Web client passes local embedded smoke, but no exact-current-source public deployment is verified. macOS and Windows native delivery paths are not frozen.

## Integration and release package

- `release/integration/music-contract.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `apps/music/product-release.json`
- `apps/music/public-product-metadata.json`
- `apps/music/ARTIFACT_MANIFEST.json`
- `apps/music/EVIDENCE_INDEX.md`
- `apps/music/FEATURE_COMPLETION_EVIDENCE.md`
- `apps/music/RELEASE_NOTES.md`
- `apps/music/MIGRATION_COMPATIBILITY.md`
- `apps/music/OBSERVABILITY.md`

## Required owner actions after autonomous gates

1. Integration freezes a single contract/event version and returns explicit conflicts rather than permanent dual protocols.
2. Wallet/Auth, Pay, Trust, AI and Data Fabric accept their owned schemas and deployed negative vectors.
3. Security/SRE validates migration, restore, scans, provenance and release artifacts.
4. Rights/business owner supplies licensed catalog and territory evidence before any non-test public media claim.
5. Release owners provide signing identities, immutable hosting, deployment authority and store accounts only after unsigned/test-signed packages are complete.
6. Website consumes the local metadata and publishes `/music` without changing runtime, download, signing or store truth.
