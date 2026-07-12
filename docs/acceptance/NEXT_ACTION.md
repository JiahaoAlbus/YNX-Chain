# Next Action

Current single action: commit the locally verified Resource Market BFT implementation, then prove it on a fresh private four-validator candidate and roll it back safely while keeping bounded EVM/IDE work paused.

Why this action:

- Canonical Resource delegation/rental actions, AppHash persistence, settlement reconciliation, BFT Gateway handlers, and `ynx-resourced` signer mode now exist and pass focused race/restart/accounting tests.
- Gateway health must remain at twelve implemented and three missing until remote Resource evidence passes; local code alone is insufficient for promotion.
- The public authoritative Resource, RPC, DNS, Caddy, Trust, Explorer, and website routes must remain untouched.

Required proof:

- Commit and push the local Resource implementation after all local gates pass.
- Export a fresh authoritative migration and deploy only a private candidate on the four existing validator-role hosts.
- Keep the Resource signer key local and mode-restricted; reach the loopback BFT Gateway only through a strict tunnel.
- Commit a real delegation and rental, then prove quote/policy binding, provider/protocol income, resource balance, analytics, idempotent replay without nonce/fee, changed-input conflict, and rejected invalid action without state change.
- Compare complete Resource/account state and AppHash across all four ABCI applications, then pass four-signer evidence.
- Only after that proof, move Resource Market from missing to implemented in Gateway health and rerun the candidate evidence.
- Remove temporary signer material, tunnels, Gateway, candidate services, and candidate state; run the four-host rollback gate and verify public authoritative RPC/Explorer health and growth.
- Update acceptance files with exact heights, IDs, digests, AppHash, cleanup, rollback, and public-health evidence.

Files to touch:

- Candidate deployment and verification scripts only if the existing private-candidate flow needs Resource-specific evidence collection.
- `internal/bftgateway/gateway.go` only after proof, to promote Resource capability truthfully.
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `docs/acceptance/PROJECT_STATE.md`, and this file after verified evidence.
- No EVM/IDE expansion and no long-term goal-file rewrite.

Validation commands:

- `go test ./...`
- `make test`
- `make bft-resource-action-check`
- `make resource-api-check`
- `make resource-market-check`
- `make bft-gateway-check`
- `make consensus-abci-check`
- `make consensus-signed-transfer-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Four applications expose identical Resource records, account state, analytics digest, and AppHash after valid and rejected actions.
- Four-signer evidence passes after Resource capability promotion, with `publicCutoverReady=false` and only EVM receipt/log plus IDE contract-state gaps remaining.
- Every temporary process, tunnel, signer file, candidate binary, and candidate state directory is removed; the authoritative four-host rollback gate and public RPC/Explorer growth checks pass.
- The result is recorded as private candidate proof only, not public BFT or persistent deployment.

Explicitly not doing:

- Do not route public Resource, Trust, RPC, DNS, Caddy, Explorer, or website traffic to the candidate.
- Do not promote Resource capability before complete remote evidence.
- Do not expand EVM opcode, Counter, Hardhat artifact, or IDE execution coverage in this slice.
- Do not commit or print signer keys, PEM files, mnemonics, real `.env` values, private evidence bodies, or customer secrets.
- Do not claim public BFT, mainnet, exchange listing, stablecoin issuer support, wallet default support, partnerships, or goal completion.
