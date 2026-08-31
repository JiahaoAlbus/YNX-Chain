# Data Fabric Evidence Index

- Release truth: `product-release.json`, `release/release-record.json`
- Integration contract and dependencies:
  `release/integration/ynx-data-fabric-contract.json`,
  `docs/integration/INTEGRATION_HANDOFF.md`,
  `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- Envelope and registry: `schemas/data-fabric/event-envelope-v2.schema.json`,
  `schemas/data-fabric/schema-registry-v2.json`
- Transport/recovery: `internal/datafabric/dispatcher*.go`,
  `internal/datafabric/redelivery*.go`, `internal/datafabric/datafabric_test.go`
- Ledger/reconciliation: `internal/datafabric/ledger*.go`,
  `internal/datafabric/reconciliation*.go`
- PostgreSQL/JetStream capacity and resilience: `scripts/data-fabric/`, CI
  receipts recorded in the release record
- Candidate contracts: `docs/data-fabric/*CANDIDATE.md`
- External input and deployment gaps:
  `release/data-fabric/operator-inputs.request.json`

Use evidence only for the source commit it names. Historical CI and local test
receipts are not public deployment evidence.
