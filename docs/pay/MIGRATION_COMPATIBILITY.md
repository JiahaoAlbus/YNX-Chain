# YNX Pay migration and compatibility

## Current formats

- Disk envelope version: 1, HMAC-SHA-256 integrity protected.
- Snapshot version: 1.
- Invoice version: 1, merchant Ed25519 signed.
- Wallet/Gateway protocol version: 1.
- Canonical Wallet registry schema: 2.

Unknown JSON fields are rejected at API and persistence boundaries. Removed product-local Wallet challenges and sessions are deliberately not migrated; clients must establish a fresh canonical Gateway session.

## Migration contract

Any schema change requires a fixture from the previous version, forward migration, deterministic validation, a downgrade/export path, and tests proving that a failed migration leaves the original file intact. A new writer must use a new snapshot version and atomic replacement. Old clients remain supported only while their exact signed protocol version is listed in the release record.

## Backup and restore

Back up the encrypted/integrity-protected store plus its separately managed integrity and encryption keys. A restore drill must verify file hash, permissions, envelope MAC, object counts, audit continuity and read-only API behavior before traffic is enabled. “The process restarted” is not restore evidence.

## Retention, export and deletion

Payment, settlement and audit records are retained according to the approved legal policy; no duration is claimed until that policy is supplied. Merchant export must include invoices, receipts, refunds, disputes, webhook outcomes and audit IDs. Deletion requests must preserve legally required financial/audit records while removing eligible profile and endpoint data, with an auditable decision.

## Service termination

Before shutdown: stop new invoices, preserve receipt lookup, export merchant ledgers, drain or dead-letter webhooks, publish the final support/status path, allow refund/dispute evidence export, revoke Gateway registrations and retain verifiable receipt hashes for the approved period.

