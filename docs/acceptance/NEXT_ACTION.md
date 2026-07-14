# Next Action

Current single action: deploy and prove the pushed Exchange/RPC candidate through the ordinary authoritative testnet release path without running any BFT freeze, signer installation, candidate cutover, or ingress transition.

Why this action:

- Commit `8b32606e509c` completes the deterministic testnet-only Exchange profile, signed vectors, signature-verified native transfer broadcast, exact replay, nonce/balance/fee enforcement, persistent state, exact historical block lookup, canonical receipt/null/error behavior, strict package verification, local conformance, and bounded public gap probe.
- Local verification is complete, but public release `ynx-chain-97ed0c645bd2` still lacks exact historical block behavior, canonical receipt block hashes, and `eth_getTransactionCount`; `candidatePublicRuntimeDeployed=false` is therefore correct.
- Ordinary authoritative deployment can advance real public chain capability while preserving the separately approval-gated public BFT transition.

Required behavior:

- Re-run `go test ./...`, `make test`, `make static-check`, all Exchange checks, security/env gates, full `make preflight`, and deployment-readiness checks on an exact clean commit.
- Build a release manifest bound to the exact commit and deploy with existing strict SSH, backup, checksum, follower, service-health, and rollback safeguards.
- Do not run mutation freeze, final snapshot, production signer installation, BFT candidate start, ingress switch, or public BFT cutover phases.
- Verify all four authoritative roles report the exact release and daemon checksum, height grows, and fixed-height/hash follower convergence passes.
- On public YNX Testnet only, execute the deterministic test-only signed deposit/withdrawal flow or an equivalent freshly generated disposable test-key flow; verify exact replay, nonce, balances, inclusion, canonical receipts/logs, exact block-by-height/hash, Explorer/indexer visibility, and restart persistence.
- Re-run `make exchange-live-check`; promote capability fields only from observed exact-release evidence.
- Keep `exchangeSubmitted=false`, `exchangeListed=false`, `exchangePartnership=false`, `independentExchangeVerified=false`, `mainnet=false`, and standard Ethereum RLP support false.
- Update API/exchange/acceptance documentation only after exact public evidence exists.

Files to touch:

- `scripts/deploy`, `scripts/ops`, and `scripts/verify` only if an actual deployment/proof defect requires a bounded fix
- `exchange/ynx-testnet-policy.json` and generated Exchange candidate status only after exact public capability evidence changes
- `docs/api`, `docs/exchange-listing`, and `docs/acceptance` after the public release and proof are complete
- Do not expand bounded EVM/IDE implementation files merely to increase feature coverage

Validation commands:

- `go test ./...`
- `make test`
- `make static-check`
- `make exchange-vector-check`
- `make exchange-package-integrity-check`
- `make exchange-integration-check`
- `make exchange-live-check`
- `make exchange-package`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`
- `ENV_FILE=.env.deploy make deploy-testnet`
- `ENV_FILE=.env.deploy make verify-testnet`

Completion standard:

- The exact pushed release is live on the ordinary authoritative topology with release/checksum, block growth, follower convergence, service health, and rollback evidence.
- Public testnet proof demonstrates the new signed-transfer/history/receipt/nonce behavior and Explorer/indexer visibility; local proof alone is insufficient.
- External exchange submission, listing, custody approval, production confirmation threshold, partnership, independent validation, and mainnet remain explicitly incomplete.

Explicitly not doing:

- No exchange application, paid listing, listing/partnership claim, production custody key generation, real user withdrawal, or mainnet claim.
- No claim of standard Ethereum RLP, full arbitrary EVM execution, or BFT/reorg finality.
- No bounded EVM opcode, Counter sample, Hardhat artifact, or IDE execution expansion.
- No public BFT freeze, signer install, candidate start, ingress switch, or cutover without existing independent approvals.
- Do not modify or replace the long-term goal file.
