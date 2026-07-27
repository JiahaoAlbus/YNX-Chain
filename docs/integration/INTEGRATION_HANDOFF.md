# YNX Mail Integration Handoff

Version: 1.0.0  
Product: 25｜YNX Mail  
Branch: `codex/final-mail`  
Runtime source commit: `0e087bc1fe7f71732d28dab1a6c7414e28d424ce`  
Current stage: FREEZE → INTEGRATE  
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
- `ynx-mail-backup-v1` preserves provider recovery state and the Mail sender
  identity inside a mode-restricted encrypted operator boundary. Restore uses
  the exact validated bytes, rejects unsafe layout or key inconsistency and
  reserves the destination with no-replace semantics.
- Legacy version-1 state without provider recovery maps loads and normalizes;
  rollback by a prior binary is not yet verified.

## Verification

| Check | Result |
|---|---|
| `go test ./internal/mail` | Pass |
| `go test -race ./internal/mail` | Pass |
| `go vet ./internal/mail` | Pass |
| `npm test --prefix apps/mail` | Pass, 8/8 |
| `npm run build --prefix apps/mail` | Pass |
| `npm run smoke --prefix apps/mail` | Pass |
| `gofmt -d` on changed Go files | Clean |
| `go test ./...` | Mail passes; shared repository blocked by non-Mail owner failures recorded below |

The repository-wide failures were:

- `cmd/ynx-consensus-tx`: permissive signing-key file accepted;
- `internal/faucet` and `internal/trustgateway`: permissive key permissions accepted;
- `internal/bftgateway` and `internal/consensus`: expected Developer contract
  artifact missing.

These failures are outside the 25-mail ownership boundary and were not modified.

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
5. **26 Data Fabric** — freeze canonical Mail delivery and billing event names.
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

Current-source Android, iOS and desktop packages have not yet been rebuilt,
installed or hosted. Historical 0.2.0 artifacts remain evidence for the older
source only and must not be represented as containing this Internet Bridge.

## Exact next engineering actions

1. Emit canonical delivery events through a Data Fabric adapter with no body,
   attachment content, mailbox plaintext, credential or raw webhook leakage.
2. Add a versioned rollback export and execute an old-binary compatibility drill
   against the prior accepted Mail runtime.
3. Define a centrally authorized operator review/unsuppression path and Monitor
   alerts without granting Mail arbitrary Trust or provider administration.
4. Rebuild and reinstall current-source desktop, Android and iOS artifacts before
   restoring any hosted/download state to true.
