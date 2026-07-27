# Evidence index

## Reproducible local gates

Runtime evidence source: `03a9898bff2ba7c7ec014f5531fa168b78192359`. These gates prove local candidate behavior only.

- `go test -count=1 ./internal/resourcemarket ./internal/resourceproduct ./apps/resource-market`
- `go test -race -count=1 ./internal/resourcemarket ./internal/resourceproduct`
- `TestSettlementReceiptRejectsTransactionReplayAndNormalizesReference` — rejects blank settlement authority and case-insensitive transaction-hash replay across receipts while preserving a fresh authoritative receipt path.
- `TestMarketErrorCodeContract` — freezes stable market and settlement error semantics with correlated error IDs.
- `TestResourceIntegrationContractAndVectorsStayAligned` — verifies contract owner/version/status truth, required negative vectors and runtime-to-vector error-code alignment.
- `TestSegmentedMeteringRejectsOverlapAndCumulativeOverrun` — proves two signed usage segments reconcile to the quote while pre-service, overlapping and cumulative-overrun segments fail closed.
- `TestFixedQuoteRejectsProviderSelfDealing` and the auction self-dealing branch in `TestReverseAndBatchAuctionDeterministicClearing` — reject provider-owned procurement with stable runtime semantics.
- `TestReservationsAreScopedToExactOffer` — proves a fully reserved offer cannot borrow capacity from a sibling offer and exact capacity returns on evidenced failure.
- `TestSchemaV5MigratesOfferReservationLedgerAndRejectsTamper` — derives and persists the schema 6 reservation ledger from active orders and rejects semantic ledger mismatch on restart.
- `./apps/resource-market/check.sh` — builds and runs the exact temporary binary, validates schema 6 and the HTTP 422 self-dealing code, completes the smoke flow and leaves no listener on port 16441.
- `./scripts/verify/resource-market-capacity.sh`
- `evidence/android-debug-install-20260722.json` — fresh Android debug build, package/signing inspection, emulator install and measured cold start; explicitly not production signing or full Web feature parity.
- `evidence/android-debug-cold-start-20260722.png` — SHA-256-bound screenshot of the installed Android 16 emulator surface.
- `node scripts/verify-trust-resource-wallet-vectors.mjs`

## Exact artifacts

- `evidence/local-capacity-20260722.json`: narrow local matching-read measurement.
- `integration/canonical-wallet-v1-test-vector.json`: test-only cross-product claim vector, not deployment proof.
- `integration/canonical-wallet-registry.json`: central merge input, not central integration proof.
- `product-release.json`: authoritative boolean status record.
- `FEATURE_COMPLETION_EVIDENCE.md`: requirement-level status and missing proof.
- `UI_DESIGN_AUDIT.md`: recovered UI review and screenshot references.
- `docs/handoffs/trust-resource-artifact-manifest.json`: recovered debug artifact hashes; must be regenerated after source commit.

Screenshots and test logs produced before the final source commit are design/build evidence only. Public URLs, transaction hashes, CI runs, install recordings, signed artifacts and source-commit-bound hashes are absent and therefore not claimed.
