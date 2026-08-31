# YNX Pay operations

## Deploy

1. Verify the exact source commit and clean build environment.
2. Run Go race/full suites, native client tests/typechecks/exports, merchant build, security scans, migration fixtures and restore drill.
3. Supply secrets through the approved secret manager; never through source, browser configuration or chat.
4. Apply the canonical Wallet registry and Gateway proxy manifest, then verify replay, wrong-product, wrong-bundle, wrong-device, scope widening, expiry and revocation rejection.
5. Deploy product API and merchant bundle to staging. Verify version/readiness, create an invoice and complete a real Testnet payment through Wallet approval.
6. Promote only after receipt, refund, dispute, webhook retry and rollback evidence is attached to the release record.

## Store backup and offline restore

Build the operator CLI from the exact source commit with `go build -o <controlled-bin-path>/ynx-pay-store ./internal/payproduct/cmd/ynx-pay-store`. Supply `YNX_PAY_PRODUCT_INTEGRITY_KEY` only through the approved secret-manager injection path.

1. Stop the Pay service and verify that no writer holds the store.
2. Run `ynx-pay-store verify --store <store>` and retain the JSON receipt.
3. Run `ynx-pay-store backup --store <store> --output <new-immutable-backup>`; the output path must not already exist.
4. Copy the backup and receipt to the approved encrypted retention target, then independently confirm SHA-256 and byte count.
5. For restore, keep all writers stopped and run `ynx-pay-store restore --backup <verified-backup> --store <destination>`.
6. Retain the reported verified rollback artifact. If the destination was corrupt, retain the reported quarantine artifact for incident analysis; it is not a valid rollback source.
7. Re-run `verify`, start the service in read-only acceptance mode, reconcile object counts and authoritative chain receipts, then reopen ingress.

The CLI receipts intentionally omit local absolute paths and secrets. A local fixture drill is complete; production-volume RTO/RPO and remote-retention proof are separate gates.

## Incident response

Freeze new settlement submissions if authoritative matching, store integrity or Gateway binding is uncertain. Preserve logs and audit IDs, publish an honest status, rotate only the affected server-side credential, and never mark pending invoices paid. If sponsor abuse occurs, disable the sponsor policy while leaving self-funded payment available. Recovery requires reconciliation against chain/indexer evidence before traffic resumes.

## Webhook recovery

Inspect the persisted delivery ID, payload hash, timestamp, secret version and attempt history. Manual replay requires an authorized merchant role and a new audited attempt; it does not change payment state. Exhausted deliveries remain dead-lettered until an operator action succeeds or records a terminal resolution.

## Refund and dispute support

Support records the invoice, payer, authoritative payment receipt, requested amount, reason, Trust references and timeline. A request is not a refund. Completion requires a matching authoritative refund transaction and receipt. Dispute decisions remain in the approved Trust workflow.

## Rollback

Disable ingress, take a new immutable verified backup, roll back the application artifact, and run the matching backward-compatibility check. Do not replace current state merely to make an older binary start. State rollback is permitted only as an audited recovery from a failed restore/migration, using the exact verified rollback artifact emitted for that operation and reconciling authoritative chain receipts before ingress resumes. If the old binary cannot read the current schema, remain stopped and use the documented rollback migration.
