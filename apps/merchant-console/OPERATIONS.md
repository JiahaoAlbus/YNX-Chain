# Merchant Console operations

## Local verification

Run `npm ci && npm run check` in this directory and `go test ./internal/payproduct/...` at repository root. Run each `FuzzMerchantRBACFailsClosed`, `FuzzWebhookSignatureBindsEveryField` and `FuzzSettlementEvidenceFailsClosed` target with an explicit fuzz duration before release.

## Incident boundaries

- Settlement provider unavailable: fail the request, preserve pending invoice state, expose outage; never mark paid.
- Webhook receiver unavailable: persist bounded retry state and keep the delivery operator-visible.
- Wallet/Gateway assertion invalid, replayed, expired or scope-widened: return unauthorized without fallback auth.
- Integrity check fails: stop writes, preserve evidence, restore only from a verified copy.
- Role changes: invalidate stale role sessions; retain at least one active owner.

AI may draft and explain only. Operators must not grant it payment, refund, payout, secret rotation, role change or settlement authority.

Backup/restore automation, alert routing, status page, support/privacy/security URLs and public rollback proof remain open release gates.
