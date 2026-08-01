# Merchant Console operations

## Local verification

Run `npm ci && npm run check` in this directory and
`go test ./internal/payproduct/...` at repository root. Run each
`FuzzMerchantRBACFailsClosed`, `FuzzWebhookSignatureBindsEveryField` and
`FuzzSettlementEvidenceFailsClosed` target with an explicit fuzz duration before
release.

## Runtime observation

The daemon emits structured JSON request logs to stdout. Preserve
`X-Request-ID`, `X-Trace-ID`, and `X-Error-ID` when escalating an incident; do
not copy authorization, signature, monitoring or data-operator headers. Set a
dedicated `YNX_PAY_PRODUCT_MONITOR_KEY` of at least 24 characters, then query
`GET /internal/metrics` with the same value in `X-YNX-Monitor-Key`. The snapshot
is a direct, process-local view and resets on restart; export it to an approved
metrics backend before using it for SLO measurement.

## Approved merchant deletion

Use a dedicated `YNX_PAY_PRODUCT_DATA_OPERATOR_CREDENTIAL` containing at least
24 characters. It must not equal the bootstrap, monitor, Gateway, integrity or
central-Pay credential. Send it only as `X-YNX-Data-Operator-Credential` to the
operator routes; the service fails closed when it is absent.

1. The merchant owner creates a deletion request. Record its request ID,
   `eligibleAt`, current blockers and policy version.
2. Place a legal/retention hold before or during review with
   `POST /v1/operator/merchant-data-holds` when preservation is required. An
   active hold adds `legal-hold-active` and blocks approval and execution.
3. Release a hold only with an operator ID and auditable reason after the
   authority that created it permits release.
4. After the full 168-hour cooling-off period, call the approval route with the
   exact merchant ID, operator ID and approval reference. Approval performs a
   fresh check for financial evidence, open refunds/disputes, provider
   disposition, pending deliveries, unfinished bulk work and active holds.
5. Execute with the same merchant ID, operator ID and approval reference plus a
   new idempotency key. A mismatch, changed replay or newly introduced blocker
   fails closed.
6. Verify the returned completion summary, retained redacted request/hold/audit
   evidence, and removal of local sessions and replay state. Both
   `providerDeletionClaimed` and `publicChainDeletionClaimed` must remain false.

Execution removes only eligible local Merchant Console tenant records. Provider
accounts, processor records and immutable public-chain transactions require
separate owner-specific procedures and evidence; this service never represents
them as deleted.

## Incident boundaries

- Settlement provider unavailable: fail the request, preserve pending invoice
  state, expose outage; never mark paid.
- Webhook receiver unavailable: persist bounded retry state and keep the
  delivery operator-visible.
- Webhook DNS resolves to any loopback, private, link-local, carrier-grade NAT,
  benchmark or documentation-only address, or returns a redirect: make no
  redirected/internal request and persist retry/failure evidence.
- Wallet/Gateway assertion invalid, replayed, expired or scope-widened: return
  unauthorized without fallback auth.
- Data-operator credential absent or invalid: do not place/release holds, approve
  or execute deletion.
- Cooling-off incomplete, legal hold active or retention blocker present: do not
  approve or execute deletion; preserve the request and audit the denial.
- Integrity check fails: stop writes, preserve evidence, restore only from a
  verified copy.
- Role changes: invalidate stale role sessions; retain at least one active owner.

AI may draft and explain only. Operators must not grant it payment, refund,
payout, secret rotation, role change, settlement, legal-hold or deletion
authority.

## Backup and restore

Use `go run ./internal/payproduct/cmd/ynx-pay-product-recovery` with `backup`,
`verify`, or `restore`. The integrity key is supplied only by the process
environment. A backup requires the exact source commit and will not overwrite an
existing archive. Restore requires an exact current-state SHA-256 confirmation,
automatically preserves the pre-restore bytes in a rollback file, and refuses to
run while the service lock is active. See `RECOVERY_RUNBOOK.md`.

OpenTelemetry export, durable metrics, alert routing, status page,
support/privacy/security URLs and public rollback proof remain open release
gates.
