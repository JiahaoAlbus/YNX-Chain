# YNX Mail Integration Handoff

Version: 1.1.0  
Product: 25｜YNX Mail  
Branch: `codex/final-mail`  
Installed artifact source commit: `682bdb075803a77c9591fc59b83708944ea76fdf`  
Data Fabric implementation commit: `f6868eccc2e47a2cde137b7b4238fa6bcce3a657`  
Mail CI definition commit: `771fa4751e01d264e6e995a16fc5d458ba1021e5`  
Current stage: INTEGRATE  
Goal status: Active

## Runtime slice delivered

The Mail server now has a provider-neutral Internet Bridge with a concrete
Resend HTTPS adapter. Internet recipients no longer receive a fabricated success
or a generic unsupported result when an operator has configured the provider.
The runtime records a numbered idempotent attempt, provider message ID and a
truthful state machine:

`queued → provider_accepted | failed → provider_delayed | delivered | bounced | complained | failed`

Provider API success is never treated as delivery. Only a bounded, verified
webhook may establish receiving-mail-server delivery, bounce or complaint.
Provider open/click telemetry is persisted as ignored evidence and never becomes
YNX user-read state. Complaint, permanent-bounce and provider-suppression events
create a persistent recipient-hash suppression record. Provider failures enter a
sender-scoped dead-letter queue capped at 1000 records, while health exposes only
configuration and locally observed submission/webhook evidence.

Mail now also emits canonical `mail.*` operational events into the same
HMAC-authenticated state transaction as each Mail transition. The outbox uses a
monotonic persistent sequence, bounded pull batches and explicit acknowledgement
with compaction. It fails closed at 10,000 pending events rather than dropping
Mail evidence. The envelope contains source, authority, coverage, as-of and
truth-boundary fields, while excluding message subject/body, mailbox plaintext,
attachment names/content, account identifiers, provider credentials and raw
webhooks. Recipient and provider-event identities are hashed. No unauthenticated
public Data Fabric route was added; 26 Data Fabric, 29 Integration and 30
Security/SRE still own authenticated transport and central acceptance.

## Security and recovery properties

- Provider credentials are server-side references only and are not persisted in
  Mail state, returned by API responses or included in audit metadata.
- Webhooks use timestamp-bounded HMAC-SHA256 verification and constant-time
  comparison.
- Provider event IDs are persisted in the authenticated state envelope, making
  replay idempotent across restart.
- Older out-of-order events cannot downgrade a newer delivery fact.
- Failed and bounced deliveries may be explicitly retried with a new attempt
  number and a distinct idempotency key.
- Complaint, permanent-bounce and provider-suppression events block future
  provider submissions until a future centrally authorized review path exists.
- Dead letters expose recipient hashes rather than mailbox plaintext and are
  bounded to 1000 records.
- Webhook request bodies are capped at 256 KiB.
- Existing native delivery, Wallet replay protection, AI approval/cancel,
  account export/delete and state-tamper rejection remain intact.
- Canonical events are created atomically with Mail state, retain sequence and
  acknowledgement across restart and never infer user-read state.
- Outbox overflow aborts the Mail transaction before evidence can be dropped.
- `ynx-mail-backup-v1` preserves provider recovery state and the Mail sender
  identity inside a mode-restricted encrypted operator boundary. Restore uses
  the exact validated bytes, rejects unsafe layout or key inconsistency and
  reserves the destination with no-replace semantics.
- Legacy version-1 state without provider recovery or outbox fields loads and
  normalizes. Prior strict-decoder binaries reject the new outbox fields, so a
  versioned rollback export and exact old-binary drill are mandatory before
  public deployment.

## Verification

| Check | Result |
|---|---|
| `go test ./internal/mail` | Pass, including transactional outbox privacy/restart/ack/provider-truth vectors |
| `go test -race ./internal/mail` | Pass |
| `go vet ./internal/mail` | Pass |
| `npm test --prefix apps/mail` | Pass, 9/9 |
| `npm run build --prefix apps/mail` | Pass |
| `npm run smoke --prefix apps/mail` | Pass |
| GitHub Actions `YNX Mail CI` run `30417833956` at `771fa475` | Pass; unit, race, vet, contract, build and smoke all green |
| `npm run proof:desktop --prefix apps/mail` | Pass; exact-commit unsigned package, cold start and restart |
| Android `:app:assembleDebug` with JDK 17 and SDK 36 | Pass; debug/test signed APK |
| Android API 36 install, cold start, restart and callback route | Pass |
| `npm run check:ios --prefix apps/mail` | Pass; Swift and project/plist static verification |
| GitHub Actions iOS Simulator build/install/cold-launch/callback run `30418420264`, job `90469841717`, source `771fa475` | Pass; unsigned Simulator artifact, not physical-device or store evidence |
| `gofmt -d` on changed Go files | Clean |
| `go test ./...` | Mail passes; shared repository blocked by non-Mail owner failures recorded below |

