# Next Action

Current single action: prove the existing deterministic bounded BFT IDE deploy/call implementation on a fresh private four-validator candidate, then remove it and verify authoritative public services remain healthy. Do not expand opcode coverage, Counter behavior, Hardhat artifacts, samples, or general IDE execution.

Why this action:

- Canonical signed deploy/call actions, AppHash contract state, restart/tamper rejection, verifier evidence, receipts, real logs/bloom, filters, and four-application equality now pass locally.
- `go test ./...` and `make bft-ide-contract-check` pass.
- Remote deployment and four-validator execution have not been performed for this code, so `ide-contract-state-transitions` must remain missing and `publicCutoverReady=false`.
- Earlier native, AI, Pay, Trust, Resource, Indexer/Explorer, and non-contract EVM candidate proofs do not substitute for a fresh contract-state proof.

Required private-candidate proof:

- Export a fresh authoritative migration and build a current-HEAD candidate package without changing public routes.
- Pass the four-host absence/deploy gate and reach one common four-signer height/hash.
- Keep the owner test signer key local and reach the loopback BFT Gateway only through strict SSH forwarding.
- Commit one supported pinned bounded deployment and one supported bounded write call using canonical signed envelopes.
- Verify deterministic contract address, source/deployed-bytecode hashes, constructor storage, post-call storage, SSTORE evidence, encoded output, real LOG topics/data, receipt address boundaries, Comet block/index/gas evidence, nonzero logs bloom, and filtered `eth_getLogs`.
- Query all four ABCI applications and require byte-identical contract, receipt, log, account, nonce/resource, AppHash, and semantic digest evidence.
- Prove exact signed-transaction replay and changed-input idempotency/nonce conflicts fail without a second contract mutation, fee, or supply drift.
- Prove an unsupported call fails without state, nonce, fee, receipt, or log changes.
- Stop temporary local services/tunnels, remove remote Gateway/candidate state and release artifacts, pass the four-host absence gate, and verify public authoritative RPC/Explorer height growth and truthful status.

Files to touch:

- Candidate package/evidence output under ignored `tmp/` paths only; do not add new IDE/opcode/artifact implementation unless remote proof exposes a bounded-path defect.
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `PROJECT_STATE.md`, and `NEXT_ACTION.md` only after evidence exists.
- `internal/chain`, `internal/consensus`, or `internal/bftgateway` only for a narrowly reproduced defect in the already-supported bounded path.
- Do not modify or replace the long-term goal file.

Validation commands:

- `go test ./...`
- `make test`
- `make bft-ide-contract-check`
- `make bft-gateway-check`
- `make bft-evm-receipt-check`
- `make consensus-abci-check`
- `make consensus-signed-transfer-check`
- `make bft-resource-action-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Only after local gates and the separate private candidate proof, cleanup, rollback, four-host absence gate, and public authoritative health all pass may `ide-contract-state-transitions` move from missing to implemented.
- Promotion does not authorize public BFT cutover, DNS/Caddy changes, persistent candidate services, mainnet claims, listing claims, partnership claims, or goal completion.
- If remote proof exposes a defect, fix only the existing bounded IDE state/evidence path, rerun local gates, and repeat the private candidate proof. Do not broaden EVM scope.

Explicitly not doing:

- No new EVM opcodes, Counter behavior, Hardhat artifacts, sample contracts, source-analyzer execution, or arbitrary EVM claims.
- No public RPC, DNS, Caddy, Explorer, website, or dependent-service cutover during the private candidate proof.
- No mainnet, exchange-listing, stablecoin-issuer, wallet-default, partnership, public BFT, or goal-completion claim.
