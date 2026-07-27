# YNX Seller Console Evidence Index

Source commit: `62d5a1833b9a901a339dc267ef78779ba793a095`

| Evidence ID | Claim | Direct evidence | Status |
|---|---|---|---|
| SC-EV-RBAC-001 | Canonical eight-role permission matrix exists and fails closed | `internal/commerce/roles.go`, `internal/commerce/roles_test.go` | testedLocal |
| SC-EV-MIGRATION-001 | Snapshot v2 `manager` migrates to Snapshot v3 `admin`; new assignments reject `manager` | `internal/commerce/store.go`, `TestSnapshotV2ManagerMigratesToAdmin` | testedLocal |
| SC-EV-CATALOG-001 | Catalog role can manage catalog but cannot mutate inventory | `TestSellerRoleCapabilitiesFailClosed` | testedLocal |
| SC-EV-INVENTORY-001 | Inventory role can mutate inventory but cannot manage catalog | `TestSellerRoleCapabilitiesFailClosed` | testedLocal |
| SC-EV-WEB-001 | Seller role selector exposes only canonical assignable roles | `apps/seller-console/index.html`, `apps/seller-console/test/ui.test.mjs` | testedLocal |
| SC-EV-BUILD-001 | Seller web bundle builds | `npm run build` in `apps/seller-console` | testedLocal |
| SC-EV-SMOKE-001 | Existing local service responds on health/capabilities | `npm run smoke` in `apps/seller-console` | local-only |
| SC-EV-CONTRACT-001 | Integration and authority boundaries are machine readable | `release/integration/seller-console-contract.json` | implementedLocal |
| SC-EV-COVERAGE-001 | Full goal requirements and blockers are tracked | `.ai-bridge/full-goal-coverage.json` | implementedLocal |
| SC-EV-PUBLIC-001 | Current source is deployed and hosted | No direct evidence | notStarted |

The historical Seller staging and Shop artifact for commit `38e2f68` are retained in `product-release.json` only as historical evidence. They do not prove the current commit is deployed.
