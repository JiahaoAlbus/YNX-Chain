# Security Boundaries

The authoritative YNXT state is consensus state. Explorer and Gateway may expose it but cannot replace it. Reference simulations are deterministic estimates and cannot mint, burn, slash, transfer, govern or sign. The browser receives no private key, seed, validator key, Treasury signer or YUSD operator secret.

YUSD sandbox state is isolated from consensus and stablecoin issuer state. Its units have no real-world value; reserve deposits are operator-provided test evidence, not custody or attestation. Authentication grants only sandbox mutation routes and is not a Wallet identity or wildcard platform token. Pause blocks mint and fulfillment while redemption requests remain an exit queue.

Treasury, liquid staking, fee-market and security-pool candidates have no runtime activation path. Their outputs remain simulation-only until versioned consensus/contracts, governance/timelock, audit, Wallet approval, migration/rollback, Explorer events and public evidence exist. AI has no execution authority in these modules.

Deployment, DNS, monitoring, support URLs, secure signers, custody and public funding remain outside this worktree's authority. Local tests and unsigned builds cannot set staging, public, hosted, production-signed or store-release states true.
