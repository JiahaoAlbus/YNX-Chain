# Goal Digest

Final goal: deploy YNX Chain as a real, public, remotely verifiable, multi-validator Web4 L1 with YNXT economy, AI, Pay, Trust, Resource, IDE, lawful request handling, appeals, and transparent audit surfaces.

- Chain repo: `https://github.com/JiahaoAlbus/YNX-Chain`
- Chain path: `/Users/huangjiahao/Desktop/YNX Chain`
- Website repo: `https://github.com/JiahaoAlbus/YNX-Chain-website`
- Website path: `/Users/huangjiahao/Desktop/YNX-Chain-website`
- Required branch for both repos: `main`
- New testnet chain id: `ynx_6423-1`
- New EVM chain id: `6423` / `0x1917`
- Native coin name and symbol: `YNXT`

Remote servers:

- `43.153.202.237` as primary validator and public service entrypoint
- `43.134.23.58` as bonded validator, observer, recovery, and snapshot node
- `43.162.100.54` as bonded validator
- `43.164.132.81` as bonded validator and read-replica candidate

Legacy protection:

- Existing public services may still point at legacy `ynx_9102-1`.
- Do not present legacy `ynx_9102-1` as the new YNX Testnet.
- Do not replace legacy public services without backup, rollback, and verified ingress evidence.

Current highest priority:

- Replace authoritative replication with public CometBFT voting only after offline recovery, owner handover, rotation, independent custody review, and transaction approval. Keep the current public services online as the rollback boundary.
- Stablecoin issuer control commit `23a5702ec979` is persistent and locally verified, but the real deploy gate is false and no issuer support, mint/burn execution, remote service, public endpoint, or partnership exists.
- The current bounded product gap is exact-commit deployment and remote verification of the locally implemented `ynx1...` chain-account ownership/session boundary before any public Chat or Square write workflow. The existing remote Gateway remains read-only until replay, expiry, revocation, restart, state permissions, protected registration/mutation, rollback, and chain continuity are proven.
- Keep the current public services online while BFT work is incomplete. Do not deploy an unproven consensus migration or confuse authoritative replication with validator consensus.

Forbidden:

- No fabricated public proof, validators, TPS, TVL, transactions, or localhost-only completion claims.
- Do not commit private keys, pem contents, real `.env`, deployer keys, validator keys, faucet keys, or server secrets.
- Do not mix website code into the chain repo or chain/backend code into the website repo.

Final completion summary:

- Public endpoints, validators, block growth, faucet, explorer, indexer, AI, Pay, Trust, Resource, IDE, website status, monitoring, backup, rollback, security scans, and public proof must all be true and verified against the remote network.
