# Resource Market Engine

The local testnet engine models the YNX Chain resource economy without pretending to be final mainnet economics.

- Staking YNXT increases resource limits.
- Resource delegation locks provider YNXT and increases beneficiary capacity.
- Resource rental charges the renter in YNXT.
- Provider-backed rentals split the rental price into provider income and protocol fees.
- Protocol-pool rentals remain available for readiness checks when no external provider is configured.
- Every rental and income record is persisted in the devnet snapshot.

The current local split is 80 percent provider income and 20 percent protocol fee. Mainnet parameters require governance and public disclosure before launch.
