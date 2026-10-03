# Quant Paper settlement integer fences

Ordinary owner scope only: internal/quantlab business implementation/tests. Parent source: 4064d3a7c591e1214ee25b51a1847fdc21465e0d. No shared Wallet/SDK, endpoint authority, formal release pins or Host changes.

## Reproduction and correction

Controlled persisted legacy-state fixtures reproduced three unsafe admissions before the fix: selling with cash at MaxInt64 wrapped cash negative; buying with cash at MinInt64 wrapped cash positive; a MinInt64 position passed the absolute-value position limit. All three initially returned nil error.

Paper now calculates next position and cash with exact integer arithmetic before changing daily risk, sequence, orders or audit. Out-of-limit position and unrepresentable cash fail closed. Existing fill and fee/slippage semantics are unchanged; no real-capital execution added. Rejected fixture operations retain the exact memory and reopened durable state hashes.

The earlier suspected replay truncation issue was not present: orders are capped at 100 rather than truncated. No new idempotency store was introduced.

## Executed gates

- gofmt on the two changed Go files; git diff --check PASS.
- go test -race ./internal/quantlab -count=1: PASS, 2.515s. Optional PostgreSQL integration remains unconfigured; this is not distributed database acceptance.
- node --test apps/quant-lab/tests/research-recovery-browser.test.mjs: 1/1 PASS, 7004.510333ms. Actual Go service, two independent browser contexts, controlled tape, three clean SIGTERM stops.
- Retained local browser evidence: /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-H6ynbX.
- Local test binary: 11467138 bytes; SHA256 38b3cfd3d99fb4a18e541ff5ae8faa337db88c6ed9d25bcb295a44a9a4a3517b. Not a formal installer/release artifact.

## Remaining gates

publicVerified=false; installedVerified=false; walletApproval=false; realOrders=false; migratedV2=false. Formal integration/publication belongs to A release owner through the active coordinator. PostgreSQL multi-process validation still needs a disposable database. No production credentials, signing, account approval or transaction were requested or used.
