# Next Action

Current single action: implement deterministic BFT IDE contract deploy/call state transitions for only the existing bounded execution subset. Do not expand opcode coverage, Counter examples, Hardhat artifacts, or general IDE execution.

Why this action:

- EVM transaction receipt/log compatibility passed fresh private four-validator proof, defect correction, four-app equality, four-signer recovery, cleanup, rollback, and post-rollback authoritative health.
- Gateway health now has fourteen implemented capabilities and one missing capability with `publicCutoverReady=false`.
- `ide-contract-state-transitions` is the final code capability gap, but the existing local IDE/Hardhat/opcode surface must not be broadened.
- The correct scope is deterministic signed persistence and evidence for already-supported bounded deploy/call behavior, not a new EVM engine.

Required work:

- Define canonical signed contract deploy and contract call action payloads with signer, chain ID, nonce, fee/resource units, artifact/source/bytecode hashes, calldata, value boundary, idempotency, and size limits.
- Persist deterministic contract metadata, runtime storage, supported storage writes, real execution logs, transaction receipts, and audit/idempotency records in AppHash.
- Reuse only existing pinned-artifact validation and bounded execution semantics; reject source-analyzer-only, unsupported opcode, unsupported ABI/storage, mismatched artifact, caller, state root, or output evidence.
- Expose ABCI queries and BFT Gateway handlers for deploy, call, contract lookup, verifier evidence, receipt, and logs.
- Make duplicate replay state/nonce/fee neutral and changed-input reuse fail closed.
- Add restart, tamper, malformed, unsupported execution, concurrent nonce, supply/resource accounting, receipt/log filter, and four-application equality tests.
- Keep `ide-contract-state-transitions` missing until local gates and a separate fresh private candidate proof/rollback pass.

Files to touch:

- `internal/consensus` for canonical actions, deterministic contract state, validation, AppHash, and queries.
- `internal/bftgateway` for committed IDE/EVM translation and evidence checks.
- `internal/chain` only to extract reusable pure helpers from the already-supported bounded execution path.
- focused checks, API docs after handlers exist, and acceptance files after verified evidence.
- No long-term goal-file rewrite and no new opcode/Counter/Hardhat/example coverage.

Validation commands:

- `go test ./...`
- `make test`
- add and run a focused BFT IDE state-transition check
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

- Supported existing bounded deploy/call paths commit deterministic state, receipts, and logs across restart and four applications without invented execution evidence.
- Unsupported artifacts, opcodes, ABI/storage paths, caller/state/hash mismatches, malformed input, and replay conflicts fail closed without state, nonce, fee, or supply drift.
- Existing native, AI, Pay, Trust, Resource, receipt/log, YNXT supply, and AppHash tests remain passing.
- Capability remains unpromoted and public cutover remains false until separate candidate proof, cleanup, rollback, and authoritative health all pass.

Explicitly not doing:

- Do not add bounded EVM opcodes, Counter behavior, Hardhat artifacts, sample contracts, or broader IDE execution.
- Do not route public RPC, DNS, Caddy, Explorer, website, or service traffic to a candidate.
- Do not claim public BFT, mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, or goal completion.
