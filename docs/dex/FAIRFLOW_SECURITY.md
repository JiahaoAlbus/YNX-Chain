# YNX FairFlow v1 security and economic boundary

`YNXFairFlow` is an immutable, non-upgradeable Testnet candidate for uniform-price intent batches. A user submits an Intent on-chain but transfers no token at submission, commit, reveal or winner selection. Tokens move only in the winning settlement transaction, using the user's existing token allowance, and the whole settlement reverts if any pull, output, limit or balance-conservation check fails.

## Deterministic batch lifecycle

Each governance-opened batch publishes four consecutive windows: Intent, solver commit, solver reveal and settlement. Governance can choose supported Factory tokens and bounded window lengths, but cannot select a winner, rewrite an Intent, settle a batch, withdraw tokens or redirect user output. Every active Intent must be included exactly once. A cancellation before the Intent window closes changes the public active-set hash; a cancellation after that boundary aborts the batch and unlocks all solver bonds instead of silently changing the competition.

Solvers commit to the batch, solver address, uniform clearing price, uniform solver-funded rebate, exact active-set hash, external-route evidence hash and salt. Reveal recomputes every user's output and rejects any solution below an Intent minimum. Scores are normalized into token0 at the proposed clearing price. Highest verified user surplus wins; an exact score tie uses the numerically lower solver address, a public deterministic rule. The winning route hash and best-execution digest are stored and emitted.

## Atomic settlement and CoW

For both directions, base output is calculated from one reciprocal uniform price. The same published rebate rate applies to each base output. This rebate is funded by the solver; it is not proof that the funds originated from extracted MEV. The contract nets user inputs and outputs by token. The solver supplies only a net token deficit and receives only a net surplus, making Coincidence of Wants observable in `BatchSettled`. Exact balance-delta checks reject fee-on-transfer, rebasing and malformed tokens, and the contract requires its ending token balances to equal their starting balances.

The solver never receives a generic call or user withdrawal permission. Outputs go only to each Intent owner; solver output is only the mathematically conserved batch surplus. Direct same-address solver self-trading can be proven from stored state and slashes the winning bond. A winning settlement timeout and a committed solution that is never revealed are also objectively slashable. Slash proceeds accrue as public treasury credit and are pulled by the immutable treasury, avoiding an external-call dependency during state transition. Completed, failed and proven-fraud counters feed an on-chain reputation score.

## Explicit limitations

- Same-address self-trade detection cannot identify Sybil-controlled addresses. Identity, anti-Sybil and cross-solver collusion controls are not implemented.
- `routeHash` commits to solver evidence but does not independently prove a CEX, bridge or external DEX route. Cross-chain settlement is disabled.
- The current candidate requires full fill of every active Intent; partial fill and per-user allocation caps are not implemented.
- Solver external liquidity is exact inventory transferred into the atomic settlement, not a callback into an external venue.
- There is no independent audit, formal verification, real-node chaos campaign, verified Testnet bytecode or public batch evidence yet.
- A solver-funded rebate must not be marketed as an MEV rebate without separate attributable evidence.

## Indexer and Wallet boundary

State schema/cursor v3 indexes ten confirmed lifecycle events with fixed stage-specific fields and binds the configured FairFlow address into the cursor HMAC. A v1 or v2 migration preserves the exact authenticated source as a mode-0600 rollback file and rewinds to the deployment start block before FairFlow ingestion. Reorg recovery removes FairFlow and pool/Vault events at the same confirmed boundary. `GET /v1/fairflow/events` is an evidence history, not authoritative live batch state.

The SDK accepts only fresh, source-labelled direct RPC state for the exact FairFlow contract. Intent submission binds user, batch tokens, user nonce and the on-chain intent domain; cancellation binds the existing owner and intent. Submission requires canonical Wallet introspection with the exact `dex:fairflow:intent` scope and request digest. An injected transport can only return an unconfirmed transaction; completion requires a matching confirmed indexed event. The SDK contains no signer, solver loop or automatic trading path.

## Local evidence

`npm run dex:fairflow:test` covers 32 arithmetic differential vectors, invalid rounding boundaries, commit tampering, uniform-price user improvement, solver-funded rebate, deterministic competition, bond locking, non-reveal slashing, all-Intent inclusion, reversed settlement order, CoW netting, exact external inventory, atomic allowance failure rollback, taxed-token rejection and burn rollback, user cancellation abort, proven direct self-trade slashing, public reputation, timeout fallback, user asset preservation, native bond-ledger conservation and treasury-credit withdrawal. `go test -race ./internal/dex ./cmd/ynx-dex-indexerd` covers every FairFlow event shape, malformed ABI booleans, persistence, replay conflicts, API filtering, v1/v2 migration, restart and shared reorg recovery. `npm test --prefix sdk/dex` covers request binding, stale/closed state, approval tampering and indexed reconciliation. The observed local deployment gas and two-Intent settlement gas are printed without extrapolating production capacity.
