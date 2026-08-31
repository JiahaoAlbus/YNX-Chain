# Data Fabric Migration and Compatibility

Envelope v1 remains a compatibility input while Envelope v2 is canonical.
Unknown fields and unsupported versions fail closed. Registry entries include
migration and rollback metadata; a producer cannot silently invent a schema.

The PostgreSQL repository verifies ordered migration checksums before serving.
The release record currently declares migration level 6. Store migration tests
cover legacy-state opening without state loss; backup/restore tests verify
event integrity and Ledger balance after restoration.

Candidate schemas are deliberately absent from the active Registry. Before
activation, Integration must accept one version, define migration/rollback,
receive producer/consumer compatibility receipts, and grant the Data Fabric
lease. Candidate revision does not create a client compatibility promise.
