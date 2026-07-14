# Exchange Listing Readiness

This repository builds a deterministic, testnet-only technical candidate from `exchange/ynx-testnet-policy.json`, `chain-metadata/ynx-testnet.json`, and `testdata/exchange-signed-transactions.json`. The package binds its source commit and file digests, carries the exact RPC capability matrix and test-only signed vectors, and rejects tampering, unsafe modes, symlinks, mainnet leakage, and false status promotion.

Run:

```bash
make exchange-vector-check
make exchange-package-integrity-check
make exchange-integration-check
make exchange-live-check
make exchange-package
```

Local integration proves signature-verified deposit and withdrawal transfers, exact replay, nonce and balance behavior, committed receipts/logs, exact historical block lookup, two-confirmation fixtures, dual address representations, and restart persistence. The public read-only probe currently identifies the deployed release separately and records whether the candidate capabilities are live.

Current status remains `exchangeSubmitted=false`, `exchangeListed=false`, `exchangePartnership=false`, `independentExchangeVerified=false`, and `mainnet=false`. No market maker, liquidity, volume, user count, TVL, listing timetable, or external approval is claimed. A production listing requires independent exchange review, custody integration, an approved confirmation policy, live candidate deployment, incident/upgrade procedures, and external acceptance.
