# Resource Market API

Runtime endpoints:

- `GET /resources/{address}` returns bandwidth, compute, AI Credits, Trust Credits, usage, remaining capacity, and staked YNXT.
- `GET /resource-market/quote` prices a resource rental in YNXT.
- `POST /resource-market/delegations` locks provider YNXT into resource capacity for a provider or beneficiary.
- `GET /resource-market/delegations/{address}` returns provider and beneficiary delegation records.
- `POST /resource-market/rent` rents bandwidth, compute, AI Credits, and Trust Credits from a provider or the protocol pool.
- `GET /resource-market/income/{address}` returns provider or protocol resource income records.
- `GET /resource-market/analytics` returns delegated YNXT, rental volume, provider income, protocol fees, and record counts.

The API stores records in the local devnet snapshot and returns explicit errors for missing address, insufficient balance, or providers with no active delegated resources.
