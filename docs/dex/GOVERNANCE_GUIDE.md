# YNX DEX governance guide

The v1 pool bytecode and per-pool swap fee are immutable. Factory governance may schedule only:

- enabling or disabling creation of new pools for a token;
- changing the protocol-fee recipient;
- transferring the governance address.

Each change is public and executable only after two days. Disabling a token does not freeze existing pools or native YNXT. Governance has no pool-reserve transfer, LP confiscation, hidden mint, fee rewrite or user-freeze function.

The Testnet deployment must nominate an owner-approved multisig candidate and record signers, threshold, delay, proposal hash, execution transaction and rollback/migration plan. No such address or ceremony exists in the current environment. Mainnet governance remains unavailable until independent audit and owner approval.
