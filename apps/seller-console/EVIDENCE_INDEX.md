# YNX Seller Console Evidence Index

Source commit: `a90d1ee59eec38c15ce42b39420f2625ed758dd0`

| Evidence ID | Claim | Direct evidence | Status |
|---|---|---|---|
| SC-EV-RBAC-001 | Canonical eight-role permission matrix exists and fails closed | `internal/commerce/roles.go`, `internal/commerce/roles_test.go` | testedLocal |
| SC-EV-INVITE-001 | First Seller membership is Wallet-account-bound, one-time and cannot be bypassed by direct role update | `internal/commerce/team_invitation_test.go`, `internal/commerce/team_invitation_server_test.go` | testedLocal |
| SC-EV-REVOKE-001 | Local role revocation is immediate and regrant waits for a fully bound store-scoped Wallet receipt | `internal/commerce/roles_test.go`, `internal/commerce/role_revocation_server_test.go` | testedLocal |
| SC-EV-MIGRATION-001 | Snapshot v2 `manager` migrates to v6 `admin`; future versions fail closed | `internal/commerce/store.go`, `TestSnapshotV2ManagerMigratesToAdmin`, `TestSnapshotFutureVersionRejectedWithoutMutation` | testedLocal |
| SC-EV-ROLLBACK-001 | Explicit v3/v4/v5 rollback export is non-destructive, integrity-aware and refuses lossy state | `internal/commerce/store.go`, `internal/commerce/snapshot_rollback_test.go`, `docs/operations/MIGRATION_COMPATIBILITY.md` | testedLocal |
| SC-EV-EXPORT-001 | Exact store Owner can create an audited, store-scoped portability export without unrelated-store leakage | `internal/commerce/data_lifecycle.go`, `TestSellerDataExportIsOwnerOnlyStoreScopedAndDeepCopied`, `TestHTTPSellerDataExportRequiresCanonicalOwnerSession` | testedLocal |
| SC-EV-RETENTION-001 | Retention preview/apply removes only bounded transient state and protects authority/financial evidence | `internal/commerce/data_lifecycle.go`, `TestTransientRetentionPreviewAndPruneProtectAuthorityAndFinancialEvidence` | testedLocal |
| SC-EV-CATALOG-001 | Catalog role can manage catalog but cannot mutate inventory | `TestSellerRoleCapabilitiesFailClosed` | testedLocal |
| SC-EV-INVENTORY-001 | Inventory role can mutate inventory but cannot manage catalog | `TestSellerRoleCapabilitiesFailClosed` | testedLocal |
| SC-EV-WEB-001 | Seller role selector exposes only canonical assignable roles and invitation/revocation boundaries | `apps/seller-console/index.html`, `apps/seller-console/test/ui.test.mjs` | testedLocal |
| SC-EV-BUILD-001 | Seller web bundle builds | `npm run build` in `apps/seller-console` | testedLocal |
| SC-EV-CONTRACT-001 | Integration, authority, migration and data-lifecycle boundaries are machine readable | `release/integration/seller-console-contract.json` | implementedLocal |
| SC-EV-VECTORS-001 | Cross-product, rollback, export, retention and recovery vectors are frozen locally | `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json` | implementedLocal |
| SC-EV-COVERAGE-001 | Full goal requirements and blockers are tracked without claiming central acceptance | `.ai-bridge/full-goal-coverage.json` | implementedLocal |
| SC-EV-PUBLIC-001 | Current source is deployed and hosted | No direct evidence | notStarted |

The historical Seller staging and Shop artifact for commit `38e2f68` are retained in `product-release.json` only as historical evidence. They do not prove the current source commit is deployed.
