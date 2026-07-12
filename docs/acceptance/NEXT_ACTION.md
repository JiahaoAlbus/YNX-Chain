# Next Action

Current single action: implement and locally verify the remaining BFT EVM transaction receipt/log compatibility surface while keeping bounded opcode, Counter, Hardhat artifact, and IDE execution expansion paused.

Why this action:

- Resource Market is now complete private-candidate proof: four-app state/AppHash equality, four-signer evidence, capability promotion, cleanup, rollback, and authoritative public health all passed.
- Gateway health truthfully reports thirteen implemented and two missing capabilities with `publicCutoverReady=false`.
- EVM receipts/logs are the narrower next gap and can be implemented around existing committed transaction/block evidence without expanding the bounded execution engine.
- IDE contract state transitions remain the final later gap and must not be conflated with receipt/log compatibility.

Required work:

- Audit the authoritative `eth_getTransactionReceipt`, log filtering, block transaction, and transaction lookup contracts against current BFT Gateway/ABCI evidence.
- Define deterministic receipt and log records for supported native and already-bounded contract transactions, including status, block/hash/index, gas fields, contract address where real, logs, topics, and removed flag.
- Persist or derive the minimum consensus evidence needed for restart-safe AppHash equality without inventing EVM execution results.
- Add BFT Gateway JSON-RPC handlers and fail closed for unsupported receipt/log cases.
- Add unit, restart, malformed filter, unknown transaction, block-range, topic/address filter, duplicate/replay, and four-application equality tests plus a focused Make target.
- Keep `evm-transaction-receipts-and-logs` missing until local gates and a later fresh private candidate proof pass.

Files to touch:

- `internal/consensus` only where deterministic receipt/log evidence is required.
- `internal/bftgateway` EVM JSON-RPC translation and tests.
- `internal/chain` only for reusable existing receipt/log types or pure validation helpers.
- focused checks, API docs after handlers exist, and acceptance files after verified evidence.
- No long-term goal-file rewrite and no bounded opcode/Counter/Hardhat/IDE execution expansion.

Validation commands:

- `go test ./...`
- `make test`
- `make bft-gateway-check`
- add and run a focused BFT EVM receipt/log check
- `make consensus-abci-check`
- `make consensus-signed-transfer-check`
- `make bft-resource-action-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Supported committed transactions return deterministic Ethereum-compatible receipt/log fields across restart and all ABCI applications.
- Unknown, unsupported, malformed, overbroad, or inconsistent receipt/log requests fail closed without fabricated success or logs.
- Existing AI, Pay, Trust, Resource, YNXT supply, nonce, fee, and AppHash tests remain unchanged and passing.
- Gateway capability is not promoted and no remote/public claim is made until a separate fresh candidate proof and rollback complete.

Explicitly not doing:

- Do not expand bounded EVM opcode coverage, Counter examples, Hardhat artifacts, or IDE execution in this slice.
- Do not route public RPC, Resource, Trust, DNS, Caddy, Explorer, or website traffic to a candidate.
- Do not claim public BFT, mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, or goal completion.
