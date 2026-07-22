# Merchant Console operations

## Local verification

Run `npm ci && npm run check` in this directory and `go test ./internal/payproduct/...` at repository root. Run each `FuzzMerchantRBACFailsClosed`, `FuzzWebhookSignatureBindsEveryField` and `FuzzSettlementEvidenceFailsClosed` target with an explicit fuzz duration before release.

## Runtime observation

The daemon emits structured JSON request logs to stdout. Preserve `X-Request-ID`, `X-Trace-ID`, and `X-Error-ID` when escalating an incident; do not copy authorization or signature headers. Set a dedicated secret `YNX_PAY_PRODUCT_MONITOR_KEY` of at least 24 characters, then query `GET /internal/metrics` with the same value in `X-YNX-Monitor-Key`. The snapshot is a direct, process-local view and resets on restart; export it to an approved metrics backend before using it for SLO measurement.

## Incident boundaries

- Settlement provider unavailable: fail the request, preserve pending invoice state, expose outage; never mark paid.
- Webhook receiver unavailable: persist bounded retry state and keep the delivery operator-visible.
- Wallet/Gateway assertion invalid, replayed, expired or scope-widened: return unauthorized without fallback auth.
- Integrity check fails: stop writes, preserve evidence, restore only from a verified copy.
- Role changes: invalidate stale role sessions; retain at least one active owner.

AI may draft and explain only. Operators must not grant it payment, refund, payout, secret rotation, role change or settlement authority.

## Backup and restore

Use `go run ./internal/payproduct/cmd/ynx-pay-product-recovery` with `backup`, `verify`, or `restore`. The integrity key is supplied only by the process environment. A backup requires the exact source commit and will not overwrite an existing archive. Restore requires an exact current-state SHA-256 confirmation, automatically preserves the pre-restore bytes in a rollback file, and refuses to run while the service lock is active. See `RECOVERY_RUNBOOK.md`.

OpenTelemetry export, durable metrics, alert routing, status page, support/privacy/security URLs and public rollback proof remain open release gates.
