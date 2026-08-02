# Next Action

After PR `#12` is merged, submit `release/integration/resource-market-contract.json`, `docs/integration/INTEGRATION_HANDOFF.md`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, and `docs/integration/DEPENDENCY_ACCEPTANCE.md` to Product `29` for central acceptance against Wallet/Auth, Chain settlement, Data Fabric billing, Explorer, Monitor, and Trust.

The first executable verification after central acceptance is:

1. deploy two independently operated Testnet providers;
2. execute Quote → Intent → Reservation → Service → segmented Metering → authoritative Settlement;
3. execute provider Failure → one bounded Retry → Refund/Bond/Appeal;
4. restart services and verify state recovery;
5. record authoritative transaction hashes, receipts, provider identities, health/version endpoints, and source SHA without embedding credentials.

Do not publish or mark `integratedCentral`, `testnetVerified`, `deployedPublic`, `releasePublished`, or `downloadHosted` before those direct checks succeed.
