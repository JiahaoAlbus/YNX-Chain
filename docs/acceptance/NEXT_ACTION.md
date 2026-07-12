# Next Action

Current single action: prove the locally implemented BFT EVM transaction receipt/log compatibility surface on a fresh private four-validator candidate, then clean up and roll back. Keep bounded opcode, Counter, Hardhat artifact, and IDE execution expansion paused.

Why this action:

- Committed transaction lookup and receipts are now locally derived from Comet transaction proof, block membership, transaction index, `gas_used`, and cumulative `/block_results` evidence.
- Current BFT envelopes do not execute EVM `LOG` opcodes. `eth_getLogs` therefore returns a truthful empty array after strict retained-range, address, and topic validation; it does not import local devnet contract logs.
- Local tests and `make bft-evm-receipt-check` pass, but Gateway health must remain thirteen implemented/two missing with `publicCutoverReady=false` until remote candidate evidence passes.
- IDE contract state transitions remain the final later gap and must not be conflated with receipt/log compatibility.

Required work:

- Export a fresh authoritative migration anchor without interrupting the public chain.
- Deploy the candidate only on existing private candidate ports and paths; do not change public ingress or authoritative services.
- Commit at least one native transfer and one signed application action, then verify `eth_getTransactionByHash` and `eth_getTransactionReceipt` against direct Comet transaction/block/block-result evidence.
- Verify transaction index, block hash/height, status, gas, cumulative gas, sender/recipient boundary, empty logs, zero bloom, and unknown transaction `null` behavior.
- Verify malformed hash, malformed/overbroad block range, pending/out-of-retained-history block tags, invalid address/topic, and inconsistent upstream evidence fail closed.
- Verify four application states/AppHashes and four-signer progress remain equal after the proof.
- Stop all temporary components, remove candidate artifacts, roll back all four roles, rerun candidate absence gates, and confirm public authoritative RPC/Explorer growth.
- Promote `evm-transaction-receipts-and-logs` only after every candidate, cleanup, rollback, and post-rollback health gate passes.

Files to touch:

- Candidate deployment/evidence scripts only where the existing generic drill cannot exercise EVM JSON-RPC receipt/log assertions.
- `internal/bftgateway` only for defects exposed by real Comet candidate evidence.
- API and acceptance documents only after evidence exists.
- No long-term goal-file rewrite and no bounded opcode/Counter/Hardhat/IDE execution expansion.

Validation commands:

- `go test ./...`
- `make test`
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

- Candidate EVM transaction/receipt results match direct committed Comet evidence and survive four-node/restart comparison without invented execution data.
- Log filters are bounded and truthful; no BFT contract logs are claimed while no BFT EVM contract execution exists.
- Candidate cleanup/rollback completes on all four roles and public authoritative services continue growing.
- Existing AI, Pay, Trust, Resource, YNXT supply, nonce, fee, and AppHash tests remain passing.

Explicitly not doing:

- Do not expand bounded EVM opcode coverage, Counter examples, Hardhat artifacts, or IDE execution in this slice.
- Do not route public RPC, Resource, Trust, DNS, Caddy, Explorer, or website traffic to the candidate.
- Do not claim public BFT, mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, or goal completion.
