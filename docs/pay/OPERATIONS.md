# YNX Pay operations

## Deploy

1. Verify the exact source commit and clean build environment.
2. Run Go race/full suites, native client tests/typechecks/exports, merchant build, security scans, migration fixtures and restore drill.
3. Supply secrets through the approved secret manager; never through source, browser configuration or chat.
4. Apply the canonical Wallet registry and Gateway proxy manifest, then verify replay, wrong-product, wrong-bundle, wrong-device, scope widening, expiry and revocation rejection.
5. Deploy product API and merchant bundle to staging. Verify version/readiness, create an invoice and complete a real Testnet payment through Wallet approval.
6. Promote only after receipt, refund, dispute, webhook retry and rollback evidence is attached to the release record.

## Incident response

Freeze new settlement submissions if authoritative matching, store integrity or Gateway binding is uncertain. Preserve logs and audit IDs, publish an honest status, rotate only the affected server-side credential, and never mark pending invoices paid. If sponsor abuse occurs, disable the sponsor policy while leaving self-funded payment available. Recovery requires reconciliation against chain/indexer evidence before traffic resumes.

## Webhook recovery

Inspect the persisted delivery ID, payload hash, timestamp, secret version and attempt history. Manual replay requires an authorized merchant role and a new audited attempt; it does not change payment state. Exhausted deliveries remain dead-lettered until an operator action succeeds or records a terminal resolution.

## Refund and dispute support

Support records the invoice, payer, authoritative payment receipt, requested amount, reason, Trust references and timeline. A request is not a refund. Completion requires a matching authoritative refund transaction and receipt. Dispute decisions remain in the approved Trust workflow.

## Rollback

Disable ingress, take a verified backup, roll back the application artifact, and run the matching backward-compatibility check. Never roll back state by replacing it with an older snapshot. If the old binary cannot read the current schema, remain stopped and use the documented rollback migration.