The 2026-07-29 repository-wide failure is limited to Developer-owned
`internal/bftgateway` and `internal/consensus` IDE tests: the canonical generated
artifact `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json`
was absent. Mail passed. This missing artifact is outside the 25-mail ownership
boundary and was not fabricated or modified.

The shared placeholder and secret scan scripts are not recorded as passing on
this host: both attempted to call an unavailable `rg` binary, printed success
and exited 0. Mail performed a separate credential-marker search over its
runtime slice, but the shared gate still requires a fail-closed Security/SRE
repair before Release acceptance.

## Integration artifacts

- Contract: `release/integration/mail-contract.json`
- Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- Dependency acceptance: `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- Migration and recovery compatibility: `apps/mail/MIGRATION_COMPATIBILITY.md`
- Public product metadata: `apps/mail/public-product-metadata.json`
- Android install evidence: `apps/mail/evidence/android-install-682bdb0.json`
- Desktop install evidence: `apps/mail/evidence/desktop-install-682bdb0.json`
- Historical current-artifact-set iOS static evidence: `apps/mail/evidence/ios-verification-682bdb0.json`
- Current-source iOS cloud Simulator evidence: `apps/mail/evidence/ios-cloud-simulator-771fa47.json`
- Current release record: `apps/mail/product-release.json`
- Goal coverage: `.ai-bridge/full-goal-coverage.json`

## Central merge requests

1. **02 Wallet/Auth** — register the exact Mail tuple and expose the accepted
   verifier endpoint.
2. **14 AI** — provide the product-session POST streaming route used by selected
   Mail context.
3. **15 Trust** — accept Mail report/appeal case events and redacted evidence.
4. **20 Cloud** — provide object references and malware scanning for large
   attachments.
5. **26 Data Fabric** — accept the Mail-owned canonical envelope and define the authenticated pull/ack ingestion transport, billing mapping and replay semantics.
6. **13 Monitor** — consume provider health, delayed delivery, failure, bounce
   and complaint signals.
7. **28 Website** — publish the canonical `/mail` route only after current-source
   artifacts and public service evidence exist.
8. **29 Integration** — freeze the contract and shared Testnet merge order.
9. **30 Security/SRE** — own provider credential injection, sender-domain/DNS
   evidence, public webhook, abuse operations, backup/restore and release scans.

## External release gates

The adapter is implemented and tested locally, but no provider account,
credential reference, verified sender domain, SPF/DKIM/DMARC evidence, public
HTTPS webhook, provider terms approval, abuse desk, reputation evidence or real
sandbox delivery is currently available. These states remain false in
`product-release.json`.

Current-source Android and desktop packages are rebuilt and installed locally with exact-commit evidence, but remain local-only and are not production signed or hosted. Current-source iOS static checks pass, and GitHub Actions source `771fa475` now has unsigned Simulator build/install/cold-launch/callback evidence plus an ephemeral Actions artifact. This is not physical-device, TestFlight, immutable public download or App Store evidence. Historical 0.2.0 artifacts remain evidence for the older source only and must not be represented as containing this Internet Bridge.

## Exact next engineering actions

1. Add a versioned rollback export that strips Data Fabric outbox fields and
   execute read/start/restart/re-upgrade against the exact prior accepted Mail
   binary; do not relabel forward-load evidence as rollback evidence.
2. Hand `mail-contract.json` and `MAIL-DATA-001/002` to 26 Data Fabric and 29
   Integration for authenticated transport, replay and billing acceptance.
3. Define a centrally authorized operator review/unsuppression path and Monitor
   alerts without granting Mail arbitrary Trust or provider administration.
4. Route current-source Android, desktop and iOS Simulator artifacts through
   immutable hosting, SBOM, provenance and approved signing; then execute a
   physical-device/TestFlight path before restoring any hosted, production-signed
   or store state to true.
