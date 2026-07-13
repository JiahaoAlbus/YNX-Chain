# Resource Market Engine

The local testnet engine models the YNX Chain resource economy without pretending to be final mainnet economics.

- Staking YNXT increases resource limits.
- Resource delegation locks provider YNXT and increases beneficiary capacity.
- Resource rental charges the renter in YNXT.
- Provider-backed rentals split the rental price into provider income and protocol fees.
- Protocol-pool rentals remain available for readiness checks when no external provider is configured.
- Every rental and income record is persisted in the devnet snapshot.
- Merchant and dApp pools reserve explicitly funded owner resources under a signed beneficiary/scope/type/limit/expiry policy.
- Sponsored actions preserve the beneficiary's signature and nonce while consuming only pool allowance; no YNXT or user asset is moved.
- Pause, resume, revoke, exact replay, action-reference uniqueness, concurrency, restart recovery, audit chaining, and sponsor-state integrity are enforced by the authoritative runtime.

The current local split is 80 percent provider income and 20 percent protocol fee. Mainnet parameters require governance and public disclosure before launch.

Sponsor pools are locally verified in both the authoritative runtime and deterministic CometBFT/AppHash state. BFT actions require direct owner/beneficiary signatures and preserve fee-`0` resource-only accounting. Remote deployment and public proof are not claimed.
