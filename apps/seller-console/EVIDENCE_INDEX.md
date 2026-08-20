# YNX Seller Console Evidence Index

Source commit: `2bfa3d3d7923410b02e02c9d243ef70e88653c66`

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
| SC-EV-WALLET-P0-001 | Standard EIP-6963/EIP-1193 source prefers YNX, supports other EVM wallets and preserves the connection when private service degrades | `standard-wallet.js`, `test/standard_wallet.test.mjs` | testedLocal |
| SC-EV-BROWSER-P0-001 | English-first desktop and 390x844 guest/degraded UI render without console errors or horizontal overflow | `evidence/p0-wallet-connectivity-local-browser-20260821.json` | localBrowserVerified |

The historical Seller staging and Shop artifact for commit `38e2f68` are retained in `product-release.json` only as historical evidence. They do not prove the current commit is deployed.
