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

- Finish and deploy the authoritative follower replication runtime proof: every follower must expose fresh exact source/local height and hash equality, clear `catchingUp` only after authenticated revalidation, persist an integrity-validated snapshot v2, and repeat the same proof after a bounded follower restart.
- Current source implements and locally verifies that lifecycle, full-state corruption detection, v1 migration/downgrade protection, durable replacement, and follower-first deployment order, but it is not in the public release. The active public chain release remains the previously recorded authoritative release until an ordinary rollback-safe deployment succeeds.
- The latest bounded read-only cycle reached the public RPC, EVM, REST, gRPC, Faucet, Indexer, Explorer, AI, Pay, Trust, Resource, and Web4 reads and observed block growth, but Seoul accepted TCP connections without returning an SSH banner or chain HTTP response. Its peer observation became stale, so the deploy-readiness gate correctly rejected mutation. Restore and re-audit that follower before any ordinary rollout.
- Replace authoritative replication with public CometBFT voting only after offline recovery, owner handover, rotation, independent custody review, and explicit transaction approval. Keep the current public services online as the rollback boundary.
- Keep the current public services online while BFT work is incomplete. Do not deploy an unproven consensus migration or confuse authoritative replication with validator consensus.

Forbidden:

- No fabricated public proof, validators, TPS, TVL, transactions, or localhost-only completion claims.
- Do not commit private keys, pem contents, real `.env`, deployer keys, validator keys, faucet keys, or server secrets.
- Do not mix website code into the chain repo or chain/backend code into the website repo.

Final completion summary:

- Public endpoints, validators, block growth, faucet, explorer, indexer, AI, Pay, Trust, Resource, IDE, website status, monitoring, backup, rollback, security scans, and public proof must all be true and verified against the remote network.
