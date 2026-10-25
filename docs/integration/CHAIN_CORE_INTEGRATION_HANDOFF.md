# Chain Core Integration Handoff

## Frozen chain-owned facts

- Network: `ynx_6423-1`; EVM compatibility ID: `6423` / `0x1917`; native asset: `YNXT`.
- Native user identity defaults to `ynx1...`; `0x...` is EVM compatibility only.
- Current committed-state schema is v12 with AppHash domain `YNX_ABCI_STATE_V12`; ABCI application version is 18 and State Sync snapshot format is 1.
- Chain Core owns final state, AppHash, transaction finality, chain-level events, native fee records and chain-level asset authorization primitives.
- Exact route classes and schema references are frozen in `release/integration/chain-core-contract.json`.

## Central dependencies

Wallet/Auth owns product registration, Device Challenge, Approval, Product Session, ordered scopes, expiry, introspection and revocation. App Gateway may forward a mutation only after the accepted Wallet/Auth contract proves the exact product, bundle, device, account, scopes and expiry. Chain Core will not create a parallel session protocol.

Data Fabric owns canonical cross-product event ingestion and billing ledger semantics. Oracle owns price and market facts. Bridge owns cross-chain lifecycle. Security/SRE owns release and artifact policy. Website owns public routes, downloads and SEO.

## Acceptance boundary

Release metadata and the integration contract bind this handoff to verified source
commit `cb20b1591f81` and contract version `1.12.0`. That merge preserves the
complete Chain Core history while integrating the current central baseline. It
adds committed governance execution begin/verify/audit records, migrates v11
state to v12 without inventing governance history, and keeps legacy v11 AppHash
verification exact before recomputing the v12 root.

Source commit `cb20b1591f81` contains locally tested v12 execution for native transfer, fixed fees, StrategyMandate, Strategy Vault, staking exit lifecycle, Smart Account, UserOperation, Paymaster, Treasury snapshot, native-liability solvency proofs and governance execution audit. It also contains ABCI v18 State Sync snapshots with trusted AppHash binding and a local four-validator backup/restore/rollback replay drill. The BFT Gateway exposes committed EVM network, block, block-transaction count/index, account, bounded pinned-contract bytecode/static calls/resource estimates, transaction, receipt and log reads. `eth_sendRawTransaction` accepts the canonical signed YNXT envelope plus three strictly bounded Ethereum value-transfer profiles: EIP-155 legacy type `0x0`; EIP-2930 type `0x1` with an empty access list; and EIP-1559 type `0x2` with an empty access list and an explicitly frozen compatibility `baseFeePerGas` of zero. All three require chain ID 6423, recovered secp256k1 sender, zero-based account nonce, empty calldata, a 20-byte recipient, no contract creation and exactly 21000 gas. For type `0x2`, `0 < maxPriorityFeePerGas <= maxFeePerGas`; maximum affordability is checked against `maxFeePerGas × 21000`, while the actual committed fee uses the zero-base-fee effective price `maxPriorityFeePerGas`. Ethereum Keccak identity and CometBFT SHA-256 identity remain distinct and are both checked. Non-empty access lists, calldata, contract creation and a dynamic Ethereum base-fee market remain unsupported. Committed EVM receipt reads independently verify the canonical receipt audit hash and bind transaction hash, block height, sender, recipient and action to CometBFT block evidence before returning JSON-RPC data. The local Bundler performs real nonce lookup, outer signing, Comet commit, receipt readback, Paymaster debit verification and replay rejection through ABCI/Gateway handlers. The Indexer validates complete block/transaction invariants before journaling, requires private regular checkpoint/WAL files, rejects unknown fields and tampering, performs fsync-bound atomic checkpoints, recovers the checkpoint/WAL overlap crash window and deep-clones returned snapshots. Strategy Vault funding fails closed after mandate expiry, revoke or kill and after vault closure, while owner-only withdrawal and emergency exit remain available; rejected mutations preserve fees, nonces, balances, lots and audit state. EVM block-transaction lookup vectors freeze `null` for pending, missing and out-of-range results, `-32602` for malformed identifiers or parameter counts, and `-32603` for unavailable or inconsistent CometBFT evidence. `eth_gasPrice` and `eth_maxPriorityFeePerGas` return the protocol minimum `0x1`, not a market forecast. `eth_feeHistory` is committed-evidence-only: it reads retained blocks, `block_results` gas and the exact-height CometBFT consensus `max_gas`, returns only zero `baseFeePerGas` history and evidence-derived `gasUsedRatio`, accepts omitted or empty reward percentiles, returns `-32004` when `max_gas` is non-positive, and rejects reward estimates or inconsistent gas evidence rather than fabricating a dynamic fee market. The bounded signer CLI emits raw or machine-readable dual-hash evidence, and the local four-validator drill proves Gateway broadcast commit, exact Comet block membership, valid AppHash/DataHash, all-validator account and receipt equality, rollback replay, wrong-chain rejection and duplicate-cache classification. Successful Ethereum broadcasts are returned only after committed block, gas and audited receipt evidence agree; mismatches fail as `-32603`, while Comet cache duplicates fail as `-32003`. These capabilities are not deployed on the authoritative public runtime and are not centrally integrated with the accepted Wallet/Auth Product Session.

The deployed baseline remains `ynx-chain-02f4ccd8770c`, using one authoritative producer and three authenticated read-only followers. It is not four-validator CometBFT voting.

## Integration order

1. Freeze one accepted Wallet/Auth contract and exact scope identifiers in `29-integration`.
2. Bind the accepted Product Session introspection result to Chain Core mutation route classes.
3. Run every vector in `CROSS_PRODUCT_TEST_VECTORS.json`, including wrong product, scope widening, expiry, revoke and replay rejection.
4. Run v11-to-v12 migration and AppHash determinism against four local CometBFT validators.
5. Only after local and remote gates pass, deploy follower-first with backup and rollback evidence.

No product may interpret this handoff as public deployment, production signing, Mainnet readiness or permission to execute a public BFT cutover.
