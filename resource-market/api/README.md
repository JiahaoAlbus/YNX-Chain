# Resource Market API

`ynx-resourced` is the deployable authenticated public boundary for Resource Market policy, quotes, delegations, rentals, income, analytics, merchant/dApp pools, and sponsored resource actions. Canonical state remains in `ynx-chaind`; a dedicated upstream key prevents direct deployed route bypass.

Local verification:

```bash
make resource-api-check
make resource-market-check
make resource-sponsor-check
```

This is locally verified deployment-package evidence. It does not claim remote deployment or public proof.

Runtime endpoints:

- `GET /resources/{address}` returns bandwidth, compute, AI Credits, Trust Credits, usage, remaining capacity, and staked YNXT.
- `GET /resource-market/quote` prices a resource rental in YNXT.
- `POST /resource-market/delegations` locks provider YNXT into resource capacity for a provider or beneficiary.
- `GET /resource-market/delegations/{address}` returns provider and beneficiary delegation records.
- `POST /resource-market/rent` rents bandwidth, compute, AI Credits, and Trust Credits from a provider or the protocol pool.
- `GET /resource-market/income/{address}` returns provider or protocol resource income records.
- `GET /resource-market/analytics` returns delegated YNXT, rental volume, provider income, protocol fees, and record counts.
- `POST /resource-market/pools` creates a signed owner-controlled merchant or dApp resource pool; `GET /resource-market/pools` and `GET /resource-market/pools/{id}` expose its policy and accounting.
- `POST /resource-market/pools/{id}/fund`, `/policy`, and `/status` require a domain-separated secp256k1 owner authorization and next account nonce.
- `POST /resource-market/sponsorships` requires the beneficiary's own signature, consumes only approved pool resources, and returns an indexed fee-`0` resource transaction with explicit payer, sponsor, pool, source, type, amount, and action reference.
- `GET /resource-market/sponsorships`, `GET /resource-market/sponsorships/{id}`, and `GET /resource-market/sponsor-audit` expose persistent sponsorship and hash-chained audit evidence.

Authoritative mode stores records in the local devnet snapshot. BFT mode accepts canonical `SignedApplicationAction` bodies for pool/sponsorship mutations, forwards the actual owner/beneficiary signature unchanged, verifies committed transaction/object evidence, and returns exact committed replay snapshots. It never lets the Resource Gateway service signer impersonate a pool owner or beneficiary. Both modes reject missing identity, insufficient resources, bad signatures/nonces, stale policy, unauthorized lifecycle changes, policy violations, exhausted allowance, duplicate action references, and changed idempotency reuse. Pool funding reserves resources only; it does not move YNXT. BFT support is locally verified but not remotely deployed or publicly proven.
