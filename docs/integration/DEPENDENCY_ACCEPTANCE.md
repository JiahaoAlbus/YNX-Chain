# YNX AI Dependency Acceptance

Acceptance is evidence-based. A local adapter, patch, passing unit test, or document does not make a dependency centrally integrated or publicly deployed.

| Owner | Dependency | Current state | Acceptance evidence required | Failure behavior |
|---|---|---|---|---|
| 02 Wallet/Auth | AI registry tuple, canonical session verifier, active-session guard | Pending owner acceptance | Accepted registry/version/commit, CI, real Wallet callback, replay/tamper/wrong-product/wrong-bundle/wrong-device/scope/expiry/revoke vectors | Production sign-in remains fail-closed |
| 13 Monitor | Gateway/product metrics, alerts and incidents | Pending contract | Accepted metric names/labels, dashboard, alerts, incident drill and source commit | UI and health report partial/unavailable; no fake healthy state |
| 15 Trust Center | AI appeal/correction linkage | Local adapter only | Accepted case schema, evidence redaction, appeal/correction lifecycle and Testnet case | AI only drafts; no final decision or enforcement |
| 17 Economics | Fee, burn and Treasury semantics | Pending contract | Accepted fee split/version and Explorer-verifiable events | Unknown fields remain unknown; no invented economics |
| 26 Data Fabric | Usage and billing receipt events | Pending contract | Accepted event schema/version, idempotency, replay, ledger receipt and reconciliation | `actualUsageReported=false`; no fabricated charge |
| 28 Website | `/ai`, metadata, support/privacy/security/status and downloads | Pending public handoff | Deployed canonical route, immutable artifact URLs/hashes, support/privacy/security/status URLs and indexable metadata | Release remains non-public |
| 29 Integration | Protocol freeze and shared Testnet | Pending acceptance | Contract version acceptance, conflict report, merged commit and all cross-product vectors | `integratedCentral=false` |
| 30 Security/SRE | Secrets, staging, scans, provenance, backup, rollback, signing | Pending deployment | Secure references, staging URL, scan reports, provenance, restore/rollback drill, signing class and artifact manifest | No staging/public/signing claims |
| Provider | Model execution, quota and actual usage metadata | External input | Secure credential reference, provider/model/version, quota, retention terms and successful staging response | Truthful unavailable/429/timeout; no substitute answer |
| Apple build environment | iOS Simulator and signing | External input | Xcode workflow run, install/cold-start/restart/deep-link/RTL evidence, hashes and signing class | iOS remains not installed/not signed |

## Accepted local YNX AI evidence

- Generation cancellation owner binding: `a427a7558e075696265c14162d853ab23c352625`.
- Strict Gateway POST-body and stable Provider-error contract: `2678a8b0cf3f9463ec7fc205caab486993bf5f18`.
- Evidence checkpoint: `6b57d2ba630702f04d6cc1d8ec46fb51cc1df0e8`.
- Product and Gateway package/race tests pass locally.
- Release check preserves false central, staging, public, hosted, production-signing, store and live-generation states.

## Rejection rules

Dependency acceptance must be rejected when evidence relies only on a patch file, filename, HTTP 200 without business validation, mock provider, static health response, local simulator presented as production, unsigned artifact presented as signed, Testnet presented as Mainnet, or an unverified backup presented as a restore drill.

No owner may require a private key, seed phrase, PEM, signing key, provider secret, production database credential, PAN or CVV in this handoff or chat. Secure inputs must be supplied through the owner-approved secret/deployment channel.
